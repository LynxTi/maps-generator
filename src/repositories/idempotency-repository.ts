import type { PrismaClient } from '@prisma/client';
import { getPrisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';

export type IdempotencyReserveResult =
  | { kind: 'acquired' }
  | { kind: 'completed'; responseCode: number; responseBody: unknown }
  | { kind: 'in_progress' };

export class IdempotencyRepository {
  constructor(private readonly db: PrismaClient = getPrisma()) {}

  async reserve(
    key: string,
    requestHash: string,
    ttlHours = 24,
  ): Promise<IdempotencyReserveResult> {
    const now = new Date();
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    const existing = await this.db.idempotencyRecord.findUnique({ where: { key } });
    if (existing) {
      if (existing.expiresAt.getTime() <= now.getTime()) {
        await this.db.idempotencyRecord.delete({ where: { key } }).catch(() => undefined);
      } else if (existing.requestHash !== requestHash) {
        throw new AppError(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          'Idempotency-Key was already used with a different request body',
        );
      } else if (existing.status === 'completed' && existing.responseCode != null) {
        return {
          kind: 'completed',
          responseCode: existing.responseCode,
          responseBody: existing.responseBody,
        };
      } else {
        return { kind: 'in_progress' };
      }
    }

    try {
      await this.db.idempotencyRecord.create({
        data: {
          key,
          requestHash,
          status: 'processing',
          expiresAt,
        },
      });
      return { kind: 'acquired' };
    } catch (error) {
      if (!this.isUniqueConflict(error)) throw error;
      const raced = await this.db.idempotencyRecord.findUnique({ where: { key } });
      if (!raced) return this.reserve(key, requestHash, ttlHours);
      if (raced.requestHash !== requestHash) {
        throw new AppError(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          'Idempotency-Key was already used with a different request body',
        );
      }
      if (raced.status === 'completed' && raced.responseCode != null) {
        return {
          kind: 'completed',
          responseCode: raced.responseCode,
          responseBody: raced.responseBody,
        };
      }
      return { kind: 'in_progress' };
    }
  }

  async complete(key: string, responseCode: number, responseBody: unknown): Promise<void> {
    await this.db.idempotencyRecord.update({
      where: { key },
      data: {
        status: 'completed',
        responseCode,
        responseBody: responseBody as object,
      },
    });
  }

  async release(key: string): Promise<void> {
    await this.db.idempotencyRecord.delete({ where: { key } }).catch(() => undefined);
  }

  private isUniqueConflict(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    );
  }
}
