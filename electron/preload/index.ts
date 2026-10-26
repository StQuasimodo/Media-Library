import { contextBridge, ipcRenderer } from 'electron';
import type { AppInfo, BackupValidation, CinemaApi } from '../../src/shared/api';
import type { QuarkWebStatus, QuarkWebDirectory } from '../../src/shared/quarkWeb';
import type { QuarkBrowse, QuarkStatus } from '../../src/shared/quark';
import type { QuarkSyncStatus } from '../../src/shared/quarkSync';
import type {
  AppSettings,
  BackupResult,
  CollectionEntry,
  EntryPatch,
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
  SettingsState,
} from '../../src/shared/types';

interface ErrorEnvelope {
  ok: false;
  error: { code: string; message: string };
}

interface SuccessEnvelope<T> {
  ok: true;
  data: T;
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const response = (await ipcRenderer.invoke(channel, ...args)) as
    | SuccessEnvelope<T>
    | ErrorEnvelope;
  if (!response || typeof response !== 'object') {
    throw new Error('主进程没有返回结果。');
  }
  if (!response.ok) {
    const error = new Error(response.error.message);
    error.name = response.error.code;
    throw error;
  }
  return response.data;
}

const api: CinemaApi = {
  quarkSync: {
    status: () => invoke<QuarkSyncStatus>('quark-sync:status'),
    configure: (id,autoRead,autoImport) => invoke<QuarkSyncStatus>('quark-sync:configure',id,autoRead,autoImport),
    scan: () => invoke<QuarkSyncStatus>('quark-sync:scan'),
    match: () => invoke<QuarkSyncStatus>('quark-sync:match'),
    search: (key,query) => invoke<QuarkSyncStatus>('quark-sync:search',key,query),
    confirm: (key,id,type) => invoke<QuarkSyncStatus>('quark-sync:confirm',key,id,type),
    createManual: (key,query) => invoke<QuarkSyncStatus>('quark-sync:createManual',key,query),
    confirmHigh: () => invoke<QuarkSyncStatus>('quark-sync:confirmHigh'),
    linkExisting: (key,id) => invoke<QuarkSyncStatus>('quark-sync:linkExisting',key,id),
    ignore: (key,ignored) => invoke<QuarkSyncStatus>('quark-sync:ignore',key,ignored),
    cancel: () => invoke<void>('quark-sync:cancel'),
  },
  quarkWeb: {
    status: () => invoke<QuarkWebStatus>('quark-web:status'),
    connect: () => invoke<QuarkWebStatus>('quark-web:connect'),
    finishLogin: () => invoke<QuarkWebStatus>('quark-web:finishLogin'),
    check: () => invoke<QuarkWebStatus>('quark-web:check'),
    list: id => invoke<QuarkWebDirectory>('quark-web:list', id),
    disconnect: () => invoke<QuarkWebStatus>('quark-web:disconnect'),
  },
  quark: {
    status: () => invoke<QuarkStatus>('quark:status'),
    chooseTool: () => invoke<QuarkStatus | null>('quark:chooseTool'),
    browse: (id) => invoke<QuarkBrowse>('quark:browse', id),
    selectFolder: (id, recursive, autoRead) => invoke<QuarkStatus>('quark:selectFolder', id, recursive, autoRead),
    scan: () => invoke<QuarkStatus>('quark:scan'),
    cancel: () => invoke<void>('quark:cancel'),
  },
  app: {
    info: () => invoke<AppInfo>('app:info'),
    openExternal: (url) => invoke<void>('app:openExternal', url),
    openFolder: (kind) => invoke<void>('app:openFolder', kind),
    relaunch: () => invoke<void>('app:relaunch'),
  },
  library: {
    home: () => invoke<HomePayload>('library:home'),
    stats: () => invoke<LibraryStats>('library:stats'),
    list: (query: LibraryQuery) => invoke<CollectionEntry[]>('library:list', query),
    years: () => invoke<number[]>('library:years'),
    detail: (filmId) => invoke<FilmDetail>('library:detail', filmId),
    createManual: (input) => invoke<FilmDetail>('library:createManual', input),
    updateFilm: (filmId, patch: FilmPatch) => invoke<Film>('library:updateFilm', filmId, patch),
    updateEntry: (entryId, patch: EntryPatch) =>
      invoke<CollectionEntry>('library:updateEntry', entryId, patch),
    removeFilm: (filmId) => invoke<{ removedResources: number }>('library:removeFilm', filmId),
    importCandidate: (candidate: MetadataCandidate, entry?: EntryPatch) =>
      invoke<ImportResult>('library:importCandidate', candidate, entry),
  },
  collections: {
    list: () => invoke<FilmCollection[]>('collections:list'),
    detail: (collectionId) =>
      invoke<{ collection: FilmCollection; entries: CollectionEntry[] }>(
        'collections:detail',
        collectionId,
      ),
    create: (input) => invoke<FilmCollection>('collections:create', input),
    update: (id, patch) => invoke<FilmCollection>('collections:update', id, patch),
    remove: (id) => invoke<void>('collections:remove', id),
    addFilm: (collectionId, entryId) =>
      invoke<FilmCollection>('collections:addFilm', collectionId, entryId),
    removeFilm: (collectionId, entryId) =>
      invoke<FilmCollection>('collections:removeFilm', collectionId, entryId),
    reorder: (ids) => invoke<FilmCollection[]>('collections:reorder', ids),
  },
  resources: {
    list: (filmId) => invoke<MediaResource[]>('resources:list', filmId),
    create: (input: ResourceInput) => invoke<MediaResource>('resources:create', input),
    update: (id, patch) => invoke<MediaResource>('resources:update', id, patch),
    remove: (id) => invoke<void>('resources:remove', id),
    open: (url) => invoke<void>('resources:open', url),
    copy: (text) => invoke<void>('resources:copy', text),
  },
  metadata: {
    search: (options: MetadataSearchOptions) =>
      invoke<MetadataSearchResult[]>('metadata:search', options),
    candidate: (externalId, mediaType: MediaType) =>
      invoke<MetadataCandidate>('metadata:candidate', externalId, mediaType),
    refresh: (filmId) => invoke<Film>('metadata:refresh', filmId),
    verifyKey: (key) => invoke<void>('metadata:verifyKey', key),
    saveKey: (key) => invoke<void>('metadata:saveKey', key),
    clearKey: () => invoke<void>('metadata:clearKey'),
  },
  settings: {
    get: () => invoke<SettingsState>('settings:get'),
    update: (patch: Partial<AppSettings>) => invoke<SettingsState>('settings:update', patch),
  },
  data: {
    createBackup: () => invoke<BackupResult>('data:createBackup'),
    validateBackup: (path) => invoke<BackupValidation>('data:validateBackup', path),
    chooseBackupFile: () => invoke<string | null>('data:chooseBackupFile'),
    restore: (path) => invoke<RestoreResult>('data:restore', path),
    exportJson: () => invoke<ExportResult | null>('data:exportJson'),
  },
};

contextBridge.exposeInMainWorld('cinema', api);
