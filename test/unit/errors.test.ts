import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError, isAppError, toPublicError } from '../../src/lib/errors.js';

describe('errors', () => {
  it('detects AppError and formats public payload', () => {
    const err = new AppError(400, 'BAD', 'nope', { field: 'lat' });
    assert.equal(isAppError(err), true);
    assert.deepEqual(toPublicError(err, 'req-1'), {
      error: {
        code: 'BAD',
        message: 'nope',
        details: { field: 'lat' },
        requestId: 'req-1',
      },
    });
  });

  it('hides internal errors', () => {
    assert.deepEqual(toPublicError(new Error('secret'), 'req-2'), {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        requestId: 'req-2',
      },
    });
  });
});
