import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { getEnv } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { storageUrlPath } from '../lib/coordinates.js';

export type StoredFile = {
  filename: string;
  absolutePath: string;
  urlPath: string;
};

export class LocalStorage {
  private readonly root: string;

  constructor(rootDir?: string) {
    this.root = path.resolve(rootDir ?? getEnv().STORAGE_DIR);
  }

  getRoot(): string {
    return this.root;
  }

  resolvePublicFile(filename: string): string {
    return path.join(this.root, path.basename(filename));
  }

  async exists(filename: string): Promise<boolean> {
    try {
      await fs.access(this.resolvePublicFile(filename));
      return true;
    } catch {
      return false;
    }
  }

  async ensureReady(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    await fs.mkdir(path.join(this.root, '.tmp'), { recursive: true });
  }

  createTempPath(ext = '.webp'): string {
    return path.join(this.root, '.tmp', `${randomUUID()}${ext}`);
  }

  createFinalPath(filename = `${randomUUID()}.webp`): StoredFile {
    const absolutePath = path.join(this.root, filename);
    return {
      filename,
      absolutePath,
      urlPath: storageUrlPath(filename),
    };
  }

  async commitTempFile(tempPath: string, finalPath: string): Promise<void> {
    await fs.mkdir(path.dirname(finalPath), { recursive: true });

    const buffer = await fs.readFile(tempPath);

    try {
      const metadata = await sharp(buffer).metadata();
      if (!metadata.width || !metadata.height || metadata.format !== 'webp') {
        throw new AppError(500, 'INVALID_RENDER_OUTPUT', 'Rendered file is not a valid WebP image');
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, 'INVALID_RENDER_OUTPUT', 'Rendered file could not be validated');
    }

    await fs.writeFile(finalPath, buffer);
    await this.deleteIfExists(tempPath);
  }

  async deleteIfExists(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async cleanupOrphans(keepFilenames: Set<string>): Promise<number> {
    await this.ensureReady();
    const entries = await fs.readdir(this.root, { withFileTypes: true });
    let removed = 0;

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.webp')) continue;
      if (keepFilenames.has(entry.name)) continue;
      await this.deleteIfExists(path.join(this.root, entry.name));
      removed += 1;
    }

    const tmpDir = path.join(this.root, '.tmp');
    try {
      const tmpEntries = await fs.readdir(tmpDir, { withFileTypes: true });
      const cutoff = Date.now() - 60 * 60 * 1000;
      for (const entry of tmpEntries) {
        if (!entry.isFile()) continue;
        const full = path.join(tmpDir, entry.name);
        const stat = await fs.stat(full);
        if (stat.mtimeMs < cutoff) {
          await this.deleteIfExists(full);
          removed += 1;
        }
      }
    } catch {
      // tmp may not exist yet
    }

    return removed;
  }
}
