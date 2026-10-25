import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { candidate, pngFetch, TestApp } from './helpers';
import { SCHEMA_VERSION } from '../electron/main/data/migrations';
import { DatabaseError } from '../electron/main/data/database';

let app: TestApp;

beforeEach(() => {
  app = new TestApp({ fetchImpl: pngFetch() });
});

afterEach(() => {
  app.dispose();
});

describe('本地持久化', () => {
  it('重启应用后收藏、专题与资源仍然存在', async () => {
    const { film, entry } = await app.library.importCandidate(candidate());
    app.library.updateEntry(entry.id, {
      personalRating: 7.5,
      watchStatus: 'watched',
      favoriteReason: '想再看一次',
    });
    const collection = app.library.createCollection({ name: '持久化测试' });
    app.library.addFilmToCollection(collection.id, entry.id);
    app.library.createResource({
      filmId: film.id,
      resourceName: '蓝光原盘',
      shareUrl: 'https://pan.quark.cn/s/persist',
      accessCode: 'p9q8',
    });

    app.restart();

    const detail = app.library.getFilmDetail(film.id);
    expect(detail.film.title).toBe('花样年华');
    expect(detail.entry.personalRating).toBe(7.5);
    expect(detail.entry.favoriteReason).toBe('想再看一次');
    expect(detail.resources).toHaveLength(1);
    expect(detail.resources[0].accessCode).toBe('p9q8');
    expect(app.library.listCollections().map((item) => item.name)).toContain('持久化测试');
  });

  it('图片缓存与数据库分离：删掉图片不影响收藏', async () => {
    const result = await app.library.importCandidate(candidate());
    expect(result.film.posterPath).not.toBeNull();

    const poster = app.images.resolveRelative(result.film.posterPath);
    expect(poster).not.toBeNull();
    rmSync(poster!);
    app.restart();
    expect(app.images.read(result.film.posterPath)).toBeNull();
    const detail = app.library.getFilmDetail(result.film.id);
    expect(detail.film.title).toBe('花样年华');
    expect(detail.film.posterPath).toBe(result.film.posterPath);
  });
});

describe('备份与恢复', () => {
  it('备份后可以在新数据库中恢复数据', async () => {
    const { film } = await app.library.importCandidate(candidate());
    const backup = app.library;
    expect(film.id).toBeTruthy();

    const { BackupService } = await import('../electron/main/services/backup');
    const snapshots: string[] = [];
    const service = new BackupService({
      dbFile: app.dbFile,
      backupDir: join(app.dir, 'backups'),
      schemaVersion: SCHEMA_VERSION,
      appVersion: '1.0.0',
      logger: app.logger,
      getDb: () => app.db,
      getRepo: () => app.repo,
      closeDb: () => app.db.close(),
      openDb: () => app.restart(),
    });
    void backup;

    const created = service.createBackup();
    snapshots.push(created.path);
    expect(created.bytes).toBeGreaterThan(0);

    // Add data that must disappear after restoring the snapshot.
    await app.library.importCandidate(candidate({ externalId: '777', title: '恢复后应消失' }));
    expect(app.repo.listAllFilms()).toHaveLength(2);

    const validation = service.validateBackup(created.path);
    expect(validation.ok).toBe(true);
    expect(validation.schemaVersion).toBe(SCHEMA_VERSION);

    const restored = service.restore(created.path);
    expect(restored.restored).toBe(true);
    expect(restored.backupOfPrevious).not.toBeNull();

    const filmsAfter = app.repo.listAllFilms();
    expect(filmsAfter).toHaveLength(1);
    expect(filmsAfter[0].title).toBe('花样年华');
  });

  it('拒绝非数据库文件，且不破坏当前数据', async () => {
    await app.library.importCandidate(candidate());
    const { writeFileSync } = await import('node:fs');
    const junk = join(app.dir, 'not-a-database.db');
    writeFileSync(junk, 'this is not sqlite');

    const { BackupService } = await import('../electron/main/services/backup');
    const service = new BackupService({
      dbFile: app.dbFile,
      backupDir: join(app.dir, 'backups'),
      schemaVersion: SCHEMA_VERSION,
      appVersion: '1.0.0',
      logger: app.logger,
      getDb: () => app.db,
      getRepo: () => app.repo,
      closeDb: () => app.db.close(),
      openDb: () => app.restart(),
    });

    const validation = service.validateBackup(junk);
    expect(validation.ok).toBe(false);

    expect(() => service.restore(junk)).toThrowError();
    expect(app.repo.listAllFilms()).toHaveLength(1);
  });

  it('导出的 JSON 结构完整并标记敏感数据', async () => {
    const { film } = await app.library.importCandidate(candidate());
    app.library.createResource({
      filmId: film.id,
      resourceName: '含提取码的资源',
      shareUrl: 'https://pan.quark.cn/s/secret',
      accessCode: 'zz11',
    });
    app.library.createCollection({ name: '导出测试' });

    const { BackupService } = await import('../electron/main/services/backup');
    const service = new BackupService({
      dbFile: app.dbFile,
      backupDir: join(app.dir, 'backups'),
      schemaVersion: SCHEMA_VERSION,
      appVersion: '1.0.0',
      logger: app.logger,
      getDb: () => app.db,
      getRepo: () => app.repo,
      closeDb: () => app.db.close(),
      openDb: () => app.restart(),
    });

    const exported = service.exportJson(join(app.dir, 'exports'));
    expect(exported.includesSensitiveData).toBe(true);
    const payload = JSON.parse(readFileSync(exported.path, 'utf8')) as Record<string, unknown>;
    expect(payload.format).toBe('my-cinema-export');
    expect(payload.schemaVersion).toBe(SCHEMA_VERSION);
    expect(Array.isArray(payload.films)).toBe(true);
    expect(Array.isArray(payload.mediaResources)).toBe(true);
    expect(Array.isArray(payload.collectionFilms)).toBe(true);
    expect(payload.counts).toMatchObject({ films: 1, resources: 1, collections: 1 });
  });
});

describe('数据库损坏与版本保护', () => {
  it('遇到损坏的数据库时给出明确错误而不是静默覆盖', async () => {
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'my-cinema-corrupt-'));
    const file = join(dir, 'library.db');
    writeFileSync(file, 'SQLite format 3\u0000garbage-garbage-garbage');

    const { openLibraryDatabase } = await import('../electron/main/data/database');
    let caught: unknown = null;
    try {
      openLibraryDatabase(file);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DatabaseError);
    expect((caught as DatabaseError).failure).toBe('CORRUPT');
    // The file is left untouched for manual recovery.
    expect(readFileSync(file, 'utf8')).toContain('garbage');
  });
});

describe('备份与导出可靠性', () => {
  async function service() {
    const { BackupService } = await import('../electron/main/services/backup');
    return new BackupService({
      dbFile: app.dbFile, backupDir: join(app.dir, 'backups'), schemaVersion: SCHEMA_VERSION,
      appVersion: '1.0.0', logger: app.logger, getDb: () => app.db, getRepo: () => app.repo,
      closeDb: () => app.db.close(), openDb: () => app.restart(),
    });
  }
  it('同一秒创建的备份和导出使用独立文件，不会覆盖较早快照', async () => {
    const backup = await service();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const first = backup.createBackup();
      const firstExport = backup.exportJson(join(app.dir, 'exports'));
      app.library.createManualFilm({ title: '第二份快照中的作品' });
      const second = backup.createBackup();
      const secondExport = backup.exportJson(join(app.dir, 'exports'));
      expect(first.path).not.toBe(second.path);
      expect(firstExport.path).not.toBe(secondExport.path);
      expect(JSON.parse(readFileSync(firstExport.path, 'utf8')).counts.films).toBe(0);
      expect(JSON.parse(readFileSync(secondExport.path, 'utf8')).counts.films).toBe(1);
      backup.restore(first.path);
      expect(app.repo.listAllFilms()).toHaveLength(0);
    } finally { vi.useRealTimers(); }
  });
  it('SQLite一致性快照失败时报告失败，不降级到可能遗漏WAL内容的文件复制', async () => {
    const backup = await service();
    const exec = vi.spyOn(app.db, 'exec').mockImplementation(() => { throw new Error('snapshot unavailable'); });
    try { expect(() => backup.createBackup()).toThrow('snapshot unavailable'); }
    finally { exec.mockRestore(); }
  });
});
