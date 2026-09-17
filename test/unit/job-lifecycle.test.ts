import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';
import { loadEnv, resetEnvCache } from '../../src/config/env.js';
import { AppError } from '../../src/lib/errors.js';
import { JobService } from '../../src/services/job-service.js';
import type { MapService } from '../../src/services/map-service.js';

describe('JobService job lifecycle helpers', () => {
  before(() => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'mongodb://127.0.0.1:27017/test';
    process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
    process.env.LOG_LEVEL = 'silent';
    resetEnvCache();
    loadEnv();
  });

  it('returns progress, cancel and retry for existing jobs', async () => {
    const job = {
      id: 'job1',
      status: 'failed',
      total: 2,
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 2,
      cancelled: 0,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      finishedAt: new Date('2024-01-01T00:00:01.000Z'),
    };

    const service = new JobService({
      mapService: {} as MapService,
      jobRepository: {
        findJob: async (id: string) => (id === 'job1' ? job : null),
        requestCancel: async () => job,
        retryFailedItems: async () => 1,
        listItems: async () => ({
          items: [
            {
              id: 'item1',
              index: 0,
              status: 'queued',
              lat: 1,
              lon: 2,
              place: null,
              mapId: null,
              url: null,
              cached: null,
              lastErrorCode: null,
              lastErrorMsg: null,
            },
          ],
          nextCursor: null,
        }),
      } as never,
    });

    const progress = await service.getJobProgress('job1');
    assert.equal(progress.id, 'job1');
    assert.equal(progress.status, 'failed');

    const cancelled = await service.cancelJob('job1');
    assert.equal(cancelled.id, 'job1');

    const retried = await service.retryJob('job1');
    assert.equal(retried.id, 'job1');

    const items = await service.listJobItems('job1', undefined, 10);
    assert.equal(items.items.length, 1);
  });

  it('throws when job is missing', async () => {
    const service = new JobService({
      mapService: {} as MapService,
      jobRepository: {
        findJob: async () => null,
      } as never,
    });

    await assert.rejects(
      () => service.getJobProgress('missing'),
      (err: unknown) => err instanceof AppError && err.code === 'JOB_NOT_FOUND',
    );
  });

  it('rejects retry while job is still active', async () => {
    const service = new JobService({
      mapService: {} as MapService,
      jobRepository: {
        findJob: async () => ({
          id: 'job1',
          status: 'running',
        }),
      } as never,
    });

    await assert.rejects(
      () => service.retryJob('job1'),
      (err: unknown) => err instanceof AppError && err.code === 'JOB_STILL_ACTIVE',
    );
  });
});
