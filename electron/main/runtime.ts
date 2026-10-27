import { mkdirSync } from 'node:fs';
import { SCHEMA_VERSION } from './data/migrations';
import { DatabaseError, openLibraryDatabase } from './data/database';
import type { SqlDatabase } from './data/driver';
import { LibraryRepository } from './data/repository';
import type { AppPaths } from './paths';
import { BackupService } from './services/backup';
import { CredentialStore, type SecretBox } from './services/credentials';
import { ImageCache } from './services/imageCache';
import { LibraryService } from './services/library';
import { Logger } from './services/logger';
import { MetadataService } from './services/metadataService';
import { TmdbProvider } from './services/metadata/tmdb';
import { QuarkLibrary } from './services/quark/library';
import { QuarkSync } from './services/quark/sync';
import { LibraryRefresh } from './services/libraryRefresh';

export interface CoreContext {
  db: SqlDatabase;
  repo: LibraryRepository;
  library: LibraryService;
  metadata: MetadataService;
  tmdb: TmdbProvider;
  schemaVersion: number;
}

export interface RuntimeOptions {
  secretBox: SecretBox;
  appVersion: string;
  fetchImpl?: typeof fetch;
  tmdbHosts?: string[];
  loggerConsole?: boolean;
}

/**
 * Owns the database handle and the service graph.
 *
 * A restore replaces the database file underneath the app, so the whole core
 * context is rebuildable through `reopen()`.
 */
export class AppRuntime {
  readonly logger: Logger;
  readonly credentials: CredentialStore;
  readonly images: ImageCache;
  private core: CoreContext | null = null;
  private startupFailure: DatabaseError | null = null;
  readonly backup: BackupService;
  readonly quark: QuarkLibrary;
  readonly quarkSync: QuarkSync;
  readonly refresh: LibraryRefresh;

  constructor(
    readonly paths: AppPaths,
    private readonly options: RuntimeOptions,
  ) {
    this.quark = new QuarkLibrary(paths.userData);
    this.quarkSync = new QuarkSync(() => ({db:this.db,repo:this.repo,library:this.library,metadata:this.metadata}));
    this.refresh = new LibraryRefresh(() => ({repo:this.repo,metadata:this.metadata}), this.quarkSync, this.quark);
    this.logger = new Logger(paths.logFile, { console: options.loggerConsole ?? false });
    this.credentials = new CredentialStore(paths.credentialsFile, options.secretBox);
    this.images = new ImageCache({ root: paths.imagesDir, fetchImpl: options.fetchImpl });
    this.backup = new BackupService({
      dbFile: paths.dbFile,
      backupDir: paths.backupsDir,
      schemaVersion: SCHEMA_VERSION,
      appVersion: options.appVersion,
      logger: this.logger,
      getDb: () => this.db,
      getRepo: () => this.repo,
      closeDb: () => this.close(),
      openDb: () => this.build(),
    });
  }

  /** Opens the database; on failure the error is kept for a readable startup screen. */
  start(): void {
    try {
      this.build();
      void this.quark.readOnStartup();
      this.logger.info(`Library opened at ${this.paths.dbFile} (schema ${SCHEMA_VERSION})`);
    } catch (error) {
      this.startupFailure =
        error instanceof DatabaseError
          ? error
          : new DatabaseError('UNREADABLE', '无法打开本地数据库。', String(error));
      this.logger.error('Startup failed', error);
    }
  }

  get failure(): DatabaseError | null {
    return this.startupFailure;
  }

  get ready(): boolean {
    return this.core !== null;
  }

  get db(): SqlDatabase {
    if (!this.core) throw new DatabaseError('UNREADABLE', '数据库不可用。');
    return this.core.db;
  }

  get repo(): LibraryRepository {
    if (!this.core) throw new DatabaseError('UNREADABLE', '数据库不可用。');
    return this.core.repo;
  }

  get library(): LibraryService {
    if (!this.core) throw new DatabaseError('UNREADABLE', '数据库不可用。');
    return this.core.library;
  }

  get metadata(): MetadataService {
    if (!this.core) throw new DatabaseError('UNREADABLE', '数据库不可用。');
    return this.core.metadata;
  }

  get schemaVersion(): number {
    return this.core?.schemaVersion ?? SCHEMA_VERSION;
  }

  /** Rebuilds every service against the file currently on disk. */
  reopen(): void {
    this.close();
    this.build();
  }

  private build(): void {
    mkdirSync(this.paths.userData, { recursive: true });
    const existingKey = this.credentials.getKey();
    this.logger.registerSecret(existingKey);

    const { db } = openLibraryDatabase(this.paths.dbFile);
    const repo = new LibraryRepository(db);
    const library = new LibraryService({
      repo,
      images: this.images,
      onSecret: (secret) => this.logger.registerSecret(secret),
    });
    const tmdb = new TmdbProvider({
      getConfig: () => {
        const key = this.credentials.getKey();
        this.logger.registerSecret(key);
        if (!key) return null;
        return { apiKey: key, language: repo.getSettings().metadataLanguage };
      },
      logger: this.logger,
      fetchImpl: this.options.fetchImpl,
      hosts: this.options.tmdbHosts,
    });
    const metadata = new MetadataService(tmdb, repo, library);

    this.core = { db, repo, library, metadata, tmdb, schemaVersion: SCHEMA_VERSION };
    // Access codes must never reach the log file, including in error text.
    for (const resource of repo.listAllResources()) {
      this.logger.registerSecret(resource.accessCode);
    }
  }

  private close(): void {
    this.refresh.cancel();
    try {
      this.core?.metadata.dispose();
      this.core?.db.close();
    } catch {
      // closing a already-closed handle is not an error worth surfacing
    }
    this.core = null;
  }

  shutdown(): void {
    this.quark.cancel();
    this.quarkSync.cancel();
    this.close();
  }
}
