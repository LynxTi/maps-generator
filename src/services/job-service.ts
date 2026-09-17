import { getEnv } from '../config/env.js';
import { AppError, isAppError } from '../lib/errors.js';
import { JobRepository } from '../repositories/job-repository.js';
import type {
  AsyncBatchResponse,
  BatchItemResult,
  JobProgressResponse,
  MapAcceptResult,
  MapRequest,
  SyncBatchResponse,
} from '../types/domain.js';
import { MapService } from './map-service.js';

export type JobServiceDeps = {
  jobRepository?: JobRepository;
  mapService?: MapService;
  syncBatchLimit?: number;
  maxBatchItems?: number;
  maxQueuedJobs?: number;
};

const TERMINAL_JOB_STATUSES = new Set(['succeeded', 'partial', 'failed', 'cancelled']);

export class JobService {
  private readonly jobs: JobRepository;
  private readonly maps: MapService;
  private readonly syncBatchLimit: number;
  private readonly maxBatchItems: number;
  private readonly maxQueuedJobs: number;

  constructor(deps: JobServiceDeps = {}) {
    const env = getEnv();
    this.jobs = deps.jobRepository ?? new JobRepository();
    this.maps = deps.mapService ?? new MapService();
    this.syncBatchLimit = deps.syncBatchLimit ?? env.SYNC_BATCH_LIMIT;
    this.maxBatchItems = deps.maxBatchItems ?? env.MAX_BATCH_ITEMS;
    this.maxQueuedJobs = deps.maxQueuedJobs ?? env.MAX_QUEUED_JOBS;
  }

  async processBatch(
    items: MapRequest[],
  ): Promise<{ statusCode: number; body: SyncBatchResponse | AsyncBatchResponse }> {
    if (items.length === 0) {
      throw new AppError(400, 'EMPTY_BATCH', 'items must not be empty');
    }
    if (items.length > this.maxBatchItems) {
      throw new AppError(
        400,
        'BATCH_TOO_LARGE',
        `items must contain at most ${this.maxBatchItems} entries`,
      );
    }

    if (items.length <= this.syncBatchLimit) {
      const body = await this.runSyncBatch(items);
      return { statusCode: 200, body };
    }

    const active = await this.jobs.countActiveJobs();
    if (active >= this.maxQueuedJobs) {
      throw new AppError(429, 'TOO_MANY_JOBS', 'Too many active batch jobs');
    }

    const reserved: MapAcceptResult[] = [];
    for (const item of items) {
      reserved.push(await this.maps.acceptMap(item, { enqueue: false }));
    }

    const job = await this.jobs.createJob(
      reserved.map((item, index) => ({
        index,
        lat: item.lat,
        lon: item.lon,
        place: item.place,
        mapId: item.id,
        url: item.url,
        cached: item.cached,
      })),
    );

    return {
      statusCode: 202,
      body: {
        mode: 'async',
        jobId: job.id,
        total: job.total,
        status: job.status,
        items: reserved.map((item, index) => this.toBatchItem(item, index)),
      },
    };
  }

  async getJobProgress(jobId: string): Promise<JobProgressResponse> {
    const job = await this.jobs.findJob(jobId);
    if (!job) {
      throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found');
    }

    return {
      id: job.id,
      status: job.status,
      total: job.total,
      queued: job.queued,
      running: job.running,
      succeeded: job.succeeded,
      failed: job.failed,
      cancelled: job.cancelled,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
    };
  }

  async listJobItems(jobId: string, cursor: number | undefined, limit: number) {
    const job = await this.jobs.findJob(jobId);
    if (!job) {
      throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found');
    }

    const page = await this.jobs.listItems(jobId, {
      ...(cursor !== undefined ? { cursor } : {}),
      limit,
    });
    return {
      jobId,
      nextCursor: page.nextCursor,
      items: page.items.map((item) => ({
        id: item.id,
        index: item.index,
        status: item.status,
        lat: item.lat,
        lon: item.lon,
        place: item.place,
        mapId: item.mapId,
        url: item.url,
        cached: item.cached,
        error:
          item.lastErrorCode && item.lastErrorMsg
            ? { code: item.lastErrorCode, message: item.lastErrorMsg }
            : null,
      })),
    };
  }

  async cancelJob(jobId: string): Promise<JobProgressResponse> {
    const job = await this.jobs.requestCancel(jobId);
    if (!job) {
      throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found');
    }
    return this.getJobProgress(jobId);
  }

  async retryJob(jobId: string): Promise<JobProgressResponse> {
    const job = await this.jobs.findJob(jobId);
    if (!job) {
      throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found');
    }
    if (!TERMINAL_JOB_STATUSES.has(job.status)) {
      throw new AppError(409, 'JOB_STILL_ACTIVE', 'Cannot retry a job that is still running');
    }
    await this.jobs.retryFailedItems(jobId);
    return this.getJobProgress(jobId);
  }

  private async runSyncBatch(items: MapRequest[]): Promise<SyncBatchResponse> {
    const results: BatchItemResult[] = [];
    let created = 0;
    let cached = 0;
    let failed = 0;

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]!;
      try {
        const map = await this.maps.acceptMap(item);
        results.push(this.toBatchItem(map, index));
        if (map.cached) cached += 1;
        else created += 1;
      } catch (error) {
        failed += 1;
        if (isAppError(error)) {
          results.push({
            ok: false,
            index,
            error: { code: error.code, message: error.message },
          });
        } else {
          results.push({
            ok: false,
            index,
            error: { code: 'RENDER_FAILED', message: 'Failed to render map image' },
          });
        }
      }
    }

    return {
      mode: 'sync',
      total: items.length,
      created,
      cached,
      failed,
      items: results,
    };
  }

  private toBatchItem(map: MapAcceptResult, index: number): BatchItemResult {
    return {
      ok: true,
      index,
      id: map.id,
      url: map.url,
      lat: map.lat,
      lon: map.lon,
      place: map.place,
      cached: map.cached,
      status: map.status,
      renderVersion: map.renderVersion,
    };
  }
}
