import { Router } from 'express';
import { getEnv } from '../../config/env.js';
import { getPrisma } from '../../lib/prisma.js';
import { hashJson } from '../../lib/hash.js';
import { AppError } from '../../lib/errors.js';
import { LocalStorage } from '../../storage/local-storage.js';
import type { JobService } from '../../services/job-service.js';
import type { MapService } from '../../services/map-service.js';
import { batchRequestSchema, mapRequestSchema } from '../../schemas/maps.js';
import { IdempotencyRepository } from '../../repositories/idempotency-repository.js';
import { validateBody } from '../middleware/error-handler.js';

export type ApiDeps = {
  mapService: MapService;
  jobService: JobService;
  storage: LocalStorage;
};

export function createApiRouter(deps: ApiDeps): Router {
  const router = Router();
  const env = getEnv();
  const idempotency = new IdempotencyRepository();

  router.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  router.get('/readyz', async (_req, res, next) => {
    try {
      let mongo = false;
      let storageOk = false;

      try {
        await getPrisma().$runCommandRaw({ ping: 1 });
        mongo = true;
      } catch {
        mongo = false;
      }

      try {
        await deps.storage.ensureReady();
        storageOk = true;
      } catch {
        storageOk = false;
      }

      if (!mongo || !storageOk) {
        res.status(503).json({
          error: {
            code: 'NOT_READY',
            message: 'Service dependencies are not ready',
            details: { mongo, storage: storageOk },
          },
        });
        return;
      }

      res.json({ status: 'ready', mongo, storage: storageOk });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    '/api/v1/maps',
    validateBody(mapRequestSchema),
    async (req, res, next) => {
      try {
        const result = await deps.mapService.acceptMap(req.body);
        const { created, ...body } = result;
        res.status(result.cached ? 200 : created ? 201 : 200).json(body);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/api/v1/maps/batch',
    validateBody(batchRequestSchema),
    async (req, res, next) => {
      try {
        const idempotencyKey = req.header('idempotency-key')?.trim();
        if (idempotencyKey) {
          const reserved = await idempotency.reserve(idempotencyKey, hashJson(req.body));
          if (reserved.kind === 'completed') {
            res.status(reserved.responseCode).json(reserved.responseBody);
            return;
          }
          if (reserved.kind === 'in_progress') {
            throw new AppError(
              409,
              'IDEMPOTENCY_IN_PROGRESS',
              'A request with this Idempotency-Key is already being processed',
            );
          }

          try {
            const result = await deps.jobService.processBatch(req.body.items);
            await idempotency.complete(idempotencyKey, result.statusCode, result.body);
            res.status(result.statusCode).json(result.body);
          } catch (error) {
            await idempotency.release(idempotencyKey);
            throw error;
          }
          return;
        }

        const result = await deps.jobService.processBatch(req.body.items);
        res.status(result.statusCode).json(result.body);
      } catch (error) {
        next(error);
      }
    },
  );

  router.get('/api/v1/jobs/:id', async (req, res, next) => {
    try {
      const progress = await deps.jobService.getJobProgress(req.params.id!);
      res.json(progress);
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/v1/jobs/:id/items', async (req, res, next) => {
    try {
      const limitRaw = req.query.limit ? Number(req.query.limit) : env.JOB_POLL_DEFAULT_LIMIT;
      const limit = Number.isFinite(limitRaw)
        ? Math.min(Math.max(limitRaw, 1), 500)
        : env.JOB_POLL_DEFAULT_LIMIT;
      const cursorRaw = req.query.cursor !== undefined ? Number(req.query.cursor) : undefined;
      const cursor =
        cursorRaw !== undefined && Number.isFinite(cursorRaw) ? Math.max(0, cursorRaw) : undefined;
      const page = await deps.jobService.listJobItems(req.params.id!, cursor, limit);
      res.json(page);
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/v1/jobs/:id/cancel', async (req, res, next) => {
    try {
      const progress = await deps.jobService.cancelJob(req.params.id!);
      res.json(progress);
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/v1/jobs/:id/retry', async (req, res, next) => {
    try {
      const progress = await deps.jobService.retryJob(req.params.id!);
      res.json(progress);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
