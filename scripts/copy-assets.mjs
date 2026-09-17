import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcTextures = path.join(root, 'src', 'common', 'textures');
const distTextures = path.join(root, 'dist', 'common', 'textures');

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`Assets source missing: ${src}`);
    return;
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

copyDir(srcTextures, distTextures);
console.log('Copied texture assets to dist/common/textures');
