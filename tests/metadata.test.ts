import { describe, expect, it, vi } from 'vitest';
import { TmdbProvider } from '../electron/main/services/metadata/tmdb';
import { MetadataService } from '../electron/main/services/metadataService';
import { LibraryRepository } from '../electron/main/data/repository';
import { LibraryService } from '../electron/main/services/library';
import { ImageCache } from '../electron/main/services/imageCache';
import { AppError } from '../electron/main/errors';
import { openLibraryDatabase } from '../electron/main/data/database';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API_KEY = 'test-api-key-0123456789';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function provider(
  fetchImpl: typeof fetch,
  options: { apiKey?: string; hosts?: string[] } = {},
): TmdbProvider {
  return new TmdbProvider({
    getConfig: () => ({ apiKey: options.apiKey ?? API_KEY, language: 'zh-CN' }),
    fetchImpl,
    hosts: options.hosts ?? ['https://api.tmdb.org/3'],
    timeoutMs: 2000,
  });
}

describe('TMDB 搜索', () => {
  it('解析搜索结果并按热度排序', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      return jsonResponse({
        page: 1,
        results: [
          {
            id: 11,
            media_type: 'movie',
            title: '花样年华',
            original_title: 'In the Mood for Love',
            release_date: '2000-09-29',
            overview: '香港六十年代的爱情故事。',
            poster_path: '/poster.jpg',
            popularity: 5,
          },
          {
            id: 22,
            media_type: 'movie',
            title: '银翼杀手',
            original_title: 'Blade Runner',
            release_date: '1982-06-25',
            popularity: 30,
          },
          { id: 33, media_type: 'person', name: '某位演员', popularity: 99 },
        ],
      });
    }) as typeof fetch;

    const results = await provider(fetchImpl).search({ query: '花样年华', mediaType: 'all' });

    expect(results).toHaveLength(2);
    expect(results[0].title).toBe('银翼杀手');
    expect(results[1].year).toBe(2000);
    expect(results[1].posterUrl).toBe('https://image.tmdb.org/t/p/w500/poster.jpg');
    expect(calls[0]).toContain('/search/multi');
    expect(calls[0]).toContain('api_key=');
    expect(calls[0]).toContain('language=zh-CN');
  });

  it('空结果返回空数组', async () => {
    const fetchImpl = (async () => jsonResponse({ page: 1, results: [] })) as typeof fetch;
    await expect(provider(fetchImpl).search({ query: '不存在', mediaType: 'movie' })).resolves.toEqual(
      [],
    );
  });

  it('401 映射为无效 Key 错误', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ status_code: 7, status_message: 'Invalid API key' }, 401)) as typeof fetch;
    await expect(provider(fetchImpl).search({ query: 'x', mediaType: 'movie' })).rejects.toMatchObject(
      { code: 'INVALID_API_KEY' },
    );
  });

  it('429 映射为限流错误', async () => {
    const fetchImpl = (async () => jsonResponse({}, 429)) as typeof fetch;
    await expect(provider(fetchImpl).search({ query: 'x', mediaType: 'movie' })).rejects.toMatchObject(
      { code: 'RATE_LIMITED' },
    );
  });

  it('超时映射为 TIMEOUT', async () => {
    const fetchImpl = (async () => {
      const error = new Error('timed out');
      error.name = 'TimeoutError';
      throw error;
    }) as typeof fetch;
    await expect(provider(fetchImpl).search({ query: 'x', mediaType: 'movie' })).rejects.toMatchObject(
      { code: 'TIMEOUT' },
    );
  });

  it('所有镜像都不可达时报告网络错误', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    await expect(provider(fetchImpl).search({ query: 'x', mediaType: 'movie' })).rejects.toMatchObject(
      { code: 'NETWORK' },
    );
  });

  it('第一个域名失败时自动尝试备用域名', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      seen.push(url);
      if (url.startsWith('https://api.tmdb.org')) throw new TypeError('fetch failed');
      return jsonResponse({ results: [{ id: 1, media_type: 'movie', title: '备用域名可用' }] });
    }) as typeof fetch;

    const results = await provider(fetchImpl, {
      hosts: ['https://api.tmdb.org/3', 'https://api.themoviedb.org/3'],
    }).search({ query: 'x', mediaType: 'movie' });

    expect(results).toHaveLength(1);
    expect(seen.length).toBe(2);
    expect(seen[1]).toContain('api.themoviedb.org');
  });

  it('JWT 形式的 v4 令牌放在 Authorization 头而不是查询参数', async () => {
    let captured: { url: string; auth: string | null } | null = null;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      captured = { url: String(input), auth: headers.get('authorization') };
      return jsonResponse({ results: [] });
    }) as typeof fetch;

    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ0ZXN0In0.signature-part';
    await provider(fetchImpl, { apiKey: jwt }).search({ query: 'x', mediaType: 'movie' });

    expect(captured).not.toBeNull();
    expect(captured!.auth).toBe(`Bearer ${jwt}`);
    expect(captured!.url).not.toContain('api_key=');
  });

  it('未配置 Key 时抛出 NO_API_KEY', async () => {
    const tmdb = new TmdbProvider({ getConfig: () => null, fetchImpl: (async () => jsonResponse({})) as typeof fetch });
    await expect(tmdb.search({ query: 'x', mediaType: 'movie' })).rejects.toMatchObject({
      code: 'NO_API_KEY',
    });
  });
});

describe('TMDB 详情', () => {
  it('解析电影详情字段', async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/movie/603')) {
        return jsonResponse({
          id: 603,
          title: '黑客帝国',
          original_title: 'The Matrix',
          release_date: '1999-03-31',
          overview: '一名程序员发现了现实的真相。',
          tagline: '欢迎来到真实世界',
          poster_path: '/matrix.jpg',
          backdrop_path: '/matrix-backdrop.jpg',
          runtime: 136,
          genres: [{ id: 1, name: '动作' }, { id: 2, name: '科幻' }],
          original_language: 'en',
        });
      }
      return jsonResponse({}, 404);
    }) as typeof fetch;

    const detail = await provider(fetchImpl).getCandidate('603', 'movie');
    expect(detail.runtime).toBe(136);
    expect(detail.year).toBe(1999);
    expect(detail.genres).toEqual(['动作', '科幻']);
    expect(detail.backdropUrl).toContain('/w1280/matrix-backdrop.jpg');
  });

  it('剧集详情使用 name / first_air_date 与单集时长', async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        id: 1396,
        name: '绝命毒师',
        original_name: 'Breaking Bad',
        first_air_date: '2008-01-20',
        episode_run_time: [47],
        genres: [{ name: '剧情' }],
      })) as typeof fetch;

    const detail = await provider(fetchImpl).getCandidate('1396', 'tv');
    expect(detail.title).toBe('绝命毒师');
    expect(detail.year).toBe(2008);
    expect(detail.runtime).toBe(47);
  });

  it('中文简介为空时回退到英文一次', async () => {
    let calls = 0;
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      calls += 1;
      if (url.includes('language=en-US')) {
        return jsonResponse({ id: 1, title: 'X', overview: 'English synopsis' });
      }
      return jsonResponse({ id: 1, title: 'X', overview: '' });
    }) as typeof fetch;

    const detail = await provider(fetchImpl).getCandidate('1', 'movie');
    expect(detail.overview).toBe('English synopsis');
    expect(calls).toBe(2);
  });
});

describe('MetadataService', () => {
  function buildService(fetchImpl: typeof fetch) {
    const dir = mkdtempSync(join(tmpdir(), 'my-cinema-meta-'));
    const { db } = openLibraryDatabase(join(dir, 'library.db'));
    const repo = new LibraryRepository(db);
    const library = new LibraryService({
      repo,
      images: new ImageCache({ root: join(dir, 'images'), fetchImpl }),
    });
    const tmdb = new TmdbProvider({
      getConfig: () => ({ apiKey: API_KEY, language: 'zh-CN' }),
      fetchImpl,
      hosts: ['https://api.tmdb.org/3'],
    });
    const service = new MetadataService(tmdb, repo, library);
    return {
      service,
      dispose: () => {
        db.close();
        rmSync(dir, { recursive: true, force: true });
      },
    };
  }

  it('无搜索结果时抛出 NO_RESULTS', async () => {
    const { service, dispose } = buildService((async () => jsonResponse({ results: [] })) as typeof fetch);
    try {
      await expect(service.search({ query: '根本没有', mediaType: 'all' })).rejects.toBeInstanceOf(
        AppError,
      );
      await expect(service.search({ query: '根本没有', mediaType: 'all' })).rejects.toMatchObject({
        code: 'NO_RESULTS',
      });
    } finally {
      dispose();
    }
  });

  it('空关键词在发请求前就被拒绝', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const { service, dispose } = buildService(fetchImpl);
    try {
      await expect(service.search({ query: '   ', mediaType: 'all' })).rejects.toMatchObject({
        code: 'VALIDATION',
      });
      expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
    } finally {
      dispose();
    }
  });

  it('刷新手动录入的作品会被拒绝', async () => {
    const { service, dispose } = buildService((async () => jsonResponse({})) as typeof fetch);
    try {
      const detail = service['repo'].insertFilm as unknown;
      void detail;
      const created = await (async () => {
        const lib = service['library'] as LibraryService;
        return lib.createManualFilm({ title: '手动作品' });
      })();
      await expect(service.refreshFilm(created.film.id)).rejects.toMatchObject({
        code: 'VALIDATION',
      });
    } finally {
      dispose();
    }
  });
});
