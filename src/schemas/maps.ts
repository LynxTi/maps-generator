import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export const mapRequestSchema = z
  .object({
    lat: z.number().min(-90).max(90).openapi({ example: 48.8566 }),
    lon: z.number().min(-180).max(180).openapi({ example: 2.3522 }),
    place: z.string().trim().min(1).max(200).optional().openapi({ example: 'Paris' }),
  })
  .strict()
  .openapi('MapRequest');

export const mapStatusSchema = z.enum(['pending', 'ready', 'failed']);

export const mapResponseSchema = z
  .object({
    id: z.string().openapi({ example: '665f1c2e9a1b2c3d4e5f6789' }),
    url: z.string().url().openapi({
      example: 'http://localhost:3000/storage/550e8400-e29b-41d4-a716-446655440000.webp',
    }),
    lat: z.number(),
    lon: z.number(),
    place: z.string().nullable(),
    cached: z.boolean(),
    status: mapStatusSchema,
    renderVersion: z.string(),
  })
  .openapi('MapResponse');

export const batchRequestSchema = z
  .object({
    items: z.array(mapRequestSchema).min(1).max(2000),
  })
  .strict()
  .openapi('BatchRequest');

export const errorBodySchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
      requestId: z.string().optional(),
    }),
  })
  .openapi('ErrorBody');

export const jobStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'partial',
  'failed',
  'cancelled',
]);

export const batchItemSuccessSchema = mapResponseSchema.extend({
  ok: z.literal(true),
  index: z.number().int(),
});

export const batchItemFailureSchema = z.object({
  ok: z.literal(false),
  index: z.number().int(),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const batchItemResultSchema = z.union([batchItemSuccessSchema, batchItemFailureSchema]);

export const syncBatchResponseSchema = z
  .object({
    mode: z.literal('sync'),
    total: z.number().int(),
    created: z.number().int(),
    cached: z.number().int(),
    failed: z.number().int(),
    items: z.array(batchItemResultSchema),
  })
  .openapi('SyncBatchResponse');

export const asyncBatchResponseSchema = z
  .object({
    mode: z.literal('async'),
    jobId: z.string(),
    total: z.number().int(),
    status: jobStatusSchema,
    items: z.array(batchItemResultSchema),
  })
  .openapi('AsyncBatchResponse');

export type MapRequestInput = z.infer<typeof mapRequestSchema>;
export type BatchRequestInput = z.infer<typeof batchRequestSchema>;
