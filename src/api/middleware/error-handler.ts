import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodSchema } from 'zod';
import { AppError, isAppError, toPublicError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      next(
        new AppError(400, 'VALIDATION_ERROR', 'Request body validation failed', {
          issues: parsed.error.issues,
        }),
      );
      return;
    }
    req.body = parsed.data;
    next();
  };
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = (req as Request & { requestId?: string }).requestId;

  if (err instanceof ZodError) {
    res.status(400).json(
      toPublicError(
        new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', {
          issues: err.issues,
        }),
        requestId,
      ),
    );
    return;
  }

  if (isAppError(err)) {
    if (err.statusCode >= 500) {
      logger.error({ err, requestId }, err.message);
    }
    res.status(err.statusCode).json(toPublicError(err, requestId));
    return;
  }

  logger.error({ err, requestId }, 'Unhandled error');
  res.status(500).json(toPublicError(err, requestId));
}
