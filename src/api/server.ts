import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import { loadEnv, getEnv } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { disconnectPrisma } from '../lib/prisma.js';
import { ensureIndexes } from '../lib/ensure-indexes.js';
import { createApp } from './app.js';

function loadDotEnvFile(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function main(): Promise<void> {
  loadDotEnvFile();
  loadEnv();
  const env = getEnv();

  await ensureIndexes();
  const { app, worker } = await createApp();
  const server = app.listen(env.PORT, env.HOST, () => {
    logger.info({ host: env.HOST, port: env.PORT }, 'Map API listening');
    if (env.ENABLE_DOCS) {
      logger.info({ docs: `${env.PUBLIC_BASE_URL}/docs` }, 'Swagger UI');
    }
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    try {
      await closeServer(server);
      if (worker) {
        await worker.stop();
      }
      await disconnectPrisma();
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'Shutdown failed');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

const isDirectRun = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectRun) {
  main().catch((error) => {
    logger.error({ err: error }, 'Fatal startup error');
    process.exit(1);
  });
}
