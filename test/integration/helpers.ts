import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { PrismaClient } from '@prisma/client';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { loadEnv, resetEnvCache } from '../../src/config/env.js';
import { setPrisma, disconnectPrisma } from '../../src/lib/prisma.js';
import { ensureIndexes } from '../../src/lib/ensure-indexes.js';
import { createApp, type AppContext } from '../../src/api/app.js';
import { LocalStorage } from '../../src/storage/local-storage.js';
import { MapService } from '../../src/services/map-service.js';
import type { RenderMap } from '../../src/types/domain.js';

export type TestContext = AppContext & {
  prisma: PrismaClient;
  replSet: MongoMemoryReplSet;
  storageDir: string;
};

export async function startTestApp(options?: {
  renderMap?: RenderMap;
  enableWorker?: boolean;
  beforeAccept?: () => Promise<void>;
}): Promise<TestContext> {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  const uri = replSet.getUri('map_images_test');

  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-api-'));

  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = uri;
  process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
  process.env.STORAGE_DIR = storageDir;
  process.env.LOG_LEVEL = 'silent';
  process.env.ENABLE_DOCS = 'true';
  process.env.SYNC_BATCH_LIMIT = '2';
  process.env.MAX_BATCH_ITEMS = '20';
  process.env.MAX_QUEUED_JOBS = '5';
  process.env.MAX_RENDER_QUEUE = process.env.MAX_RENDER_QUEUE ?? '50';
  process.env.RENDER_VERSION = 'v1';
  process.env.RENDER_MAX_ATTEMPTS = '2';
  process.env.RENDER_RETRY_BACKOFF_MS = '1';
  resetEnvCache();
  loadEnv();

  const prisma = new PrismaClient({ datasources: { db: { url: uri } } });
  await prisma.$connect();
  setPrisma(prisma);
  await ensureIndexes();

  const storage = new LocalStorage(storageDir);
  const renderMap: RenderMap =
    options?.renderMap ??
    (async ({ outputPath }) => {
      await sharp({
        create: {
          width: 64,
          height: 32,
          channels: 3,
          background: { r: 210, g: 190, b: 150 },
        },
      })
        .webp()
        .toFile(outputPath);
      return outputPath;
    });

  const mapService = new MapService({
    storage,
    renderMap,
    retryBackoffMs: 1,
    maxAttempts: 2,
    ...(options?.beforeAccept ? { beforeAccept: options.beforeAccept } : {}),
  });

  const ctx = await createApp({
    storage,
    mapService,
    enableWorker: options?.enableWorker ?? true,
  });

  return { ...ctx, prisma, replSet, storageDir };
}

export async function stopTestApp(ctx: TestContext): Promise<void> {
  if (ctx.worker) {
    await ctx.worker.stop();
  }
  await disconnectPrisma();
  await ctx.prisma.$disconnect();
  await ctx.replSet.stop();
  await fs.rm(ctx.storageDir, { recursive: true, force: true });
}
