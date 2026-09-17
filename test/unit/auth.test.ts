import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';
import { requestIdMiddleware } from '../../src/api/middleware/auth.js';
import { loadEnv, resetEnvCache } from '../../src/config/env.js';
import type { Request, Response } from 'express';

describe('requestIdMiddleware', () => {
  before(() => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'mongodb://127.0.0.1:27017/test';
    process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
    process.env.LOG_LEVEL = 'silent';
    resetEnvCache();
    loadEnv();
  });

  it('assigns request ids', () => {
    const headers: Record<string, string> = {};
    const req = {
      header: () => undefined,
    } as unknown as Request;
    const res = {
      setHeader: (key: string, value: string) => {
        headers[key] = value;
      },
    } as unknown as Response;

    let nextCalled = false;
    requestIdMiddleware(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.ok(headers['x-request-id']);
    assert.ok((req as Request & { requestId: string }).requestId);
  });
});
