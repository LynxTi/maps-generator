import { buildOpenApiDocument } from '../src/openapi/document.js';

const doc = buildOpenApiDocument();

if (!doc.openapi || !doc.info?.title || !doc.paths) {
  console.error('OpenAPI document is incomplete');
  process.exit(1);
}

const requiredPaths = ['/api/v1/maps', '/api/v1/maps/batch'];

for (const p of requiredPaths) {
  if (!doc.paths[p]) {
    console.error(`Missing OpenAPI path: ${p}`);
    process.exit(1);
  }
}

console.log('OpenAPI document OK');
