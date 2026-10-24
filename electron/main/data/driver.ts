import BetterSqlite3 from 'better-sqlite3';

/** Values accepted by the SQLite bindings. `undefined` is normalised to `null`. */
export type SqlValue = string | number | null;

export type SqlParams = readonly SqlValue[];

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface SqlStatement {
  run(...params: SqlParams): RunResult;
  get<T = Record<string, unknown>>(...params: SqlParams): T | undefined;
  all<T = Record<string, unknown>>(...params: SqlParams): T[];
}

/**
 * Thin synchronous SQLite wrapper.
 *
 * Deliberately small: the rest of the data layer only sees `exec`, `prepare`,
 * `transaction` and `pragma`, which keeps the storage engine replaceable and
 * makes business logic testable without Electron.
 */
export class SqlDatabase {
  private readonly db: BetterSqlite3.Database;

  constructor(file: string, options: { readonly?: boolean } = {}) {
    if (options.readonly) {
      // Read-only opens must not create -wal/-shm side files next to a backup.
      this.db = new BetterSqlite3(file, { readonly: true, fileMustExist: true });
      return;
    }
    this.db = new BetterSqlite3(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): SqlStatement {
    const statement = this.db.prepare(sql);
    return {
      run: (...params: SqlParams): RunResult => {
        const result = statement.run(...params);
        return {
          changes: result.changes,
          lastInsertRowid: Number(result.lastInsertRowid),
        };
      },
      get: <T>(...params: SqlParams): T | undefined =>
        statement.get(...params) as T | undefined,
      all: <T>(...params: SqlParams): T[] => statement.all(...params) as T[],
    };
  }

  /** Runs `fn` inside a single transaction; nested calls join the outer transaction. */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  pragma(statement: string): unknown {
    return this.db.pragma(statement);
  }

  get integrityOk(): boolean {
    const row = this.prepare('PRAGMA quick_check').get<{ quick_check: string }>();
    return row?.quick_check === 'ok';
  }

  close(): void {
    this.db.close();
  }
}
