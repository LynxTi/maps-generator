import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadEnv, resetEnvCache } from '../../src/config/env.js';
import { renderRealMap } from '../../src/render/variant2.js';
import { coordinateSeed, toCoordinateKey } from '../../src/lib/coordinates.js';

const enabled = process.env.RUN_E2E_SMOKE === '1';

describe('E2E MapLibre smoke', { skip: !enabled }, () => {
  it('renders one real map to disk', async () => {
    process.env.DATABASE_URL ??= 'mongodb://127.0.0.1:27017/smoke';
    process.env.PUBLIC_BASE_URL ??= 'http://localhost:3000';
    process.env.LOG_LEVEL = 'silent';
    resetEnvCache();
    loadEnv();

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'e2e-map-'));
    const outputPath = path.join(dir, 'paris.webp');
    const { latKey, lonKey } = toCoordinateKey(48.8566, 2.3522);

    const result = await renderRealMap({
      lat: 48.8566,
      lon: 2.3522,
      outputPath,
      seedText: coordinateSeed(latKey, lonKey, 'v1'),
    });

    const stat = await fs.stat(result);
    assert.ok(stat.size > 1000);
  });
});
