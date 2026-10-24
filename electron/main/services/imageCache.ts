import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

export type ImageKind = 'poster' | 'backdrop';

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** Relative cache paths only: `<kind>/<2 hex>/<40 hex>.<ext>`. */
const RELATIVE_PATTERN = /^(poster|backdrop)\/[0-9a-f]{2}\/[0-9a-f]{40}\.(jpg|png|webp)$/;

export class ImageCacheError extends Error {
  constructor(message: string, readonly reason: 'network' | 'status' | 'type' | 'size' | 'write') {
    super(message);
    this.name = 'ImageCacheError';
  }
}

export interface ImageCacheOptions {
  root: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

/**
 * Stores poster/backdrop images outside the database.
 *
 * The database only keeps the relative path, so a wiped cache never affects the
 * collection itself: the app simply re-downloads on demand.
 */
export class ImageCache {
  private readonly root: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;

  constructor(options: ImageCacheOptions) {
    this.root = resolve(options.root);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxBytes = options.maxBytes ?? 12 * 1024 * 1024;
  }

  get cacheRoot(): string {
    return this.root;
  }

  /** Downloads `url` (if not cached) and returns the relative cache path. */
  async store(url: string, kind: ImageKind): Promise<string> {
    const hash = createHash('sha1').update(url).digest('hex');
    const existing = this.findExisting(kind, hash);
    if (existing) return existing;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { Accept: 'image/*' },
      });
    } catch (error) {
      throw new ImageCacheError(
        `图片下载失败：${error instanceof Error ? error.message : String(error)}`,
        'network',
      );
    }

    if (!response.ok) {
      throw new ImageCacheError(`图片下载失败：HTTP ${response.status}`, 'status');
    }

    const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const ext = MIME_TO_EXT[contentType];
    if (!ext) {
      throw new ImageCacheError(`图片格式不受支持：${contentType || '未知'}`, 'type');
    }

    let buffer: Buffer;
    try {
      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } catch (error) {
      throw new ImageCacheError(
        `图片读取失败：${error instanceof Error ? error.message : String(error)}`,
        'network',
      );
    }

    if (buffer.byteLength === 0) throw new ImageCacheError('图片内容为空。', 'type');
    if (buffer.byteLength > this.maxBytes) throw new ImageCacheError('图片体积过大。', 'size');

    const relative = `${kind}/${hash.slice(0, 2)}/${hash}.${ext}`;
    const absolute = join(this.root, relative);
    mkdirSync(dirname(absolute), { recursive: true });
    const temporary = `${absolute}.${process.pid}.${Date.now()}.tmp`;
    try {
      writeFileSync(temporary, buffer);
      renameSync(temporary, absolute);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw new ImageCacheError(
        `图片写入失败：${error instanceof Error ? error.message : String(error)}`,
        'write',
      );
    }
    return relative;
  }

  /** Absolute path for a stored image, or null when the path is invalid or missing. */
  resolveRelative(relative: string | null | undefined): string | null {
    if (!relative) return null;
    if (!RELATIVE_PATTERN.test(relative)) return null;
    const absolute = resolve(this.root, relative);
    if (!absolute.startsWith(this.root + sep)) return null;
    if (!existsSync(absolute)) return null;
    try {
      if (!statSync(absolute).isFile()) return null;
    } catch {
      return null;
    }
    return absolute;
  }

  read(relative: string | null | undefined): { data: Buffer; mime: string } | null {
    const absolute = this.resolveRelative(relative);
    if (!absolute) return null;
    const ext = absolute.split('.').pop() ?? '';
    const mime = EXT_TO_MIME[ext];
    if (!mime) return null;
    try {
      return { data: readFileSync(absolute), mime };
    } catch {
      return null;
    }
  }

  private findExisting(kind: ImageKind, hash: string): string | null {
    for (const ext of Object.keys(EXT_TO_MIME)) {
      const relative = `${kind}/${hash.slice(0, 2)}/${hash}.${ext}`;
      if (this.resolveRelative(relative)) return relative;
    }
    return null;
  }
}

export { RELATIVE_PATTERN as IMAGE_RELATIVE_PATTERN };
