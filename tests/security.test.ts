import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ImageCache } from '../electron/main/services/imageCache';
import { Logger } from '../electron/main/services/logger';
import {
  isQuarkHost,
  validateAccessCode,
  validateHttpUrl,
  validateRating,
  validateTitle,
  validateYear,
} from '../src/shared/validation';

function tempDir(): { dir: string; dispose: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'my-cinema-img-'));
  return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('图片缓存', () => {
  it('下载成功后返回相对路径并可读回', async () => {
    const { dir, dispose } = tempDir();
    try {
      const cache = new ImageCache({
        root: join(dir, 'images'),
        fetchImpl: (async () =>
          new Response(PNG, {
            status: 200,
            headers: { 'content-type': 'image/png' },
          })) as typeof fetch,
      });

      const relative = await cache.store('https://image.tmdb.org/poster.jpg', 'poster');
      expect(relative).toMatch(/^poster\/[0-9a-f]{2}\/[0-9a-f]{40}\.png$/);
      const read = cache.read(relative);
      expect(read?.mime).toBe('image/png');
      expect(read?.data.length).toBe(PNG.length);
      expect(cache.resolveRelative(relative)).toContain(dir);
    } finally {
      dispose();
    }
  });

  it('同一个 URL 只下载一次', async () => {
    const { dir, dispose } = tempDir();
    const calls: string[] = [];
    try {
      const cache = new ImageCache({
        root: join(dir, 'images'),
        fetchImpl: (async (input: string | URL | Request) => {
          calls.push(String(input));
          return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
        }) as typeof fetch,
      });

      await cache.store('https://image.tmdb.org/same.jpg', 'poster');
      await cache.store('https://image.tmdb.org/same.jpg', 'poster');
      expect(calls).toHaveLength(1);
    } finally {
      dispose();
    }
  });

  it('非图片响应与 HTTP 错误都会被拒绝', async () => {
    const { dir, dispose } = tempDir();
    try {
      const html = new ImageCache({
        root: join(dir, 'images'),
        fetchImpl: (async () =>
          new Response('<html></html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          })) as typeof fetch,
      });
      await expect(html.store('https://image.tmdb.org/x', 'poster')).rejects.toThrowError(
        /格式/,
      );

      const notFound = new ImageCache({
        root: join(dir, 'images2'),
        fetchImpl: (async () => new Response('gone', { status: 404 })) as typeof fetch,
      });
      await expect(notFound.store('https://image.tmdb.org/y', 'poster')).rejects.toThrowError(
        /HTTP 404/,
      );
    } finally {
      dispose();
    }
  });

  it('拒绝目录穿越的缓存路径', () => {
    const { dir, dispose } = tempDir();
    try {
      const cache = new ImageCache({ root: join(dir, 'images'), fetchImpl: (async () => new Response('')) as typeof fetch });
      expect(cache.resolveRelative('../../etc/passwd')).toBeNull();
      expect(cache.resolveRelative('poster/../../secrets.txt')).toBeNull();
      expect(cache.resolveRelative('C:/Windows/System32/config')).toBeNull();
      expect(cache.read('poster/zz/notahash.jpg')).toBeNull();
    } finally {
      dispose();
    }
  });
});

describe('日志脱敏', () => {
  it('API Key 与提取码不会写入日志', () => {
    const { dir, dispose } = tempDir();
    try {
      const logFile = join(dir, 'logs', 'app.log');
      const logger = new Logger(logFile);
      const apiKey = 'super-secret-api-key-1234567890';
      const accessCode = 'q7w8';
      logger.registerSecret(apiKey);
      logger.registerSecret(accessCode);

      logger.error(`TMDB request failed for key ${apiKey}`, new Error(`boom ${apiKey}`));
      logger.info(`opening https://pan.quark.cn/s/abc?pwd=${accessCode}`);
      logger.warn(`resource access code is ${accessCode}`);

      const contents = readFileSync(logFile, 'utf8');
      expect(contents).not.toContain(apiKey);
      expect(contents).not.toContain(accessCode);
      expect(contents).toContain('[redacted]');
      expect(contents).toContain('ERROR');
    } finally {
      dispose();
    }
  });

  it('JWT 形态的令牌也会被遮挡', () => {
    const { dir, dispose } = tempDir();
    try {
      const logFile = join(dir, 'logs', 'app.log');
      const logger = new Logger(logFile);
      const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ4eXoifQ.abcdefghij';
      logger.info(`Authorization: Bearer ${jwt}`);
      const contents = readFileSync(logFile, 'utf8');
      expect(contents).not.toContain(jwt);
      expect(contents).toContain('[redacted-token]');
    } finally {
      dispose();
    }
  });
});

describe('输入校验', () => {
  it('只接受 http/https 链接', () => {
    expect(validateHttpUrl('https://pan.quark.cn/s/abc').ok).toBe(true);
    expect(validateHttpUrl('http://example.com/x').ok).toBe(true);
    expect(validateHttpUrl('file:///C:/secret').ok).toBe(false);
    expect(validateHttpUrl('javascript:alert(1)').ok).toBe(false);
    expect(validateHttpUrl('ftp://example.com').ok).toBe(false);
    expect(validateHttpUrl('not a url').ok).toBe(false);
    expect(validateHttpUrl('   ').ok).toBe(false);
    expect(isQuarkHost('https://pan.quark.cn/s/abc')).toBe(true);
    expect(isQuarkHost('https://pan.quark.cn.evil.com/s/abc')).toBe(false);
  });

  it('评分、年份与标题边界', () => {
    expect(validateRating(0).ok).toBe(true);
    expect(validateRating(10).ok).toBe(true);
    expect(validateRating(10.5).ok).toBe(false);
    expect(validateRating(-1).ok).toBe(false);
    expect(validateRating(7.26)).toMatchObject({ ok: true, value: 7.3 });

    expect(validateYear(1800).ok).toBe(false);
    expect(validateYear(2000).ok).toBe(true);
    expect(validateYear(2000.5).ok).toBe(false);

    expect(validateTitle('  ').ok).toBe(false);
    expect(validateTitle('  花样年华  ')).toMatchObject({ ok: true, value: '花样年华' });
  });

  it('提取码长度受限且允许空值', () => {
    expect(validateAccessCode(null).ok).toBe(true);
    expect(validateAccessCode('  ')).toMatchObject({ ok: true, value: null });
    expect(validateAccessCode('a1b2')).toMatchObject({ ok: true, value: 'a1b2' });
    expect(validateAccessCode('x'.repeat(40)).ok).toBe(false);
  });
});
