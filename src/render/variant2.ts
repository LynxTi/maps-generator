import mbgl from '@maplibre/maplibre-gl-native';
import sharp from 'sharp';
import { getEnv } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import type { RenderMapInput } from '../types/domain.js';
import { createStandaloneOverlaySvg } from './overlay.js';
import { compositeAndExportWebP } from './webp.js';

export const MAP_WIDTH = 1232;
export const MAP_HEIGHT = 522;

type StyleJson = {
  layers: Array<{
    id?: string;
    type?: string;
    layout?: Record<string, unknown>;
    paint?: Record<string, unknown>;
  }>;
  [key: string]: unknown;
};

let cachedStyle: StyleJson | null = null;

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  retries: number,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new AppError(
    502,
    'TILE_PROVIDER_UNAVAILABLE',
    'Tile or style provider is unavailable',
    { cause: lastError instanceof Error ? lastError.message : String(lastError) },
  );
}

function customizeStyle(style: StyleJson): StyleJson {
  for (const layer of style.layers) {
    const id = String(layer.id || '').toLowerCase();

    if (id.includes('graticule') || id.includes('grid') || id.includes('geoline')) {
      layer.layout = layer.layout || {};
      layer.layout['visibility'] = 'none';
      continue;
    }

    if (layer.type === 'background') {
      layer.paint = layer.paint || {};
      layer.paint['background-color'] = '#F5ECE1';
    } else if (layer.type === 'fill') {
      layer.paint = layer.paint || {};
      layer.paint['fill-color'] = '#F0E4D0';
      layer.paint['fill-opacity'] = 1;
    } else if (layer.type === 'line') {
      layer.paint = layer.paint || {};
      layer.paint['line-color'] = '#A88F70';
      layer.paint['line-opacity'] = 0.55;
      layer.paint['line-width'] = 1.1;
      layer.paint['line-blur'] = 0.3;

      layer.layout = layer.layout || {};
      layer.layout['line-join'] = 'round';
      layer.layout['line-cap'] = 'round';
    } else if (layer.type === 'symbol') {
      layer.layout = layer.layout || {};
      layer.layout['visibility'] = 'none';
    }
  }

  return style;
}

export async function getStyle(): Promise<StyleJson> {
  if (!cachedStyle) {
    const env = getEnv();
    const styleRes = await fetchWithTimeout(
      'https://demotiles.maplibre.org/style.json',
      env.TILE_FETCH_TIMEOUT_MS,
      env.TILE_FETCH_RETRIES,
    );
    const style = (await styleRes.json()) as StyleJson;
    cachedStyle = customizeStyle(style);
  }
  return cachedStyle;
}

export async function renderRealMap({
  lat,
  lon,
  outputPath,
  seedText,
}: RenderMapInput): Promise<string> {
  const env = getEnv();
  const style = await getStyle();

  const map = new mbgl.Map({
    request(req, callback) {
      fetchWithTimeout(req.url, env.TILE_FETCH_TIMEOUT_MS, env.TILE_FETCH_RETRIES)
        .then((res) => res.arrayBuffer())
        .then((buffer) => callback(undefined, { data: Buffer.from(buffer) }))
        .catch((err: Error) => callback(err));
    },
  });

  try {
    map.load(style);

    const rawBuffer = await new Promise<Buffer>((resolve, reject) => {
      map.render(
        {
          zoom: 3,
          center: [lon, lat],
          width: MAP_WIDTH,
          height: MAP_HEIGHT,
        },
        (err, buffer) => {
          if (err) reject(err);
          else resolve(buffer as Buffer);
        },
      );
    });

    const baseBuffer = await sharp(rawBuffer, {
      raw: { width: MAP_WIDTH, height: MAP_HEIGHT, channels: 4 },
    })
      .png()
      .toBuffer();

    const overlaySvg = createStandaloneOverlaySvg(
      MAP_WIDTH,
      MAP_HEIGHT,
      MAP_WIDTH / 2,
      MAP_HEIGHT / 2,
    );
    const overlayBuffer = Buffer.from(overlaySvg);

    await compositeAndExportWebP(
      baseBuffer,
      [],
      overlayBuffer,
      outputPath,
      MAP_WIDTH,
      MAP_HEIGHT,
      seedText,
    );

    return outputPath;
  } finally {
    map.release();
  }
}
