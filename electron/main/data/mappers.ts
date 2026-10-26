import type {
  AvailabilityStatus,
  CollectionEntry,
  Film,
  FilmSeries,
  FilmCollection,
  MediaResource,
  MediaType,
  MetadataSource,
  WatchStatus,
} from '../../../src/shared/types';

export interface FilmRow {
  id: string;
  title: string;
  original_title: string | null;
  year: number | null;
  overview: string | null;
  tagline: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  media_type: string;
  runtime: number | null;
  genres: string;
  original_language: string | null;
  metadata_source: string;
  external_id: string | null;
  series_json: string | null;
  metadata_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EntryRow {
  id: string;
  film_id: string;
  personal_rating: number | null;
  watch_status: string;
  collected_at: string;
  watched_at: string | null;
  favorite_reason: string | null;
  personal_review: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CollectionRow {
  id: string;
  name: string;
  description: string | null;
  cover_path: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  film_count?: number;
}

export interface ResourceRow {
  id: string;
  film_id: string;
  provider: string;
  resource_name: string;
  share_url: string;
  access_code: string | null;
  quality_label: string | null;
  version_label: string | null;
  subtitle_label: string | null;
  audio_label: string | null;
  notes: string | null;
  availability_status: string;
  created_at: string;
  updated_at: string;
}

export function parseGenres(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function parseSeries(raw: string | null): FilmSeries | null | undefined {
  if (raw == null) return undefined;
  try {
    const value=JSON.parse(raw);
    return value && typeof value.key==='string' && typeof value.title==='string' &&
      (value.order===null || (Number.isInteger(value.order) && value.order>=0)) ? value : null;
  } catch { return null; }
}

export function rowToFilm(row: FilmRow): Film {
  return {
    id: row.id,
    title: row.title,
    originalTitle: row.original_title,
    year: row.year,
    overview: row.overview,
    tagline: row.tagline,
    posterPath: row.poster_path,
    backdropPath: row.backdrop_path,
    mediaType: row.media_type === 'tv' ? 'tv' : 'movie',
    runtime: row.runtime,
    genres: parseGenres(row.genres),
    originalLanguage: row.original_language,
    metadataSource: row.metadata_source === 'tmdb' ? 'tmdb' : 'manual',
    externalId: row.external_id,
    series: parseSeries(row.series_json),
    metadataUpdatedAt: row.metadata_updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToEntry(row: EntryRow, film: Film, collectionIds: string[]): CollectionEntry {
  return {
    id: row.id,
    filmId: row.film_id,
    film,
    personalRating: row.personal_rating,
    watchStatus: row.watch_status as WatchStatus,
    collectedAt: row.collected_at,
    watchedAt: row.watched_at,
    favoriteReason: row.favorite_reason,
    personalReview: row.personal_review,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    collectionIds,
  };
}

export function rowToCollection(
  row: CollectionRow,
  previewPosterPaths: string[] = [],
): FilmCollection {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    coverPath: row.cover_path,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    filmCount: row.film_count ?? 0,
    previewPosterPaths,
  };
}

export function rowToResource(row: ResourceRow): MediaResource {
  return {
    id: row.id,
    filmId: row.film_id,
    provider: 'quark',
    resourceName: row.resource_name,
    shareUrl: row.share_url,
    accessCode: row.access_code,
    qualityLabel: row.quality_label,
    versionLabel: row.version_label,
    subtitleLabel: row.subtitle_label,
    audioLabel: row.audio_label,
    notes: row.notes,
    availabilityStatus: row.availability_status as AvailabilityStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const collectionEntrySelect = `
  SELECT
    e.id, e.film_id, e.personal_rating, e.watch_status, e.collected_at, e.watched_at,
    e.favorite_reason, e.personal_review, e.sort_order, e.created_at as entry_created_at,
    e.updated_at as entry_updated_at,
    f.id as f_id, f.title as f_title, f.original_title as f_original_title, f.year as f_year,
    f.overview as f_overview, f.tagline as f_tagline, f.poster_path as f_poster_path,
    f.backdrop_path as f_backdrop_path, f.media_type as f_media_type, f.runtime as f_runtime,
    f.genres as f_genres, f.original_language as f_original_language,
    f.metadata_source as f_metadata_source, f.external_id as f_external_id,
    f.series_json as f_series_json, f.metadata_updated_at as f_metadata_updated_at, f.created_at as f_created_at,
    f.updated_at as f_updated_at
  FROM collection_entries e
  JOIN films f ON f.id = e.film_id
`;

export interface EntryJoinRow extends EntryRow {
  f_id: string;
  f_title: string;
  f_original_title: string | null;
  f_year: number | null;
  f_overview: string | null;
  f_tagline: string | null;
  f_poster_path: string | null;
  f_backdrop_path: string | null;
  f_media_type: MediaType;
  f_runtime: number | null;
  f_genres: string;
  f_original_language: string | null;
  f_metadata_source: MetadataSource;
  f_external_id: string | null;
  f_series_json: string | null;
  f_metadata_updated_at: string | null;
  f_created_at: string;
  f_updated_at: string;
  entry_created_at: string;
  entry_updated_at: string;
}

export function entryJoinToFilm(row: EntryJoinRow): Film {
  return {
    id: row.f_id,
    title: row.f_title,
    originalTitle: row.f_original_title,
    year: row.f_year,
    overview: row.f_overview,
    tagline: row.f_tagline,
    posterPath: row.f_poster_path,
    backdropPath: row.f_backdrop_path,
    mediaType: row.f_media_type,
    runtime: row.f_runtime,
    genres: parseGenres(row.f_genres),
    originalLanguage: row.f_original_language,
    metadataSource: row.f_metadata_source,
    externalId: row.f_external_id,
    series: parseSeries(row.f_series_json),
    metadataUpdatedAt: row.f_metadata_updated_at,
    createdAt: row.f_created_at,
    updatedAt: row.f_updated_at,
  };
}

export function entryJoinToEntry(row: EntryJoinRow, collectionIds: string[]): CollectionEntry {
  const film = entryJoinToFilm(row);
  return {
    id: row.id,
    filmId: row.film_id,
    film,
    personalRating: row.personal_rating,
    watchStatus: row.watch_status as WatchStatus,
    collectedAt: row.collected_at,
    watchedAt: row.watched_at,
    favoriteReason: row.favorite_reason,
    personalReview: row.personal_review,
    sortOrder: row.sort_order,
    createdAt: row.entry_created_at,
    updatedAt: row.entry_updated_at,
    collectionIds,
  };
}
