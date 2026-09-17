import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  PUBLIC_BASE_URL: z
    .string()
    .url()
    .transform((value) => value.replace(/\/+$/, '')),
  DATABASE_URL: z.string().min(1),
  STORAGE_DIR: z.string().default('./storage'),
  RENDER_VERSION: z.string().min(1).default('v1'),
  RENDER_CONCURRENCY: z.coerce.number().int().min(1).max(2).default(1),
  SYNC_BATCH_LIMIT: z.coerce.number().int().min(1).max(100).default(50),
  MAX_BATCH_ITEMS: z.coerce.number().int().min(1).max(5000).default(2000),
  MAX_QUEUED_JOBS: z.coerce.number().int().min(1).max(100).default(10),
  MAX_RENDER_QUEUE: z.coerce.number().int().min(1).max(500).default(50),
  RENDER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  RENDER_RETRY_BACKOFF_MS: z.coerce.number().int().min(0).max(60_000).default(1000),
  JOB_POLL_DEFAULT_LIMIT: z.coerce.number().int().min(1).max(500).default(100),
  ENABLE_DOCS: z.string().optional(),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  TILE_FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  TILE_FETCH_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  CORS_ORIGIN: z.string().optional().default(''),
});

export type Env = Omit<z.infer<typeof envSchema>, 'ENABLE_DOCS'> & {
  ENABLE_DOCS: boolean;
};

let cached: Env | undefined;

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  const enableDocsRaw = parsed.data.ENABLE_DOCS;
  const enableDocs =
    enableDocsRaw === undefined
      ? parsed.data.NODE_ENV !== 'production'
      : enableDocsRaw === 'true' || enableDocsRaw === '1';

  cached = {
    ...parsed.data,
    ENABLE_DOCS: enableDocs,
  };
  return cached;
}

export function getEnv(): Env {
  if (!cached) {
    return loadEnv();
  }
  return cached;
}

export function resetEnvCache(): void {
  cached = undefined;
}
