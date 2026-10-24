import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { BackupResult, ExportResult, RestoreResult } from '../../../src/shared/types';
import { AppError } from '../errors';
import { SqlDatabase } from '../data/driver';
import type { LibraryRepository } from '../data/repository';
import type { Logger } from './logger';

export interface BackupServiceOptions {
  dbFile: string;
  backupDir: string;
  schemaVersion: number;
  appVersion: string;
  logger: Logger;
  getDb: () => SqlDatabase;
  getRepo: () => LibraryRepository;
  closeDb: () => void;
  openDb: () => void;
}

export interface BackupValidation {
  ok: boolean;
  schemaVersion: number;
  reason?: string;
}

const stamp = (date = new Date()) =>
  `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}-${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`;

/**
 * Database backup / restore / JSON export.
 *
 * Restore never deletes the previous database until a verified snapshot of it
 * exists, and every validation failure leaves the running library untouched.
 */
export class BackupService {
  constructor(private readonly options: BackupServiceOptions) {}

  get backupDirectory(): string {
    return this.options.backupDir;
  }

  createBackup(prefix = 'my-cinema'): BackupResult {
    mkdirSync(this.options.backupDir, { recursive: true });
    const path = join(this.options.backupDir, `${prefix}-${stamp()}-${randomUUID()}.db`);
    this.snapshotInto(path);
    const bytes = statSync(path).size;
    this.options.logger.info(`Backup created: ${path} (${bytes} bytes)`);
    return { path, bytes, createdAt: new Date().toISOString() };
  }

  validateBackup(file: string): BackupValidation {
    if (!file || !existsSync(file)) {
      return { ok: false, schemaVersion: 0, reason: '文件不存在。' };
    }
    try {
      if (!statSync(file).isFile()) {
        return { ok: false, schemaVersion: 0, reason: '所选路径不是文件。' };
      }
    } catch {
      return { ok: false, schemaVersion: 0, reason: '无法读取所选文件。' };
    }

    let db: SqlDatabase | null = null;
    try {
      db = new SqlDatabase(file, { readonly: true });
      const check = db.prepare('PRAGMA quick_check').get<{ quick_check: string }>();
      if (check?.quick_check !== 'ok') {
        return { ok: false, schemaVersion: 0, reason: '备份文件已损坏。' };
      }
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all<{ name: string }>()
        .map((row) => row.name);
      const required = ['films', 'collection_entries', 'collections', 'media_resources'];
      for (const table of required) {
        if (!tables.includes(table)) {
          return { ok: false, schemaVersion: 0, reason: '备份文件不是 My Cinema 数据库。' };
        }
      }
      const version = peekSchemaVersionFrom(db);
      if (version <= 0) {
        return { ok: false, schemaVersion: version, reason: '备份缺少版本信息。' };
      }
      if (version > this.options.schemaVersion) {
        return {
          ok: false,
          schemaVersion: version,
          reason: `备份来自更新版本的 My Cinema（数据库版本 ${version}），请先升级应用。`,
        };
      }
      return { ok: true, schemaVersion: version };
    } catch (error) {
      this.options.logger.warn(
        `Backup validation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { ok: false, schemaVersion: 0, reason: '无法打开备份文件，可能已损坏。' };
    } finally {
      db?.close();
    }
  }

  restore(file: string): RestoreResult {
    const validation = this.validateBackup(file);
    if (!validation.ok) {
      throw new AppError('VALIDATION', validation.reason ?? '备份文件不可用。');
    }

    const safety = this.createBackup('pre-restore');
    const walFile = `${this.options.dbFile}-wal`;
    const shmFile = `${this.options.dbFile}-shm`;

    this.options.closeDb();
    try {
      rmSync(walFile, { force: true });
      rmSync(shmFile, { force: true });
      copyFileSync(file, this.options.dbFile);
      this.options.openDb();
      this.options.logger.info(`Database restored from ${file}`);
      return { restored: true, backupOfPrevious: safety.path, relaunchRequired: false };
    } catch (error) {
      this.options.logger.error('Restore failed, rolling back to the safety snapshot', error);
      // Put the pre-restore library back so a failed restore never loses data.
      try {
        this.options.closeDb();
      } catch {
        // already closed
      }
      try {
        rmSync(walFile, { force: true });
        rmSync(shmFile, { force: true });
        copyFileSync(safety.path, this.options.dbFile);
        this.options.openDb();
      } catch (rollbackError) {
        this.options.logger.error('Rollback after failed restore also failed', rollbackError);
        throw new AppError(
          'INTERNAL',
          `恢复失败，且自动回滚也失败。你的原始数据仍保存在：${safety.path}`,
        );
      }
      throw new AppError('INTERNAL', '恢复失败，已回滚到操作前的数据库。请检查备份文件后重试。');
    }
  }

  exportJson(directory: string): ExportResult {
    mkdirSync(directory, { recursive: true });
    const repo = this.options.getRepo();
    const films = repo.listAllFilms();
    const entries = repo.listAllEntries();
    const collections = repo.listCollections();
    const resources = repo.listAllResources();
    const includesSensitiveData = resources.some(
      (resource) => Boolean(resource.accessCode) || Boolean(resource.shareUrl),
    );

    const payload = {
      format: 'my-cinema-export',
      formatVersion: 1,
      schemaVersion: this.options.schemaVersion,
      application: { name: 'My Cinema', version: this.options.appVersion },
      exportedAt: new Date().toISOString(),
      includesSensitiveData,
      counts: {
        films: films.length,
        entries: entries.length,
        collections: collections.length,
        resources: resources.length,
      },
      films,
      collectionEntries: entries.map((entry) => ({
        id: entry.id,
        filmId: entry.filmId,
        personalRating: entry.personalRating,
        watchStatus: entry.watchStatus,
        collectedAt: entry.collectedAt,
        watchedAt: entry.watchedAt,
        favoriteReason: entry.favoriteReason,
        personalReview: entry.personalReview,
        sortOrder: entry.sortOrder,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      })),
      collections: collections.map((collection) => ({
        id: collection.id,
        name: collection.name,
        description: collection.description,
        coverPath: collection.coverPath,
        sortOrder: collection.sortOrder,
        createdAt: collection.createdAt,
        updatedAt: collection.updatedAt,
      })),
      collectionFilms: repo.listMemberships(),
      mediaResources: resources,
      settings: repo.getSettings(),
    };

    const path = join(directory, `my-cinema-export-${stamp()}-${randomUUID()}.json`);
    writeFileSync(path, JSON.stringify(payload, null, 2), { encoding: 'utf8', flag: 'wx' });
    const bytes = statSync(path).size;
    this.options.logger.info(`JSON export written: ${path} (${bytes} bytes)`);
    return { path, bytes, includesSensitiveData };
  }

  private snapshotInto(path: string): void {
    const db = this.options.getDb();
    const escaped = path.replace(/'/g, "''");
    try {
      db.exec(`VACUUM INTO '${escaped}'`);
    } catch (error) {
      // A busy WAL checkpoint + raw file copy can omit committed changes.
      // Keep SQLite's consistent snapshot guarantee and fail visibly instead.
      rmSync(path, { force: true });
      throw error;
    }
  }
}

function peekSchemaVersionFrom(db: SqlDatabase): number {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get();
  if (!row) return 0;
  const version = db
    .prepare('SELECT MAX(version) AS version FROM schema_migrations')
    .get<{ version: number | null }>();
  return version?.version ?? 0;
}
