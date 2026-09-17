import { OpenAPIRegistry, OpenApiGeneratorV3, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  asyncBatchResponseSchema,
  batchRequestSchema,
  errorBodySchema,
  mapRequestSchema,
  mapResponseSchema,
  syncBatchResponseSchema,
} from '../schemas/maps.js';

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

registry.registerPath({
  method: 'post',
  path: '/api/v1/maps',
  tags: ['Maps'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: mapRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Existing map reservation or cached file',
      content: { 'application/json': { schema: mapResponseSchema } },
    },
    201: {
      description: 'Newly reserved map. File may still be rendering (status=pending).',
      content: { 'application/json': { schema: mapResponseSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: errorBodySchema } },
    },
    429: {
      description: 'Render queue saturated',
      content: { 'application/json': { schema: errorBodySchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/maps/batch',
  tags: ['Maps'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: batchRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Batch accepted. URLs are reserved immediately; files may still be rendering.',
      content: { 'application/json': { schema: syncBatchResponseSchema } },
    },
    202: {
      description: 'Async job accepted. URLs are reserved immediately in items.',
      content: { 'application/json': { schema: asyncBatchResponseSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: errorBodySchema } },
    },
    409: {
      description: 'Idempotency conflict',
      content: { 'application/json': { schema: errorBodySchema } },
    },
    429: {
      description: 'Too many jobs or queue saturated',
      content: { 'application/json': { schema: errorBodySchema } },
    },
  },
});

export function buildOpenApiDocument() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Map Image Generator API',
      version: '1.0.0',
      description:
        'Generate parchment-style map WebP images from latitude/longitude coordinates. POST returns a stable URL immediately (status pending|ready|failed). The file appears later at that URL. Cached maps keep the first stored place label.',
    },
    servers: [{ url: '/' }],
  });
}
