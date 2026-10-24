/**
 * Domain types shared by the Electron main process and the React renderer.
 * These describe persisted entities only; UI-only view models live in the renderer.
 */

export type MediaType = 'movie' | 'tv';

export type WatchStatus = 'want' | 'watching' | 'watched' | 'dropped';

/** A resource starts as `unchecked`; the app never claims a link works unless the user says so. */
export type AvailabilityStatus = 'unchecked' | 'available' | 'unavailable';

export type MetadataSource = 'tmdb' | 'manual';

/** Only Quark is supported by design. */
export type ResourceProvider = 'quark';

export type LibrarySort =
  | 'collected_desc'
  | 'collected_asc'
  | 'title_asc'
  | 'title_desc'
  | 'year_desc'
  | 'year_asc'
  | 'rating_desc';

export type PosterDensity = 'comfortable' | 'compact';

export type MetadataLanguage = 'zh-CN' | 'en-US';

export type MotionPreference = 'system' | 'reduce' | 'full';

export interface Film {
  id: string;
  title: string;
  originalTitle: string | null;
  year: number | null;
  overview: string | null;
  tagline: string | null;
  /** Path relative to the image cache root, e.g. `poster/ab/cd1234.jpg`. Never an absolute path. */
  posterPath: string | null;
  backdropPath: string | null;
  mediaType: MediaType;
  runtime: number | null;
  genres: string[];
  originalLanguage: string | null;
  metadataSource: MetadataSource;
  externalId: string | null;
  metadataUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionEntry {
  id: string;
  filmId: string;
  film: Film;
  personalRating: number | null;
  watchStatus: WatchStatus;
  collectedAt: string;
  watchedAt: string | null;
  favoriteReason: string | null;
  personalReview: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  collectionIds: string[];
}

export interface FilmCollection {
  id: string;
  name: string;
  description: string | null;
  coverPath: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  filmCount: number;
  /** Cover image paths taken from the films inside, used when no explicit cover is set. */
  previewPosterPaths: string[];
}

export interface MediaResource {
  id: string;
  filmId: string;
  provider: ResourceProvider;
  resourceName: string;
  shareUrl: string;
  accessCode: string | null;
  qualityLabel: string | null;
  versionLabel: string | null;
  subtitleLabel: string | null;
  audioLabel: string | null;
  notes: string | null;
  availabilityStatus: AvailabilityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface FilmDetail {
  film: Film;
  entry: CollectionEntry;
  collections: FilmCollection[];
  resources: MediaResource[];
}

export interface AppSettings {
  metadataLanguage: MetadataLanguage;
  defaultSort: LibrarySort;
  posterDensity: PosterDensity;
  motionPreference: MotionPreference;
}

export interface SettingsState {
  settings: AppSettings;
  /** True when a metadata API key is stored (the key itself is never sent to the renderer). */
  hasMetadataApiKey: boolean;
  dataDirectory: string;
  appVersion: string;
  schemaVersion: number;
}

export interface LibraryStats {
  totalFilms: number;
  watchedFilms: number;
  watchingFilms: number;
  wantFilms: number;
  collectionCount: number;
  resourceCount: number;
}

export interface HomePayload {
  /** Most recently collected title with a backdrop, used for the hero band. */
  featured: CollectionEntry | null;
  recent: CollectionEntry[];
  collections: FilmCollection[];
  wantCount: number;
  stats: LibraryStats;
}

/* ------------------------------------------------------------------ */
/* Metadata (TMDB)                                                     */
/* ------------------------------------------------------------------ */

export interface MetadataSearchResult {
  source: MetadataSource;
  externalId: string;
  mediaType: MediaType;
  title: string;
  originalTitle: string | null;
  year: number | null;
  overview: string | null;
  posterUrl: string | null;
  popularity: number;
}

export interface MetadataCandidate extends MetadataSearchResult {
  backdropUrl: string | null;
  tagline: string | null;
  runtime: number | null;
  genres: string[];
  originalLanguage: string | null;
}

export interface MetadataSearchOptions {
  query: string;
  mediaType: MediaType | 'all';
  year?: number | null;
}

/* ------------------------------------------------------------------ */
/* Command payloads                                                    */
/* ------------------------------------------------------------------ */

export interface FilmPatch {
  title?: string;
  originalTitle?: string | null;
  year?: number | null;
  overview?: string | null;
  tagline?: string | null;
  mediaType?: MediaType;
  runtime?: number | null;
  genres?: string[];
  originalLanguage?: string | null;
  posterPath?: string | null;
  backdropPath?: string | null;
}

export interface EntryPatch {
  personalRating?: number | null;
  watchStatus?: WatchStatus;
  collectedAt?: string;
  watchedAt?: string | null;
  favoriteReason?: string | null;
  personalReview?: string | null;
}

export interface CollectionPatch {
  name?: string;
  description?: string | null;
  coverPath?: string | null;
}

export interface ResourceInput {
  filmId: string;
  resourceName: string;
  shareUrl: string;
  accessCode?: string | null;
  qualityLabel?: string | null;
  versionLabel?: string | null;
  subtitleLabel?: string | null;
  audioLabel?: string | null;
  notes?: string | null;
  availabilityStatus?: AvailabilityStatus;
}

export interface LibraryQuery {
  search?: string;
  year?: number | null;
  watchStatus?: WatchStatus | 'all';
  collectionId?: string | null;
  sort?: LibrarySort;
}

export interface ImportRequest {
  candidate: MetadataCandidate;
  /** Optional personal data collected in the same flow. */
  entry?: EntryPatch;
}

export interface ImportResult {
  film: Film;
  entry: CollectionEntry;
  duplicate: boolean;
  /** Set when the poster/backdrop could not be cached; import still succeeded. */
  imageWarning: string | null;
}

export interface BackupResult {
  path: string;
  bytes: number;
  createdAt: string;
}

export interface ExportResult {
  path: string;
  bytes: number;
  includesSensitiveData: boolean;
}

export interface RestoreResult {
  restored: boolean;
  backupOfPrevious: string | null;
  relaunchRequired: boolean;
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export type AppErrorCode =
  | 'NO_API_KEY'
  | 'INVALID_API_KEY'
  | 'RATE_LIMITED'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'NO_RESULTS'
  | 'BAD_RESPONSE'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'DUPLICATE'
  | 'INTERNAL';

export interface SerializedError {
  code: AppErrorCode;
  message: string;
}
