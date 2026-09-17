import type { MapJob, MapJobItem, PrismaClient, JobItemStatus, JobStatus } from '@prisma/client';
import { getPrisma } from '../lib/prisma.js';

export type CreateJobItemInput = {
  index: number;
  lat: number;
  lon: number;
  place?: string | null;
  mapId?: string | null;
  url?: string | null;
  cached?: boolean | null;
};

export class JobRepository {
  constructor(private readonly db: PrismaClient = getPrisma()) {}

  async createJob(items: CreateJobItemInput[]): Promise<MapJob> {
    return this.db.mapJob.create({
      data: {
        status: 'queued',
        total: items.length,
        queued: items.length,
        items: {
          create: items.map((item) => ({
            index: item.index,
            lat: item.lat,
            lon: item.lon,
            place: item.place ?? null,
            status: 'queued',
            mapId: item.mapId ?? null,
            url: item.url ?? null,
            cached: item.cached ?? null,
          })),
        },
      },
    });
  }

  findJob(id: string): Promise<MapJob | null> {
    return this.db.mapJob.findUnique({ where: { id } });
  }

  countActiveJobs(): Promise<number> {
    return this.db.mapJob.count({
      where: { status: { in: ['queued', 'running'] } },
    });
  }

  async claimNextItem(): Promise<MapJobItem | null> {
    const item = await this.db.mapJobItem.findFirst({
      where: {
        status: 'queued',
        job: { cancelRequested: false, status: { in: ['queued', 'running'] } },
      },
      orderBy: [{ createdAt: 'asc' }, { index: 'asc' }],
    });

    if (!item) return null;

    const updated = await this.db.mapJobItem.updateMany({
      where: { id: item.id, status: 'queued' },
      data: {
        status: 'running',
        startedAt: new Date(),
        attempts: { increment: 1 },
      },
    });

    if (updated.count === 0) {
      return this.claimNextItem();
    }

    await this.recomputeJobCounters(item.jobId);
    return this.db.mapJobItem.findUniqueOrThrow({ where: { id: item.id } });
  }

  async markItemSucceeded(
    itemId: string,
    data: { mapId: string; url: string; cached: boolean },
  ): Promise<MapJobItem> {
    const item = await this.db.mapJobItem.update({
      where: { id: itemId },
      data: {
        status: 'succeeded',
        mapId: data.mapId,
        url: data.url,
        cached: data.cached,
        finishedAt: new Date(),
        lastErrorCode: null,
        lastErrorMsg: null,
      },
    });
    await this.recomputeJobCounters(item.jobId);
    return item;
  }

  async markItemFailed(itemId: string, code: string, message: string): Promise<MapJobItem> {
    const item = await this.db.mapJobItem.update({
      where: { id: itemId },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        lastErrorCode: code,
        lastErrorMsg: message.slice(0, 500),
      },
    });
    await this.recomputeJobCounters(item.jobId);
    return item;
  }

  async requestCancel(jobId: string): Promise<MapJob | null> {
    const job = await this.findJob(jobId);
    if (!job) return null;

    await this.db.mapJob.update({
      where: { id: jobId },
      data: { cancelRequested: true },
    });

    await this.db.mapJobItem.updateMany({
      where: { jobId, status: 'queued' },
      data: { status: 'cancelled', finishedAt: new Date() },
    });

    await this.recomputeJobCounters(jobId);
    return this.findJob(jobId);
  }

  async retryFailedItems(jobId: string): Promise<number> {
    const result = await this.db.mapJobItem.updateMany({
      where: { jobId, status: 'failed' },
      data: {
        status: 'queued',
        finishedAt: null,
        lastErrorCode: null,
        lastErrorMsg: null,
      },
    });

    if (result.count > 0) {
      await this.db.mapJob.update({
        where: { id: jobId },
        data: {
          status: 'queued',
          cancelRequested: false,
          finishedAt: null,
        },
      });
      await this.recomputeJobCounters(jobId);
    }

    return result.count;
  }

  async recoverInterruptedItems(): Promise<number> {
    const result = await this.db.mapJobItem.updateMany({
      where: { status: 'running' },
      data: {
        status: 'queued',
        startedAt: null,
      },
    });

    const jobs = await this.db.mapJob.findMany({
      where: { status: { in: ['queued', 'running'] } },
      select: { id: true },
    });

    for (const job of jobs) {
      await this.recomputeJobCounters(job.id);
    }

    return result.count;
  }

  async listItems(
    jobId: string,
    options: { cursor?: number; limit: number },
  ): Promise<{ items: MapJobItem[]; nextCursor: number | null }> {
    const items = await this.db.mapJobItem.findMany({
      where: {
        jobId,
        ...(options.cursor !== undefined ? { index: { gt: options.cursor } } : {}),
      },
      orderBy: { index: 'asc' },
      take: options.limit + 1,
    });

    const hasMore = items.length > options.limit;
    const page = hasMore ? items.slice(0, options.limit) : items;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? last.index : null;
    return { items: page, nextCursor };
  }

  private async recomputeJobCounters(jobId: string): Promise<void> {
    const grouped = await this.db.mapJobItem.groupBy({
      by: ['status'],
      where: { jobId },
      _count: { _all: true },
    });

    const counts: Record<JobItemStatus, number> = {
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
    };

    for (const row of grouped) {
      counts[row.status] = row._count._all;
    }

    const total =
      counts.queued + counts.running + counts.succeeded + counts.failed + counts.cancelled;

    let status: JobStatus;
    if (counts.running > 0) {
      status = 'running';
    } else if (counts.queued > 0) {
      status = 'queued';
    } else if (counts.cancelled === total) {
      status = 'cancelled';
    } else if (counts.failed > 0 && counts.succeeded === 0) {
      status = 'failed';
    } else if (counts.failed > 0) {
      status = 'partial';
    } else {
      status = 'succeeded';
    }

    const finished = counts.queued === 0 && counts.running === 0;

    await this.db.mapJob.update({
      where: { id: jobId },
      data: {
        queued: counts.queued,
        running: counts.running,
        succeeded: counts.succeeded,
        failed: counts.failed,
        cancelled: counts.cancelled,
        status,
        finishedAt: finished ? new Date() : null,
      },
    });
  }
}
