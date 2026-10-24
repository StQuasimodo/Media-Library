import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MetadataCandidate } from '../src/shared/types';
import { openLibraryDatabase } from '../electron/main/data/database';
import type { SqlDatabase } from '../electron/main/data/driver';
import { LibraryRepository } from '../electron/main/data/repository';
import { ImageCache } from '../electron/main/services/imageCache';
import { LibraryService } from '../electron/main/services/library';
import { Logger } from '../electron/main/services/logger';

export interface TestAppOptions {
  fetchImpl?: typeof fetch;
  imageRoot?: string;
}

/**
 * Test harness that wires the real data + service layers against a throwaway
 * directory. No Electron, no user data, no network unless a test supplies it.
 */
export class TestApp {
  readonly dir: string;
  readonly dbFile: string;
  readonly logger: Logger;
  readonly images: ImageCache;
  db: SqlDatabase;
  repo: LibraryRepository;
  library: LibraryService;
  readonly secrets: string[] = [];

  constructor(options: TestAppOptions = {}) {
    this.dir = mkdtempSync(join(tmpdir(), 'my-cinema-test-'));
    this.dbFile = join(this.dir, 'library.db');
    this.logger = new Logger(join(this.dir, 'logs', 'app.log'));
    this.images = new ImageCache({
      root: options.imageRoot ?? join(this.dir, 'images'),
      fetchImpl: options.fetchImpl,
      timeoutMs: 2000,
    });

    const opened = openLibraryDatabase(this.dbFile);
    this.db = opened.db;
    this.repo = new LibraryRepository(this.db);
    this.library = this.buildLibrary();
  }

  private buildLibrary(): LibraryService {
    return new LibraryService({
      repo: this.repo,
      images: this.images,
      onSecret: (secret) => {
        if (secret) {
          this.secrets.push(secret);
          this.logger.registerSecret(secret);
        }
      },
    });
  }

  /** Simulates an application restart: close the handle, reopen the same file. */
  restart(): void {
    this.db.close();
    const reopened = openLibraryDatabase(this.dbFile);
    this.db = reopened.db;
    this.repo = new LibraryRepository(this.db);
    this.library = this.buildLibrary();
  }

  dispose(): void {
    try {
      this.db.close();
    } catch {
      // already closed
    }
    rmSync(this.dir, { recursive: true, force: true });
  }
}

export function candidate(overrides: Partial<MetadataCandidate> = {}): MetadataCandidate {
  return {
    source: 'tmdb',
    externalId: '12345',
    mediaType: 'movie',
    title: '花样年华',
    originalTitle: 'In the Mood for Love',
    year: 2000,
    overview: '二十世纪六十年代的香港，两个邻居之间克制的情感。',
    posterUrl: 'https://image.tmdb.org/t/p/w500/poster.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/backdrop.jpg',
    tagline: '一段未曾开始的故事',
    runtime: 98,
    genres: ['剧情', '爱情'],
    originalLanguage: 'cn',
    popularity: 10,
    ...overrides,
  };
}

/** Fetch stub that serves a 1x1 PNG for any URL. */
export function pngFetch(calls: string[] = []): typeof fetch {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    return new Response(png, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    });
  }) as typeof fetch;
}

export function failingImageFetch(status = 404): typeof fetch {
  return (async () =>
    new Response('not found', {
      status,
      headers: { 'content-type': 'text/plain' },
    })) as typeof fetch;
}
