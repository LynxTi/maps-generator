import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';
import { loadEnv, resetEnvCache } from '../../src/config/env.js';
import { LocalStorage } from '../../src/storage/local-storage.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

describe('LocalStorage', () => {
  let tmpDir: string;

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'mongodb://127.0.0.1:27017/test';
    process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
    process.env.LOG_LEVEL = 'silent';
    resetEnvCache();
    loadEnv();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-'));
  });

  it('commits valid webp and rejects invalid files', async () => {
    const storage = new LocalStorage(tmpDir);
    await storage.ensureReady();

    const temp = storage.createTempPath();
    const final = storage.createFinalPath('ok.webp');

    await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: { r: 1, g: 2, b: 3 },
      },
    })
      .webp()
      .toFile(temp);

    await storage.commitTempFile(temp, final.absolutePath);
    const exists = await fs
      .access(final.absolutePath)
      .then(() => true)
      .catch(() => false);
    assert.equal(exists, true);

    const badTemp = storage.createTempPath('.bin');
    await fs.writeFile(badTemp, 'not-an-image');
    await assert.rejects(() => storage.commitTempFile(badTemp, path.join(tmpDir, 'bad.webp')));
  });
});
