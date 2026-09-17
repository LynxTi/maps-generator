import { logger } from '../lib/logger.js';
import { isAppError } from '../lib/errors.js';
import { JobRepository } from '../repositories/job-repository.js';
import { MapService } from '../services/map-service.js';

export type JobWorkerDeps = {
  jobRepository?: JobRepository;
  mapService?: MapService;
  pollIntervalMs?: number;
};

export class JobWorker {
  private readonly jobs: JobRepository;
  private readonly maps: MapService;
  private readonly pollIntervalMs: number;
  private running = false;
  private stopped = true;
  private loopPromise: Promise<void> | null = null;
  private wakeSleep: (() => void) | null = null;
  private sleepTimer: NodeJS.Timeout | null = null;

  constructor(deps: JobWorkerDeps = {}) {
    this.jobs = deps.jobRepository ?? new JobRepository();
    this.maps = deps.mapService ?? new MapService();
    this.pollIntervalMs = deps.pollIntervalMs ?? 250;
  }

  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    const recovered = await this.jobs.recoverInterruptedItems();
    if (recovered > 0) {
      logger.info({ recovered }, 'Recovered interrupted job items');
    }
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.sleepTimer) {
      clearTimeout(this.sleepTimer);
      this.sleepTimer = null;
    }
    if (this.wakeSleep) {
      this.wakeSleep();
      this.wakeSleep = null;
    }
    if (this.loopPromise) {
      await this.loopPromise;
      this.loopPromise = null;
    }
    while (this.running) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      this.running = true;
      try {
        const item = await this.jobs.claimNextItem();
        if (!item) {
          this.running = false;
          await this.sleep(this.pollIntervalMs);
          continue;
        }

        try {
          const result = await this.maps.getOrCreateMap(
            {
              lat: item.lat,
              lon: item.lon,
              ...(item.place ? { place: item.place } : {}),
            },
            { ignoreBackpressure: true },
          );
          await this.jobs.markItemSucceeded(item.id, {
            mapId: result.id,
            url: result.url,
            cached: result.cached,
          });
        } catch (error) {
          const code = isAppError(error) ? error.code : 'RENDER_FAILED';
          const message = isAppError(error)
            ? error.message
            : error instanceof Error
              ? error.message
              : 'Unknown error';
          await this.jobs.markItemFailed(item.id, code, message);
        }
      } catch (error) {
        logger.error({ err: error }, 'Job worker tick failed');
        await this.sleep(this.pollIntervalMs);
      } finally {
        this.running = false;
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.wakeSleep = resolve;
      this.sleepTimer = setTimeout(() => {
        this.sleepTimer = null;
        this.wakeSleep = null;
        resolve();
      }, ms);
    });
  }
}
