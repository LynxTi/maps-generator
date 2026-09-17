import { getPrisma } from './prisma.js';
import { logger } from './logger.js';

type IndexSpec = {
  collection: string;
  name: string;
  key: Record<string, 1 | -1>;
  unique?: boolean;
};

const INDEXES: IndexSpec[] = [
  {
    collection: 'maps',
    name: 'latKey_lonKey_renderVersion',
    key: { latKey: 1, lonKey: 1, renderVersion: 1 },
    unique: true,
  },
  { collection: 'maps', name: 'maps_createdAt', key: { createdAt: 1 } },
  { collection: 'maps', name: 'maps_status', key: { status: 1 } },
  { collection: 'jobs', name: 'jobs_status_createdAt', key: { status: 1, createdAt: 1 } },
  { collection: 'job_items', name: 'job_items_jobId_status', key: { jobId: 1, status: 1 } },
  { collection: 'job_items', name: 'job_items_jobId_index', key: { jobId: 1, index: 1 } },
  { collection: 'job_items', name: 'job_items_status_updatedAt', key: { status: 1, updatedAt: 1 } },
  {
    collection: 'idempotency_records',
    name: 'idempotency_records_key',
    key: { key: 1 },
    unique: true,
  },
  {
    collection: 'idempotency_records',
    name: 'idempotency_records_expiresAt',
    key: { expiresAt: 1 },
  },
];

export async function ensureIndexes(): Promise<void> {
  const db = getPrisma();

  for (const spec of INDEXES) {
    try {
      await db.$runCommandRaw({
        createIndexes: spec.collection,
        indexes: [
          {
            key: spec.key,
            name: spec.name,
            unique: spec.unique ?? false,
          },
        ],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes('already exists') ||
        message.includes('IndexOptionsConflict') ||
        message.includes('IndexKeySpecsConflict')
      ) {
        continue;
      }
      logger.warn({ err: error, index: spec.name }, 'Failed to ensure Mongo index');
    }
  }
}
