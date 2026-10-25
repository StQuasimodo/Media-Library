import type {
  AppSettings,
  BackupResult,
  CollectionEntry,
  ExportResult,
  Film,
  FilmCollection,
  FilmDetail,
  FilmPatch,
  HomePayload,
  ImportResult,
  LibraryQuery,
  LibraryStats,
  MediaResource,
  MediaType,
  MetadataCandidate,
  MetadataSearchOptions,
  MetadataSearchResult,
  ResourceInput,
  RestoreResult,
  SerializedError,
  SettingsState,
  MetadataCredentialState,
  EntryPatch,
} from './types';
import type { QuarkWebStatus, QuarkWebDirectory } from './quarkWeb';
import type { QuarkBrowse, QuarkStatus } from './quark';
import type { QuarkMatchQuery, QuarkSyncStatus } from './quarkSync';

export interface AppInfo {
  appVersion: string;
  schemaVersion: number;
  dataDirectory: string;
  backupsDirectory: string;
  imagesDirectory: string;
  hasMetadataApiKey: boolean;
  metadataCredentialState: MetadataCredentialState;
  settings: AppSettings;
  platform: string;
}

export interface BackupValidation {
  ok: boolean;
  schemaVersion: number;
  reason?: string;
}

export type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: SerializedError };

/** The complete IPC surface. Nothing else is reachable from the renderer. */
export interface CinemaApi {
  quarkSync: {
    status(): Promise<QuarkSyncStatus>;
    configure(folderId: string, autoRead: boolean, autoImport: boolean): Promise<QuarkSyncStatus>;
    scan(): Promise<QuarkSyncStatus>;
    match(): Promise<QuarkSyncStatus>;
    search(key: string, query: QuarkMatchQuery): Promise<QuarkSyncStatus>;
    confirm(key: string, externalId: string, mediaType: MediaType): Promise<QuarkSyncStatus>;
    confirmHigh(): Promise<QuarkSyncStatus>;
    linkExisting(key: string, filmId: string): Promise<QuarkSyncStatus>;
    ignore(key: string, ignored: boolean): Promise<QuarkSyncStatus>;
    cancel(): Promise<void>;
  };
  quarkWeb: {
    status(): Promise<QuarkWebStatus>;
    connect(): Promise<QuarkWebStatus>;
    finishLogin(): Promise<QuarkWebStatus>;
    check(): Promise<QuarkWebStatus>;
    list(id: string): Promise<QuarkWebDirectory>;
    disconnect(): Promise<QuarkWebStatus>;
  };
  quark: {
    status(): Promise<QuarkStatus>;
    chooseTool(): Promise<QuarkStatus | null>;
    browse(folderId: string): Promise<QuarkBrowse>;
    selectFolder(folderId: string, recursive: boolean, autoRead: boolean): Promise<QuarkStatus>;
    scan(): Promise<QuarkStatus>;
    cancel(): Promise<void>;
  };
  app: {
    info(): Promise<AppInfo>;
    openExternal(url: string): Promise<void>;
    openFolder(kind: 'data' | 'backups' | 'images' | 'logs'): Promise<void>;
    relaunch(): Promise<void>;
  };
  library: {
    home(): Promise<HomePayload>;
    stats(): Promise<LibraryStats>;
    list(query: LibraryQuery): Promise<CollectionEntry[]>;
    years(): Promise<number[]>;
    detail(filmId: string): Promise<FilmDetail>;
    createManual(input: {
      title: string;
      originalTitle?: string | null;
      year?: number | null;
      overview?: string | null;
      mediaType?: MediaType;
      entry?: EntryPatch;
    }): Promise<FilmDetail>;
    updateFilm(filmId: string, patch: FilmPatch): Promise<Film>;
    updateEntry(entryId: string, patch: EntryPatch): Promise<CollectionEntry>;
    removeFilm(filmId: string): Promise<{ removedResources: number }>;
    importCandidate(candidate: MetadataCandidate, entry?: EntryPatch): Promise<ImportResult>;
  };
  collections: {
    list(): Promise<FilmCollection[]>;
    detail(collectionId: string): Promise<{ collection: FilmCollection; entries: CollectionEntry[] }>;
    create(input: { name: string; description?: string | null }): Promise<FilmCollection>;
    update(id: string, patch: { name?: string; description?: string | null }): Promise<FilmCollection>;
    remove(id: string): Promise<void>;
    addFilm(collectionId: string, entryId: string): Promise<FilmCollection>;
    removeFilm(collectionId: string, entryId: string): Promise<FilmCollection>;
    reorder(ids: string[]): Promise<FilmCollection[]>;
  };
  resources: {
    list(filmId: string): Promise<MediaResource[]>;
    create(input: ResourceInput): Promise<MediaResource>;
    update(id: string, patch: Partial<ResourceInput>): Promise<MediaResource>;
    remove(id: string): Promise<void>;
    open(url: string): Promise<void>;
    copy(text: string): Promise<void>;
  };
  metadata: {
    search(options: MetadataSearchOptions): Promise<MetadataSearchResult[]>;
    candidate(externalId: string, mediaType: MediaType): Promise<MetadataCandidate>;
    refresh(filmId: string): Promise<Film>;
    verifyKey(key: string): Promise<void>;
    saveKey(key: string): Promise<void>;
    clearKey(): Promise<void>;
  };
  settings: {
    get(): Promise<SettingsState>;
    update(patch: Partial<AppSettings>): Promise<SettingsState>;
  };
  data: {
    createBackup(): Promise<BackupResult>;
    validateBackup(path: string): Promise<BackupValidation>;
    chooseBackupFile(): Promise<string | null>;
    restore(path: string): Promise<RestoreResult>;
    exportJson(): Promise<ExportResult | null>;
  };
}

/** Thrown in the renderer when an IPC call returns an error envelope. */
export class ApiError extends Error {
  constructor(
    readonly code: SerializedError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
