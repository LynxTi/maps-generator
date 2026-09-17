import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildPublicUrl,
  coordinateSeed,
  isPublicStorageFilename,
  roundCoordinate,
  storageUrlPath,
  toCoordinateKey,
} from '../../src/lib/coordinates.js';

describe('coordinates', () => {
  it('rounds to 4 decimal places', () => {
    assert.equal(roundCoordinate(48.85661234), 48.8566);
    assert.equal(roundCoordinate(2.35224567), 2.3522);
  });

  it('builds stable coordinate keys as strings', () => {
    assert.deepEqual(toCoordinateKey(48.85661234, 2.35224567), {
      latKey: '48.8566',
      lonKey: '2.3522',
    });
  });

  it('builds public urls without double slashes', () => {
    assert.equal(
      buildPublicUrl('http://localhost:3000/', '/storage/a.webp'),
      'http://localhost:3000/storage/a.webp',
    );
    assert.equal(storageUrlPath('a.webp'), '/storage/a.webp');
  });

  it('builds deterministic seed text', () => {
    assert.equal(coordinateSeed('1.2345', '6.7890', 'v1'), '1.2345:6.7890:v1');
  });

  it('accepts only uuid webp filenames for public storage', () => {
    assert.equal(isPublicStorageFilename('550e8400-e29b-41d4-a716-446655440000.webp'), true);
    assert.equal(isPublicStorageFilename('.tmp/550e8400-e29b-41d4-a716-446655440000.webp'), false);
    assert.equal(isPublicStorageFilename('not-a-uuid.webp'), false);
  });
});
