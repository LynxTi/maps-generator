import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';
import type { Request, Response } from 'express';
import { ZodError, z } from 'zod';
import { errorHandler, validateBody } from '../../src/api/middleware/error-handler.js';
import { AppError } from '../../src/lib/errors.js';
import { loadEnv, resetEnvCache } from '../../src/config/env.js';

describe('error middleware', () => {
  before(() => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'mongodb://127.0.0.1:27017/test';
    process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
    process.env.LOG_LEVEL = 'silent';
    resetEnvCache();
    loadEnv();
  });

  it('validateBody rejects invalid payloads', () => {
    const schema = z.object({ lat: z.number() });
    const middleware = validateBody(schema);
    let error: unknown;
    middleware({ body: { lat: 'x' } } as Request, {} as Response, (err) => {
      error = err;
    });
    assert.ok(error instanceof AppError);
    assert.equal(error.code, 'VALIDATION_ERROR');
  });

  it('errorHandler maps AppError and ZodError', () => {
    const res = {
      statusCode: 0,
      body: null as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      },
    };

    errorHandler(
      new AppError(404, 'NOT_FOUND', 'missing'),
      { requestId: 'r1' } as unknown as Request,
      res as unknown as Response,
      () => undefined,
    );
    assert.equal(res.statusCode, 404);

    errorHandler(
      new ZodError([]),
      { requestId: 'r2' } as unknown as Request,
      res as unknown as Response,
      () => undefined,
    );
    assert.equal(res.statusCode, 400);
  });
});
