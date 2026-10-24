import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { candidate, pngFetch, TestApp } from './helpers';

let app: TestApp;

beforeEach(() => {
  app = new TestApp({ fetchImpl: pngFetch() });
});

afterEach(() => {
  app.dispose();
});

describe('首页想看列表', () => {
  it('较早收藏的想看作品不受最近12部配额影响，重启后仍可显示', () => {
    const older = app.library.createManualFilm({ title: '较早的想看作品' });
    app.library.updateEntry(older.entry.id, { collectedAt: '2000-01-01T00:00:00.000Z' });
    for (let i = 0; i < 12; i++) {
      const item = app.library.createManualFilm({ title: `新近已看作品 ${i}` });
      app.library.updateEntry(item.entry.id, { watchStatus: 'watched' });
    }
    app.restart();
    const home = app.library.getHome();
    expect(home.recent).toHaveLength(12);
    expect(home.recent.some((entry) => entry.id === older.entry.id)).toBe(false);
    expect(home.wantCount).toBe(1);
    expect(home.wantEntries.map((entry) => entry.id)).toEqual([older.entry.id]);
  });

  it('只展示最新6部想看作品，同时保留真实总数', () => {
    for (let i = 0; i < 8; i++) {
      const item = app.library.createManualFilm({ title: `想看 ${i}` });
      app.library.updateEntry(item.entry.id, { collectedAt: `2020-01-0${i + 1}T00:00:00.000Z` });
    }
    const home = app.library.getHome();
    expect(home.wantCount).toBe(8);
    expect(home.wantEntries.map((entry) => entry.film.title)).toEqual([
      '想看 7', '想看 6', '想看 5', '想看 4', '想看 3', '想看 2',
    ]);
  });
});

describe('收藏条目的增删改', () => {
  it('导入作品后可以读取完整详情', async () => {
    const result = await app.library.importCandidate(candidate());
    expect(result.duplicate).toBe(false);
    expect(result.film.title).toBe('花样年华');

    const detail = app.library.getFilmDetail(result.film.id);
    expect(detail.film.originalTitle).toBe('In the Mood for Love');
    expect(detail.entry.watchStatus).toBe('want');
    expect(detail.resources).toEqual([]);
  });

  it('编辑收藏信息只影响个人字段', async () => {
    const { film, entry } = await app.library.importCandidate(candidate());
    const updated = app.library.updateEntry(entry.id, {
      personalRating: 9.5,
      watchStatus: 'watched',
      favoriteReason: '反复重看的电影',
      personalReview: '走廊的镜头值得单独收藏。',
    });

    expect(updated.personalRating).toBe(9.5);
    expect(updated.watchStatus).toBe('watched');
    expect(updated.watchedAt).not.toBeNull();
    expect(updated.film.title).toBe(film.title);
  });

  it('删除收藏条目会同时清理资源与专题关联', async () => {
    const { film, entry } = await app.library.importCandidate(candidate());
    const collection = app.library.createCollection({ name: '重看清单' });
    app.library.addFilmToCollection(collection.id, entry.id);
    app.library.createResource({
      filmId: film.id,
      resourceName: '4K 版本',
      shareUrl: 'https://pan.quark.cn/s/abc123',
      accessCode: 'x1y2',
    });

    const removed = app.library.removeFilm(film.id);
    expect(removed.removedResources).toBe(1);
    expect(app.repo.listAllFilms()).toHaveLength(0);
    expect(app.repo.listAllResources()).toHaveLength(0);
    expect(app.repo.listMemberships()).toHaveLength(0);
    // The topic itself survives.
    expect(app.library.listCollections()).toHaveLength(1);
  });

  it('拒绝非法评分与空白标题', async () => {
    const { entry } = await app.library.importCandidate(candidate());
    expect(() => app.library.updateEntry(entry.id, { personalRating: 11 })).toThrowError(
      /0 到 10/,
    );
    expect(() => app.library.updateFilm(entry.filmId, { title: '   ' })).toThrowError(/标题/);
  });
});

describe('外部元数据与个人数据隔离', () => {
  it('刷新外部资料不会覆盖评分、笔记与网盘资源', async () => {
    const { film, entry } = await app.library.importCandidate(candidate());
    app.library.updateEntry(entry.id, {
      personalRating: 8,
      favoriteReason: '私人理由',
      personalReview: '私人短评',
    });
    app.library.createResource({
      filmId: film.id,
      resourceName: '我的版本',
      shareUrl: 'https://pan.quark.cn/s/mine',
      accessCode: 'abcd',
    });

    await app.library.applyExternalMetadata(
      film.id,
      candidate({
        title: '花样年华（重制）',
        overview: '更新后的简介',
        year: 2001,
      }),
    );

    const detail = app.library.getFilmDetail(film.id);
    expect(detail.film.title).toBe('花样年华（重制）');
    expect(detail.film.overview).toBe('更新后的简介');
    expect(detail.entry.personalRating).toBe(8);
    expect(detail.entry.favoriteReason).toBe('私人理由');
    expect(detail.entry.personalReview).toBe('私人短评');
    expect(detail.resources).toHaveLength(1);
    expect(detail.resources[0].shareUrl).toBe('https://pan.quark.cn/s/mine');
  });
});

describe('重复导入检测', () => {
  it('再次导入同一 TMDB 作品不会产生第二条收藏', async () => {
    const first = await app.library.importCandidate(candidate());
    const second = await app.library.importCandidate(candidate({ title: '别名' }));

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.entry.id).toBe(first.entry.id);
    expect(app.repo.listAllFilms()).toHaveLength(1);
    expect(app.repo.listAllEntries()).toHaveLength(1);
  });
});

describe('专题管理', () => {
  it('创建、重命名、删除专题', async () => {
    const created = app.library.createCollection({ name: '黑色电影', description: '光影对比' });
    expect(created.filmCount).toBe(0);

    const renamed = app.library.updateCollection(created.id, { name: '黑色电影 II' });
    expect(renamed.name).toBe('黑色电影 II');

    app.library.deleteCollection(created.id);
    expect(app.library.listCollections()).toHaveLength(0);
  });

  it('同名专题会被拒绝', () => {
    app.library.createCollection({ name: '周末片单' });
    expect(() => app.library.createCollection({ name: '周末片单' })).toThrowError(/同名/);
  });

  it('一部作品可以同时属于多个专题', async () => {
    const { entry } = await app.library.importCandidate(candidate());
    const a = app.library.createCollection({ name: 'A' });
    const b = app.library.createCollection({ name: 'B' });

    app.library.addFilmToCollection(a.id, entry.id);
    app.library.addFilmToCollection(b.id, entry.id);
    app.library.addFilmToCollection(b.id, entry.id); // idempotent

    expect(app.library.getCollectionWithEntries(a.id).entries).toHaveLength(1);
    expect(app.library.getCollectionWithEntries(b.id).entries).toHaveLength(1);
    expect(app.repo.listMemberships()).toHaveLength(2);
  });

  it('删除专题不会删除影视作品', async () => {
    const { film, entry } = await app.library.importCandidate(candidate());
    const collection = app.library.createCollection({ name: '临时专题' });
    app.library.addFilmToCollection(collection.id, entry.id);
    app.library.deleteCollection(collection.id);

    expect(app.repo.listAllFilms()).toHaveLength(1);
    expect(app.library.getFilmDetail(film.id).entry.personalRating).toBeNull();
  });
});

describe('夸克资源管理', () => {
  it('同一部作品可以关联多条资源', async () => {
    const { film } = await app.library.importCandidate(candidate());
    app.library.createResource({
      filmId: film.id,
      resourceName: '1080p 内封中字',
      shareUrl: 'https://pan.quark.cn/s/one',
      qualityLabel: '1080p',
      subtitleLabel: '内封中字',
    });
    app.library.createResource({
      filmId: film.id,
      resourceName: '4K REMUX',
      shareUrl: 'https://pan.quark.cn/s/two',
      qualityLabel: '4K',
      versionLabel: 'REMUX',
      accessCode: '8k2m',
    });

    const resources = app.library.listResources(film.id);
    expect(resources).toHaveLength(2);
    expect(resources.every((resource) => resource.provider === 'quark')).toBe(true);
    expect(resources.every((resource) => resource.availabilityStatus === 'unchecked')).toBe(true);
  });

  it('删除资源不会删除作品与收藏', async () => {
    const { film } = await app.library.importCandidate(candidate());
    const resource = app.library.createResource({
      filmId: film.id,
      resourceName: '临时资源',
      shareUrl: 'https://pan.quark.cn/s/temp',
    });

    app.library.deleteResource(resource.id);

    const detail = app.library.getFilmDetail(film.id);
    expect(detail.film.id).toBe(film.id);
    expect(detail.entry.watchStatus).toBe('want');
    expect(detail.resources).toHaveLength(0);
  });

  it('拒绝非 HTTP/HTTPS 链接与无效提取码', async () => {
    const { film } = await app.library.importCandidate(candidate());

    expect(() =>
      app.library.createResource({
        filmId: film.id,
        resourceName: '危险链接',
        shareUrl: 'file:///C:/Windows/System32',
      }),
    ).toThrowError(/http/);

    expect(() =>
      app.library.createResource({
        filmId: film.id,
        resourceName: '命令注入',
        shareUrl: 'javascript:alert(1)',
      }),
    ).toThrowError(/http/);

    expect(() =>
      app.library.createResource({
        filmId: film.id,
        resourceName: '提取码过长',
        shareUrl: 'https://pan.quark.cn/s/ok',
        accessCode: 'x'.repeat(33),
      }),
    ).toThrowError(/提取码/);
  });

  it('资源状态可以标记为可用或不可用，但默认从未检查开始', async () => {
    const { film } = await app.library.importCandidate(candidate());
    const created = app.library.createResource({
      filmId: film.id,
      resourceName: '待确认',
      shareUrl: 'https://pan.quark.cn/s/check',
    });
    expect(created.availabilityStatus).toBe('unchecked');

    const updated = app.library.updateResource(created.id, { availabilityStatus: 'available' });
    expect(updated.availabilityStatus).toBe('available');
  });
});

describe('搜索、筛选与排序', () => {
  beforeEach(async () => {
    await app.library.importCandidate(
      candidate({ externalId: '1', title: '花样年华', year: 2000, genres: ['剧情'] }),
    );
    await app.library.importCandidate(
      candidate({
        externalId: '2',
        title: '银翼杀手',
        originalTitle: 'Blade Runner',
        year: 1982,
        mediaType: 'movie',
      }),
    );
    await app.library.importCandidate(
      candidate({
        externalId: '3',
        title: '漫长的季节',
        year: 2023,
        mediaType: 'tv',
        posterUrl: null,
        backdropUrl: null,
      }),
    );
    const entries = app.library.listEntries({});
    const blade = entries.find((entry) => entry.film.title === '银翼杀手');
    if (blade) {
      app.library.updateEntry(blade.id, {
        personalRating: 9,
        watchStatus: 'watched',
        personalReview: '雨夜与霓虹',
      });
    }
    const season = entries.find((entry) => entry.film.title === '漫长的季节');
    if (season) app.library.updateEntry(season.id, { watchStatus: 'watching' });
  });

  it('按标题、原名与个人笔记搜索', () => {
    expect(app.library.listEntries({ search: '花样' })).toHaveLength(1);
    expect(app.library.listEntries({ search: 'Blade' })).toHaveLength(1);
    expect(app.library.listEntries({ search: '霓虹' })).toHaveLength(1);
    expect(app.library.listEntries({ search: '不存在的片名' })).toHaveLength(0);
  });

  it('按年份、观看状态与专题筛选', () => {
    expect(app.library.listEntries({ year: 1982 })).toHaveLength(1);
    expect(app.library.listEntries({ watchStatus: 'watched' })).toHaveLength(1);
    expect(app.library.listEntries({ watchStatus: 'watching' })).toHaveLength(1);

    const collection = app.library.createCollection({ name: '科幻' });
    const blade = app.library.listEntries({ search: '银翼' })[0];
    app.library.addFilmToCollection(collection.id, blade.id);
    expect(app.library.listEntries({ collectionId: collection.id })).toHaveLength(1);
  });

  it('按年份与评分排序', () => {
    const byYear = app.library.listEntries({ sort: 'year_asc' });
    expect(byYear.map((entry) => entry.film.year)).toEqual([1982, 2000, 2023]);

    const byRating = app.library.listEntries({ sort: 'rating_desc' });
    expect(byRating[0].film.title).toBe('银翼杀手');

    const byTitle = app.library.listEntries({ sort: 'title_asc' });
    expect(byTitle).toHaveLength(3);
  });

  it('搜索词中的 % 与 _ 被当作普通字符', async () => {
    await app.library.importCandidate(candidate({ externalId: '9', title: '100% 纯爱' }));
    expect(app.library.listEntries({ search: '100%' })).toHaveLength(1);
    expect(app.library.listEntries({ search: '%' })).toHaveLength(1);
  });
});

describe('图片缓存失败不影响收藏导入', () => {
  it('海报下载失败时仍然导入成功并给出警告', async () => {
    const failing = new TestApp({
      fetchImpl: (async () => new Response('boom', { status: 500 })) as typeof fetch,
    });
    try {
      const result = await failing.library.importCandidate(candidate());
      expect(result.duplicate).toBe(false);
      expect(result.film.posterPath).toBeNull();
      expect(result.imageWarning).toContain('海报');
      expect(failing.library.listEntries({})).toHaveLength(1);
    } finally {
      failing.dispose();
    }
  });
});
