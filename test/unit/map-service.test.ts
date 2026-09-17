import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { loadEnv, resetEnvCache } from '../../src/config/env.js';
import { AppError } from '../../src/lib/errors.js';
import { AsyncQueue } from '../../src/lib/queue.js';
import { MapService } from '../../src/services/map-service.js';
import { LocalStorage } from '../../src/storage/local-storage.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

type FakeRow = {
  id: string;
  lat: number;
  lon: number;
  latKey: string;
  lonKey: string;
  place: string | null;
  filename: string;
  urlPath: string;
  renderVersion: string;
  status: 'pending' | 'ready' | 'failed';
  attempts: number;
  lastErrorCode: string | null;
  lastErrorMsg: string | null;
};

function setBaseEnv() {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'mongodb://127.0.0.1:27017/test';
  process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
  process.env.LOG_LEVEL = 'silent';
  process.env.RENDER_MAX_ATTEMPTS = '3';
  process.env.RENDER_RETRY_BACKOFF_MS = '0';
  resetEnvCache();
  loadEnv();
}

function createFakeRepo(seed?: FakeRow) {
  const store = new Map<string, FakeRow>();
  if (seed) {
    store.set(`${seed.latKey}:${seed.lonKey}:${seed.renderVersion}`, seed);
  }

  const keyOf = (latKey: string, lonKey: string, renderVersion: string) =>
    `${latKey}:${lonKey}:${renderVersion}`;

  return {
    store,
    async findByKey(latKey: string, lonKey: string, renderVersion: string) {
      return store.get(keyOf(latKey, lonKey, renderVersion)) ?? null;
    },
    async createIgnoringDuplicate(data: {
      lat: number;
      lon: number;
      latKey: string;
      lonKey: string;
      place?: string | null;
      filename: string;
      urlPath: string;
      renderVersion: string;
    }) {
      const key = keyOf(data.latKey, data.lonKey, data.renderVersion);
      const existing = store.get(key);
      if (existing) return existing;
      const row: FakeRow = {
        id: `id-${store.size + 1}`,
        lat: data.lat,
        lon: data.lon,
        latKey: data.latKey,
        lonKey: data.lonKey,
        place: data.place ?? null,
        filename: data.filename,
        urlPath: data.urlPath,
        renderVersion: data.renderVersion,
        status: 'pending',
        attempts: 0,
        lastErrorCode: null,
        lastErrorMsg: null,
      };
      store.set(key, row);
      return row;
    },
    async markPending(id: string) {
      for (const row of store.values()) {
        if (row.id === id) {
          row.status = 'pending';
          row.lastErrorCode = null;
          row.lastErrorMsg = null;
          return row;
        }
      }
      throw new Error(`missing ${id}`);
    },
    async incrementAttempts(id: string) {
      for (const row of store.values()) {
        if (row.id === id) {
          row.attempts += 1;
          return row;
        }
      }
      throw new Error(`missing ${id}`);
    },
    async markReady(id: string) {
      for (const row of store.values()) {
        if (row.id === id) {
          row.status = 'ready';
          row.lastErrorCode = null;
          row.lastErrorMsg = null;
          return row;
        }
      }
      throw new Error(`missing ${id}`);
    },
    async markFailed(id: string, code: string, message: string) {
      for (const row of store.values()) {
        if (row.id === id) {
          row.status = 'failed';
          row.lastErrorCode = code;
          row.lastErrorMsg = message;
          return row;
        }
      }
      throw new Error(`missing ${id}`);
    },
  };
}

async function writeTinyWebp(outputPath: string): Promise<string> {
  await sharp({
    create: {
      width: 16,
      height: 8,
      channels: 3,
      background: { r: 200, g: 180, b: 140 },
    },
  })
    .webp()
    .toFile(outputPath);
  return outputPath;
}

describe('MapService with fake renderer', () => {
  let tmpDir: string;

  before(async () => {
    setBaseEnv();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-svc-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates a map and returns cached on second call', async () => {
    const storage = new LocalStorage(tmpDir);
    const created: string[] = [];
    const fakeRepo = createFakeRepo();

    const service = new MapService({
      storage,
      queue: new AsyncQueue(1),
      mapRepository: fakeRepo as never,
      retryBackoffMs: 0,
      async renderMap({ outputPath }) {
        created.push(outputPath);
        return writeTinyWebp(outputPath);
      },
    });

    const first = await service.getOrCreateMap({ lat: 48.8566, lon: 2.3522, place: 'Paris' });
    const second = await service.getOrCreateMap({
      lat: 48.85661,
      lon: 2.35221,
      place: 'Paris again',
    });

    assert.equal(first.cached, false);
    assert.equal(first.status, 'ready');
    assert.equal(second.cached, true);
    assert.equal(second.status, 'ready');
    assert.equal(first.id, second.id);
    assert.equal(created.length, 1);
    assert.match(first.url, /\/storage\/.+\.webp$/);
  });

  it('accepts a map immediately with a reserved URL', async () => {
    const storage = new LocalStorage(path.join(tmpDir, 'reserve'));
    const fakeRepo = createFakeRepo();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const service = new MapService({
      storage,
      queue: new AsyncQueue(1),
      mapRepository: fakeRepo as never,
      retryBackoffMs: 0,
      async renderMap({ outputPath }) {
        await gate;
        return writeTinyWebp(outputPath);
      },
    });

    const accepted = await service.acceptMap({ lat: 12, lon: 13 });
    assert.equal(accepted.created, true);
    assert.equal(accepted.cached, false);
    assert.equal(accepted.status, 'pending');
    assert.match(accepted.url, /\/storage\/.+\.webp$/);

    release?.();
    const ready = await service.getOrCreateMap({ lat: 12, lon: 13 });
    assert.equal(ready.id, accepted.id);
    assert.equal(ready.url, accepted.url);
    assert.equal(ready.status, 'ready');
  });

  it('deduplicates concurrent identical requests', async () => {
    const storage = new LocalStorage(path.join(tmpDir, 'concurrent'));
    let renders = 0;
    const fakeRepo = createFakeRepo();

    const service = new MapService({
      storage,
      queue: new AsyncQueue(1),
      mapRepository: fakeRepo as never,
      retryBackoffMs: 0,
      async renderMap({ outputPath }) {
        renders += 1;
        await new Promise((r) => setTimeout(r, 40));
        return writeTinyWebp(outputPath);
      },
    });

    const [a, b] = await Promise.all([
      service.getOrCreateMap({ lat: 10, lon: 20 }),
      service.getOrCreateMap({ lat: 10, lon: 20 }),
    ]);

    assert.equal(a.id, b.id);
    assert.equal(a.url, b.url);
    assert.equal(renders, 1);
  });

  it('rejects invalid coordinates', async () => {
    const service = new MapService({
      storage: new LocalStorage(tmpDir),
      mapRepository: createFakeRepo() as never,
      renderMap: async () => {
        throw new Error('should not render');
      },
    });

    await assert.rejects(
      () => service.getOrCreateMap({ lat: 999, lon: 0 }),
      (err: unknown) => err instanceof AppError && err.code === 'INVALID_COORDINATES',
    );
  });

  it('re-renders into the same reserved filename when the file is missing', async () => {
    const storage = new LocalStorage(path.join(tmpDir, 'missing'));
    let renders = 0;
    const fakeRepo = createFakeRepo({
      id: 'cached',
      lat: 1,
      lon: 2,
      latKey: '1.0000',
      lonKey: '2.0000',
      place: null,
      filename: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.webp',
      urlPath: '/storage/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.webp',
      renderVersion: 'v1',
      status: 'ready',
      attempts: 1,
      lastErrorCode: null,
      lastErrorMsg: null,
    });

    const service = new MapService({
      storage,
      queue: new AsyncQueue(1),
      mapRepository: fakeRepo as never,
      retryBackoffMs: 0,
      async renderMap({ outputPath }) {
        renders += 1;
        return writeTinyWebp(outputPath);
      },
    });

    const result = await service.getOrCreateMap({ lat: 1, lon: 2 });
    assert.equal(renders, 1);
    assert.equal(result.cached, false);
    assert.equal(result.id, 'cached');
    assert.match(result.url, /aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee\.webp$/);
    assert.equal(await storage.exists('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.webp'), true);
  });

  it('retries a failed render into the same URL', async () => {
    const storage = new LocalStorage(path.join(tmpDir, 'retry'));
    const fakeRepo = createFakeRepo();
    let calls = 0;

    const service = new MapService({
      storage,
      queue: new AsyncQueue(1),
      mapRepository: fakeRepo as never,
      maxAttempts: 3,
      retryBackoffMs: 0,
      async renderMap({ outputPath }) {
        calls += 1;
        if (calls < 3) {
          throw new Error('transient');
        }
        return writeTinyWebp(outputPath);
      },
    });

    const result = await service.getOrCreateMap({ lat: 7, lon: 8 });
    assert.equal(calls, 3);
    assert.equal(result.status, 'ready');
    const row = [...fakeRepo.store.values()][0];
    assert.equal(row?.attempts, 3);
    assert.equal(row?.status, 'ready');
  });

  it('marks the reserved map failed after retry limit', async () => {
    const storage = new LocalStorage(path.join(tmpDir, 'fail'));
    const fakeRepo = createFakeRepo();

    const service = new MapService({
      storage,
      queue: new AsyncQueue(1),
      mapRepository: fakeRepo as never,
      maxAttempts: 2,
      retryBackoffMs: 0,
      async renderMap() {
        throw new Error('always');
      },
    });

    await assert.rejects(
      () => service.getOrCreateMap({ lat: 9, lon: 9 }),
      (err: unknown) => err instanceof AppError && err.code === 'RENDER_FAILED',
    );
    const row = [...fakeRepo.store.values()][0];
    assert.equal(row?.status, 'failed');
    assert.equal(row?.attempts, 2);
  });

  it('rejects new renders when the queue is saturated', async () => {
    const storage = new LocalStorage(path.join(tmpDir, 'queue'));
    const fakeRepo = createFakeRepo();
    const service = new MapService({
      storage,
      queue: new AsyncQueue(1),
      maxRenderQueue: 1,
      mapRepository: fakeRepo as never,
      retryBackoffMs: 0,
      async renderMap({ outputPath }) {
        await new Promise((r) => setTimeout(r, 80));
        return writeTinyWebp(outputPath);
      },
    });

    const first = service.getOrCreateMap({ lat: 3, lon: 4 });
    await new Promise((r) => setTimeout(r, 10));
    await assert.rejects(
      () => service.getOrCreateMap({ lat: 5, lon: 6 }),
      (err: unknown) => err instanceof AppError && err.code === 'QUEUE_SATURATED',
    );
    await first.catch(() => undefined);
  });
});
