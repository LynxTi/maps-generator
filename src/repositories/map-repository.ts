import type { GeneratedMap, PrismaClient } from '@prisma/client';
import { getPrisma } from '../lib/prisma.js';

export type CreateMapInput = {
  lat: number;
  lon: number;
  latKey: string;
  lonKey: string;
  place?: string | null;
  filename: string;
  urlPath: string;
  renderVersion: string;
};

export class MapRepository {
  constructor(private readonly db: PrismaClient = getPrisma()) {}

  findByKey(
    latKey: string,
    lonKey: string,
    renderVersion: string,
  ): Promise<GeneratedMap | null> {
    return this.db.generatedMap.findUnique({
      where: {
        latKey_lonKey_renderVersion: { latKey, lonKey, renderVersion },
      },
    });
  }

  create(data: CreateMapInput): Promise<GeneratedMap> {
    return this.db.generatedMap.create({
      data: {
        lat: data.lat,
        lon: data.lon,
        latKey: data.latKey,
        lonKey: data.lonKey,
        place: data.place ?? null,
        filename: data.filename,
        urlPath: data.urlPath,
        renderVersion: data.renderVersion,
        status: 'pending',
        attempts: 0,
      },
    });
  }

  async createIgnoringDuplicate(data: CreateMapInput): Promise<GeneratedMap> {
    try {
      return await this.create(data);
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        const existing = await this.findByKey(data.latKey, data.lonKey, data.renderVersion);
        if (existing) return existing;
      }
      throw error;
    }
  }

  markPending(id: string): Promise<GeneratedMap> {
    return this.db.generatedMap.update({
      where: { id },
      data: {
        status: 'pending',
        lastErrorCode: null,
        lastErrorMsg: null,
      },
    });
  }

  incrementAttempts(id: string): Promise<GeneratedMap> {
    return this.db.generatedMap.update({
      where: { id },
      data: { attempts: { increment: 1 } },
    });
  }

  markReady(id: string): Promise<GeneratedMap> {
    return this.db.generatedMap.update({
      where: { id },
      data: {
        status: 'ready',
        lastErrorCode: null,
        lastErrorMsg: null,
      },
    });
  }

  markFailed(id: string, code: string, message: string): Promise<GeneratedMap> {
    return this.db.generatedMap.update({
      where: { id },
      data: {
        status: 'failed',
        lastErrorCode: code,
        lastErrorMsg: message.slice(0, 500),
      },
    });
  }

  listFilenames(): Promise<string[]> {
    return this.db.generatedMap
      .findMany({ select: { filename: true } })
      .then((rows) => rows.map((row) => row.filename));
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
