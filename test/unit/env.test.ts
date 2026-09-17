import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import { loadEnv, resetEnvCache, getEnv } from '../../src/config/env.js';

describe('env config', () => {
  afterEach(() => {
    resetEnvCache();
  });

  it('loads and caches valid env', () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'mongodb://127.0.0.1:27017/test';
    process.env.PUBLIC_BASE_URL = 'http://localhost:3000/';
    process.env.LOG_LEVEL = 'silent';
    process.env.ENABLE_DOCS = 'false';
    resetEnvCache();
    const env = loadEnv();
    assert.equal(env.PUBLIC_BASE_URL, 'http://localhost:3000');
    assert.equal(env.ENABLE_DOCS, false);
    assert.equal(getEnv().PORT, env.PORT);
  });

  it('disables docs by default in production', () => {
    resetEnvCache();
    const env = loadEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'mongodb://127.0.0.1:27017/test',
      PUBLIC_BASE_URL: 'http://localhost:3000',
      LOG_LEVEL: 'silent',
    } as NodeJS.ProcessEnv);
    assert.equal(env.ENABLE_DOCS, false);
  });

  it('rejects missing required values', () => {
    resetEnvCache();
    assert.throws(
      () =>
        loadEnv({
          NODE_ENV: 'test',
        } as NodeJS.ProcessEnv),
      /Invalid environment configuration/,
    );
  });
});
