import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SqlDatabase } from './driver';
import { migrations, SCHEMA_VERSION } from './migrations';

export type DatabaseFailure =
  | 'CORRUPT'
  | 'NEWER_SCHEMA'
  | 'MIGRATION_FAILED'
  | 'UNREADABLE';

export class DatabaseError extends Error {
  readonly failure: DatabaseFailure;
  readonly detail: string;

  constructor(failure: DatabaseFailure, message: string, detail = '') {
    super(message);
    this.name = 'DatabaseError';
    this.failure = failure;
    this.detail = detail;
  }
}

export interface OpenResult {
  db: SqlDatabase;
  schemaVersion: number;
  applied: number[];
}

/**
 * Opens (creating if needed) the library database and brings its schema up to
 * date. Any failure throws before the file is touched destructively: the
 * existing database file is never deleted or overwritten here.
 */
export function openLibraryDatabase(file: string): OpenResult {
  mkdirSync(dirname(file), { recursive: true });

  let db: SqlDatabase;
  try {
    db = new SqlDatabase(file);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // A file that is not SQLite at all is corruption, not a permission problem.
    const corrupt = /not a database|NOTADB|malformed|encrypted/i.test(detail);
    throw new DatabaseError(
      corrupt ? 'CORRUPT' : 'UNREADABLE',
      corrupt
        ? '数据库文件已损坏或不是有效的 My Cinema 数据库，应用已停止写入。'
        : '无法打开本地数据库文件。',
      detail,
    );
  }

  try {
    const check = db.prepare('PRAGMA quick_check').get<{ quick_check: string }>();
    if (check?.quick_check !== 'ok') {
      throw new DatabaseError(
        'CORRUPT',
        '数据库文件已损坏，应用已停止写入以避免进一步损坏。',
        String(check?.quick_check ?? 'unknown'),
      );
    }
  } catch (error) {
    db.close();
    if (error instanceof DatabaseError) throw error;
    throw new DatabaseError(
      'CORRUPT',
      '数据库文件无法读取，可能已损坏。',
      error instanceof Error ? error.message : String(error),
    );
  }

  try {
    const applied = migrate(db);
    return { db, schemaVersion: SCHEMA_VERSION, applied };
  } catch (error) {
    db.close();
    if (error instanceof DatabaseError) throw error;
    throw new DatabaseError(
      'MIGRATION_FAILED',
      '数据库结构升级失败，原有数据未被删除。',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function migrate(db: SqlDatabase): number[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const rows = db
    .prepare('SELECT version FROM schema_migrations ORDER BY version')
    .all<{ version: number }>();
  const appliedVersions = new Set(rows.map((row) => row.version));
  const current = rows.length > 0 ? Math.max(...rows.map((row) => row.version)) : 0;

  if (current > SCHEMA_VERSION) {
    throw new DatabaseError(
      'NEWER_SCHEMA',
      '这个数据库由更新版本的 My Cinema 创建，请先升级应用。',
      `database=${current} app=${SCHEMA_VERSION}`,
    );
  }

  const applied: number[] = [];
  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue;
    const record = db.prepare(
      'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
    );
    try {
      db.transaction(() => {
        migration.up(db);
        record.run(migration.version, migration.name, new Date().toISOString());
      });
      applied.push(migration.version);
    } catch (error) {
      throw new DatabaseError(
        'MIGRATION_FAILED',
        `数据库升级到版本 ${migration.version}（${migration.name}）失败。`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  db.pragma(`user_version = ${SCHEMA_VERSION}`);
  return applied;
}

/** Reads a database's schema version without running migrations. */
export function peekSchemaVersion(file: string): number {
  const db = new SqlDatabase(file, { readonly: true });
  try {
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
      )
      .get();
    if (!row) {
      const legacy = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'films'")
        .get();
      return legacy ? 1 : 0;
    }
    const version = db
      .prepare('SELECT MAX(version) AS version FROM schema_migrations')
      .get<{ version: number | null }>();
    return version?.version ?? 0;
  } finally {
    db.close();
  }
}
