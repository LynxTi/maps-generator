import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const TEXTURE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function resolveTexturesDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../common/textures'),
    path.resolve(here, '../../src/common/textures'),
    path.resolve(process.cwd(), 'src/common/textures'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0]!;
}

const TEXTURES_DIR = resolveTexturesDir();

export function hashString(value: string): number {
  let h = 2166136261;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function listTextures(): string[] {
  return fs
    .readdirSync(TEXTURES_DIR)
    .filter((name) => TEXTURE_EXTS.has(path.extname(name).toLowerCase()))
    .map((name) => path.join(TEXTURES_DIR, name))
    .sort();
}

export function pickTexturePath(seedText: string): string {
  const textures = listTextures();
  if (textures.length === 0) {
    throw new Error(`No textures found in ${TEXTURES_DIR}`);
  }

  const index = hashString(seedText) % textures.length;
  return textures[index]!;
}

async function softenTexture(width: number, height: number, seedText: string): Promise<Buffer> {
  const texturePath = pickTexturePath(seedText);
  const veil = Buffer.from(
    `<svg width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="#fff" fill-opacity="0.42"/>
    </svg>`,
  );

  return sharp(texturePath)
    .resize(width, height, { fit: 'fill' })
    .composite([{ input: veil, blend: 'over' }])
    .toBuffer();
}

export async function compositeAndExportWebP(
  baseBuffer: Buffer,
  layers: sharp.OverlayOptions[],
  overlayBuffer: Buffer,
  outputPath: string,
  width: number,
  height: number,
  seedText: string,
): Promise<void> {
  const cornerRadius = 36 * (width / 1232);
  const maskSvg = `<svg width="${width}" height="${height}">
    <rect x="0" y="0" width="${width}" height="${height}" rx="${cornerRadius}" ry="${cornerRadius}" fill="#fff" />
  </svg>`;

  const maskBuffer = Buffer.from(maskSvg);
  const textureBuffer = await softenTexture(width, height, seedText);

  const compositeLayers: sharp.OverlayOptions[] = [
    ...layers,
    { input: textureBuffer, blend: 'multiply' },
    { input: overlayBuffer },
    { input: maskBuffer, blend: 'dest-in' },
  ];

  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

  await sharp(baseBuffer)
    .composite(compositeLayers)
    .webp({ quality: 92, alphaQuality: 96 })
    .toFile(outputPath);
}
