import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { getEnv } from '../config/env.js';
import { buildOpenApiDocument } from '../openapi/document.js';
import { LocalStorage } from '../storage/local-storage.js';
import { MapService } from '../services/map-service.js';
import { JobService } from '../services/job-service.js';
import { JobWorker } from '../jobs/worker.js';
import type { RenderMap } from '../types/domain.js';
import { createApiRouter } from './routes/api.js';
import { requestIdMiddleware } from './middleware/auth.js';
import { errorHandler } from './middleware/error-handler.js';
import { isPublicStorageFilename } from '../lib/coordinates.js';
import { AppError } from '../lib/errors.js';
import { MapRepository } from '../repositories/map-repository.js';
import { logger } from '../lib/logger.js';

export type CreateAppOptions = {
  mapService?: MapService;
  jobService?: JobService;
  storage?: LocalStorage;
  renderMap?: RenderMap;
  worker?: JobWorker;
  enableWorker?: boolean;
};

export type AppContext = {
  app: Express;
  storage: LocalStorage;
  mapService: MapService;
  jobService: JobService;
  worker: JobWorker | null;
  openApiDocument: ReturnType<typeof buildOpenApiDocument>;
};

export async function createApp(options: CreateAppOptions = {}): Promise<AppContext> {
  const env = getEnv();
  const storage = options.storage ?? new LocalStorage();
  await storage.ensureReady();

  try {
    const filenames = await new MapRepository().listFilenames();
    const removed = await storage.cleanupOrphans(new Set(filenames));
    if (removed > 0) {
      logger.info({ removed }, 'Removed orphaned storage files');
    }
  } catch (error) {
    logger.warn({ err: error }, 'Storage cleanup skipped');
  }

  const mapService =
    options.mapService ??
    new MapService({
      storage,
      ...(options.renderMap ? { renderMap: options.renderMap } : {}),
    });
  const jobService = options.jobService ?? new JobService({ mapService });

  let worker: JobWorker | null = null;
  if (options.enableWorker !== false) {
    worker = options.worker ?? new JobWorker({ mapService });
    await worker.start();
  }

  const app = express();
  app.disable('x-powered-by');
  app.use(requestIdMiddleware);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  if (env.CORS_ORIGIN) {
    app.use(
      cors({
        origin: env.CORS_ORIGIN.split(',').map((value) => value.trim()),
      }),
    );
  }

  app.use(express.json({ limit: '1mb' }));

  const openApiDocument = buildOpenApiDocument();

  if (env.ENABLE_DOCS) {
    app.get('/openapi.json', (_req, res) => {
      res.json(openApiDocument);
    });
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));
  }

  app.get('/storage/:filename', async (req: Request, res: Response, next) => {
    try {
      const filename = req.params.filename ?? '';
      if (!isPublicStorageFilename(filename) || !(await storage.exists(filename))) {
        res.setHeader('Cache-Control', 'no-store');
        next(new AppError(404, 'NOT_FOUND', 'File not found'));
        return;
      }
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.sendFile(storage.resolvePublicFile(filename), (err) => {
        if (err) {
          res.setHeader('Cache-Control', 'no-store');
          next(new AppError(404, 'NOT_FOUND', 'File not found'));
        }
      });
    } catch (error) {
      next(error);
    }
  });

  app.use(createApiRouter({ mapService, jobService, storage }));
  app.use(errorHandler);

  return { app, storage, mapService, jobService, worker, openApiDocument };
}
