import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Express } from 'express';
import { startTestApp, stopTestApp, type TestContext } from './helpers.js';

async function waitForWebp(app: Express, fileName: string, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await request(app).get(`/storage/${fileName}`);
    if (res.status === 200) return res;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(`Timed out waiting for /storage/${fileName}`);
}

function fileNameFromUrl(url: string): string {
  return String(url).split('/storage/')[1] ?? '';
}

describe('HTTP API integration', () => {
  let ctx: TestContext;

  before(async () => {
    ctx = await startTestApp();
  });

  after(async () => {
    await stopTestApp(ctx);
  });

  it('creates a map without an API key', async () => {
    const res = await request(ctx.app).post('/api/v1/maps').send({ lat: 1, lon: 2 });
    assert.equal(res.status, 201);
    assert.equal(res.body.cached, false);
    assert.ok(res.body.url);
    assert.ok(res.body.status === 'pending' || res.body.status === 'ready');
  });

  it('creates and caches a map', async () => {
    const created = await request(ctx.app)
      .post('/api/v1/maps')
      .send({ lat: 48.8566, lon: 2.3522, place: 'Paris' });

    assert.equal(created.status, 201);
    assert.match(created.body.url, /\/storage\/.+\.webp$/);
    const fileName = fileNameFromUrl(created.body.url);
    await waitForWebp(ctx.app, fileName);

    const cached = await request(ctx.app)
      .post('/api/v1/maps')
      .send({ lat: 48.85661, lon: 2.35221, place: 'Paris 2' });

    assert.equal(cached.status, 200);
    assert.equal(cached.body.cached, true);
    assert.equal(cached.body.status, 'ready');
    assert.equal(cached.body.id, created.body.id);
    assert.equal(cached.body.url, created.body.url);

    const fileRes = await request(ctx.app).get(`/storage/${fileName}`);
    assert.equal(fileRes.status, 200);
    assert.match(String(fileRes.headers['content-type']), /image\/webp/);
  });

  it('validates coordinates', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/maps')
      .send({ lat: 999, lon: 0 });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  it('reserves batch URLs immediately and retries a failed render', async () => {
    let calls = 0;
    await stopTestApp(ctx);
    ctx = await startTestApp({
      renderMap: async ({ outputPath, lat }) => {
        calls += 1;
        if (lat === 1) {
          throw new Error('forced failure');
        }
        const sharp = (await import('sharp')).default;
        await sharp({
          create: {
            width: 16,
            height: 8,
            channels: 3,
            background: { r: 1, g: 2, b: 3 },
          },
        })
          .webp()
          .toFile(outputPath);
        return outputPath;
      },
    });

    const res = await request(ctx.app)
      .post('/api/v1/maps/batch')
      .send({
        items: [
          { lat: 0, lon: 0 },
          { lat: 1, lon: 1 },
        ],
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.mode, 'sync');
    assert.equal(res.body.items.length, 2);
    assert.equal(res.body.items[0].ok, true);
    assert.equal(res.body.items[1].ok, true);
    assert.ok(res.body.items[0].url);
    assert.ok(res.body.items[1].url);

    await waitForWebp(ctx.app, fileNameFromUrl(res.body.items[0].url));

    const started = Date.now();
    while (Date.now() - started < 2000) {
      if (calls >= 3) break;
      await new Promise((r) => setTimeout(r, 40));
    }
    assert.ok(calls >= 3);

    const missing = await request(ctx.app).get(
      `/storage/${fileNameFromUrl(res.body.items[1].url)}`,
    );
    assert.equal(missing.status, 404);
    assert.equal(missing.headers['cache-control'], 'no-store');
  });

  it('creates async job for larger batches and completes items', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/maps/batch')
      .set('idempotency-key', 'batch-job-1')
      .send({
        items: [
          { lat: 10, lon: 10 },
          { lat: 11, lon: 11 },
          { lat: 12, lon: 12 },
        ],
      });

    assert.equal(res.status, 202);
    assert.equal(res.body.mode, 'async');
    assert.equal(res.body.items.length, 3);
    assert.ok(res.body.items[0].url);
    const jobId = res.body.jobId as string;

    const idempotent = await request(ctx.app)
      .post('/api/v1/maps/batch')
      .set('idempotency-key', 'batch-job-1')
      .send({
        items: [
          { lat: 10, lon: 10 },
          { lat: 11, lon: 11 },
          { lat: 12, lon: 12 },
        ],
      });
    assert.equal(idempotent.status, 202);
    assert.equal(idempotent.body.jobId, jobId);
    assert.equal(idempotent.body.items[0].url, res.body.items[0].url);

    for (const item of res.body.items) {
      const file = await waitForWebp(ctx.app, fileNameFromUrl(item.url), 15_000);
      assert.equal(file.status, 200);
    }
  });

  it('serves openapi and docs', async () => {
    const spec = await request(ctx.app).get('/openapi.json');
    assert.equal(spec.status, 200);
    assert.ok(spec.body.paths['/api/v1/maps']);
    assert.ok(spec.body.paths['/api/v1/maps/batch']);
    assert.equal(spec.body.paths['/api/v1/jobs/{id}'], undefined);

    const docs = await request(ctx.app).get('/docs/');
    assert.equal(docs.status, 200);
  });

  it('reports health endpoints', async () => {
    const live = await request(ctx.app).get('/healthz');
    assert.equal(live.status, 200);
    const ready = await request(ctx.app).get('/readyz');
    assert.equal(ready.status, 200);
    assert.equal(ready.body.status, 'ready');
  });

  it('rejects non-uuid storage paths', async () => {
    const res = await request(ctx.app).get('/storage/.tmp/secret.webp');
    assert.equal(res.status, 404);
  });

  it('re-renders into the same URL when the cached file is deleted', async () => {
    const created = await request(ctx.app)
      .post('/api/v1/maps')
      .send({ lat: 21.1, lon: 22.2, place: 'Gone' });
    assert.equal(created.status, 201);
    const fileName = fileNameFromUrl(created.body.url);
    await waitForWebp(ctx.app, fileName);
    await fs.unlink(path.join(ctx.storageDir, fileName));

    const again = await request(ctx.app)
      .post('/api/v1/maps')
      .send({ lat: 21.1, lon: 22.2, place: 'Gone' });
    assert.equal(again.body.id, created.body.id);
    assert.equal(again.body.url, created.body.url);
    assert.equal(again.body.cached, false);
    await waitForWebp(ctx.app, fileName);
  });

  it('returns 409 when idempotency key is already in progress', async () => {
    await stopTestApp(ctx);
    let releaseAccept: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseAccept = resolve;
    });

    ctx = await startTestApp({
      enableWorker: false,
      beforeAccept: () => gate,
    });

    const body = { items: [{ lat: 40, lon: 40 }] };
    const firstPromise = request(ctx.app)
      .post('/api/v1/maps/batch')
      .set('idempotency-key', 'slow-batch')
      .send(body);
    void firstPromise.catch(() => undefined);

    const started = Date.now();
    let reserved = false;
    while (Date.now() - started < 5000) {
      const record = await ctx.prisma.idempotencyRecord.findUnique({
        where: { key: 'slow-batch' },
      });
      if (record?.status === 'processing') {
        reserved = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 30));
    }
    assert.equal(reserved, true);

    const second = await request(ctx.app)
      .post('/api/v1/maps/batch')
      .set('idempotency-key', 'slow-batch')
      .send(body);

    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'IDEMPOTENCY_IN_PROGRESS');
    releaseAccept?.();
    const firstRes = await firstPromise;
    assert.equal(firstRes.status, 200);
  });
});
