import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildOpenApiDocument } from '../../src/openapi/document.js';

describe('OpenAPI document', () => {
  it('includes required paths', () => {
    const doc = buildOpenApiDocument();
    assert.equal(doc.openapi.startsWith('3.'), true);
    assert.ok(doc.paths['/api/v1/maps']);
    assert.ok(doc.paths['/api/v1/maps/batch']);
    assert.ok(doc.paths['/api/v1/jobs/{id}']);
    assert.equal(doc.components?.securitySchemes?.ApiKeyAuth, undefined);
  });
});
