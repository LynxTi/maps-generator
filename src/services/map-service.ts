import type { GeneratedMap } from '@prisma/client';
import { getEnv } from '../config/env.js';
import {
  buildPublicUrl,
  coordinateSeed,
  toCoordinateKey,
} from '../lib/coordinates.js';
import { AppError, isAppError } from '../lib/errors.js';
import { AsyncQueue } from '../lib/queue.js';
import { logger } from '../lib/logger.js';
import { MapRepository } from '../repositories/map-repository.js';
import { LocalStorage } from '../storage/local-storage.js';
import type {
  GetOrCreateMapOptions,
  MapAcceptResult,
  MapRequest,
  MapResponse,
  RenderMap,
} from '../types/domain.js';
import { renderRealMap } from '../render/variant2.js';

export type MapServiceDeps = {
  mapRepository?: MapRepository;
  storage?: LocalStorage;
  renderMap?: RenderMap;
  queue?: AsyncQueue;
  publicBaseUrl?: string;
  renderVersion?: string;
  maxRenderQueue?: number;
  maxAttempts?: number;
  retryBackoffMs?: number;
  beforeAccept?: () => Promise<void>;
};

export class MapService {
  private readonly maps: MapRepository;
  private readonly storage: LocalStorage;
  private readonly renderMap: RenderMap;
  private readonly queue: AsyncQueue;
  private readonly publicBaseUrl: string;
  private readonly renderVersion: string;
  private readonly maxRenderQueue: number;
  private readonly maxAttempts: number;
  private readonly retryBackoffMs: number;
  private readonly beforeAccept: (() => Promise<void>) | undefined;
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(deps: MapServiceDeps = {}) {
    const env = getEnv();
    this.maps = deps.mapRepository ?? new MapRepository();
    this.storage = deps.storage ?? new LocalStorage();
    this.renderMap = deps.renderMap ?? renderRealMap;
    this.queue = deps.queue ?? new AsyncQueue(env.RENDER_CONCURRENCY);
    this.publicBaseUrl = deps.publicBaseUrl ?? env.PUBLIC_BASE_URL;
    this.renderVersion = deps.renderVersion ?? env.RENDER_VERSION;
    this.maxRenderQueue = deps.maxRenderQueue ?? env.MAX_RENDER_QUEUE;
    this.maxAttempts = deps.maxAttempts ?? env.RENDER_MAX_ATTEMPTS;
    this.retryBackoffMs = deps.retryBackoffMs ?? env.RENDER_RETRY_BACKOFF_MS;
    this.beforeAccept = deps.beforeAccept;
  }

  getQueueDepth(): number {
    return this.queue.pending + this.queue.running;
  }

  async getOrCreateMap(
    input: MapRequest,
    options: GetOrCreateMapOptions = {},
  ): Promise<MapResponse> {
    const result = await this.acceptMap(input, {
      ...options,
      enqueue: true,
      wait: true,
    });
    if (result.status === 'failed') {
      throw new AppError(500, 'RENDER_FAILED', 'Failed to render map image');
    }
    return result;
  }

  async acceptMap(
    input: MapRequest,
    options: GetOrCreateMapOptions = {},
  ): Promise<MapAcceptResult> {
    if (this.beforeAccept) {
      await this.beforeAccept();
    }
    this.validateCoordinates(input.lat, input.lon);

    const enqueue = options.enqueue !== false;
    const wait = options.wait === true;
    const { record, created } = await this.reserve(input);
    const fileExists = await this.storage.exists(record.filename);
    const cached = fileExists && record.status === 'ready';

    if (!cached && enqueue) {
      const rendering = this.kickRender(record, input, options);
      if (wait) {
        await rendering;
        const latest =
          (await this.maps.findByKey(record.latKey, record.lonKey, this.renderVersion)) ?? record;
        return this.toAcceptResult(latest, cached, created);
      }
      void rendering.catch((error) => {
        logger.error({ err: error }, 'Background map render failed');
      });
    }

    return this.toAcceptResult(record, cached, created, !cached && enqueue);
  }

  private async reserve(
    input: MapRequest,
  ): Promise<{ record: GeneratedMap; created: boolean }> {
    const { latKey, lonKey } = toCoordinateKey(input.lat, input.lon);
    const existing = await this.maps.findByKey(latKey, lonKey, this.renderVersion);
    if (existing) {
      return { record: existing, created: false };
    }

    await this.storage.ensureReady();
    const final = this.storage.createFinalPath();
    const created = await this.maps.createIgnoringDuplicate({
      lat: input.lat,
      lon: input.lon,
      latKey,
      lonKey,
      place: input.place ?? null,
      filename: final.filename,
      urlPath: final.urlPath,
      renderVersion: this.renderVersion,
    });

    return {
      record: created,
      created: created.filename === final.filename,
    };
  }

  private kickRender(
    record: GeneratedMap,
    input: MapRequest,
    options: GetOrCreateMapOptions,
  ): Promise<void> {
    const key = `${record.latKey}:${record.lonKey}:${this.renderVersion}`;
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing;
    }

    if (!options.ignoreBackpressure && this.getQueueDepth() >= this.maxRenderQueue) {
      throw new AppError(429, 'QUEUE_SATURATED', 'Render queue is full, retry later');
    }

    const promise = this.runRender(record, input, key);
    this.inFlight.set(key, promise);
    return promise;
  }

  private async runRender(record: GeneratedMap, input: MapRequest, key: string): Promise<void> {
    try {
      const fileExists = await this.storage.exists(record.filename);
      if (fileExists && record.status === 'ready') {
        return;
      }
      if (record.status === 'failed' || (record.status === 'ready' && !fileExists)) {
        await this.maps.markPending(record.id);
      }
      await this.queue.add(() => this.renderReserved(record, input));
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async renderReserved(record: GeneratedMap, input: MapRequest): Promise<void> {
    const fileExists = await this.storage.exists(record.filename);
    if (fileExists) {
      await this.maps.markReady(record.id);
      return;
    }

    const final = this.storage.createFinalPath(record.filename);
    const seedText = coordinateSeed(record.latKey, record.lonKey, this.renderVersion);
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const tempPath = this.storage.createTempPath();
      try {
        await this.maps.incrementAttempts(record.id);
        await this.storage.ensureReady();
        await this.renderMap({
          lat: input.lat,
          lon: input.lon,
          outputPath: tempPath,
          seedText,
        });
        await this.storage.commitTempFile(tempPath, final.absolutePath);
        await this.maps.markReady(record.id);
        return;
      } catch (error) {
        lastError = error;
        await this.storage.deleteIfExists(tempPath);
        logger.error({ err: error, attempt, mapId: record.id }, 'Failed to render map');
        if (attempt < this.maxAttempts) {
          await this.sleep(this.retryBackoffMs * attempt);
        }
      }
    }

    const code = isAppError(lastError) ? lastError.code : 'RENDER_FAILED';
    const message = isAppError(lastError)
      ? lastError.message
      : lastError instanceof Error
        ? lastError.message
        : 'Failed to render map image';
    await this.maps.markFailed(record.id, code, message);
  }

  private toAcceptResult(
    record: GeneratedMap,
    cached: boolean,
    created: boolean,
    rendering = false,
  ): MapAcceptResult {
    return {
      id: record.id,
      url: buildPublicUrl(this.publicBaseUrl, record.urlPath),
      lat: record.lat,
      lon: record.lon,
      place: record.place,
      cached,
      status: cached ? 'ready' : rendering ? 'pending' : record.status,
      renderVersion: record.renderVersion,
      created,
    };
  }

  private sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private validateCoordinates(lat: number, lon: number): void {
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw new AppError(400, 'INVALID_COORDINATES', 'lat must be between -90 and 90');
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      throw new AppError(400, 'INVALID_COORDINATES', 'lon must be between -180 and 180');
    }
  }
}
