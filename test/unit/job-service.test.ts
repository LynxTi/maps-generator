import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';
import { loadEnv, resetEnvCache } from '../../src/config/env.js';
import { JobService } from '../../src/services/job-service.js';
import { MapService } from '../../src/services/map-service.js';

describe('JobService batch mode', () => {
  before(() => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'mongodb://127.0.0.1:27017/test';
    process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
    process.env.LOG_LEVEL = 'silent';
    process.env.SYNC_BATCH_LIMIT = '2';
    process.env.MAX_BATCH_ITEMS = '10';
    process.env.MAX_QUEUED_JOBS = '5';
    resetEnvCache();
    loadEnv();
  });

  it('reserves URLs immediately for small batches and isolates accept failures', async () => {
    const mapService = {
      async acceptMap(input: { lat: number }) {
        if (input.lat === 1) {
          throw new Error('boom');
        }
        return {
          id: 'm1',
          url: 'http://localhost:3000/storage/a.webp',
          lat: input.lat,
          lon: 0,
          place: null,
          cached: false,
          status: 'pending',
          renderVersion: 'v1',
          created: true,
        };
      },
    } as unknown as MapService;

    const service = new JobService({
      mapService,
      syncBatchLimit: 2,
      maxBatchItems: 10,
      jobRepository: {
        countActiveJobs: async () => 0,
        createJob: async () => {
          throw new Error('should not create job');
        },
      } as never,
    });

    const result = await service.processBatch([
      { lat: 0, lon: 0 },
      { lat: 1, lon: 0 },
    ]);

    assert.equal(result.statusCode, 200);
    assert.equal(result.body.mode, 'sync');
    if (result.body.mode === 'sync') {
      assert.equal(result.body.created, 1);
      assert.equal(result.body.failed, 1);
      assert.equal(result.body.items.length, 2);
      const ok = result.body.items.find((item) => item.ok);
      assert.ok(ok && ok.ok && ok.url);
    }
  });

  it('creates async job with reserved URLs when over sync limit', async () => {
    const service = new JobService({
      syncBatchLimit: 2,
      maxBatchItems: 10,
      maxQueuedJobs: 5,
      mapService: {
        async acceptMap(input: { lat: number; lon: number }) {
          return {
            id: `m-${input.lat}`,
            url: `http://localhost:3000/storage/${input.lat}.webp`,
            lat: input.lat,
            lon: input.lon,
            place: null,
            cached: false,
            status: 'pending',
            renderVersion: 'v1',
            created: true,
          };
        },
      } as unknown as MapService,
      jobRepository: {
        countActiveJobs: async () => 0,
        createJob: async (items: unknown[]) => ({
          id: 'job1',
          status: 'queued',
          total: items.length,
        }),
      } as never,
    });

    const result = await service.processBatch([
      { lat: 0, lon: 0 },
      { lat: 1, lon: 1 },
      { lat: 2, lon: 2 },
    ]);

    assert.equal(result.statusCode, 202);
    assert.equal(result.body.mode, 'async');
    if (result.body.mode === 'async') {
      assert.equal(result.body.jobId, 'job1');
      assert.equal(result.body.total, 3);
      assert.equal(result.body.items.length, 3);
      assert.equal(result.body.items[0]?.ok, true);
      if (result.body.items[0]?.ok) {
        assert.match(result.body.items[0].url, /\/storage\/0\.webp$/);
      }
    }
  });
});
