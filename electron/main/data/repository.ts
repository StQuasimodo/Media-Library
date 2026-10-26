import type {
  AppSettings,
  CollectionEntry,
  Film,
  FilmCollection,
  FilmPatch,
  EntryPatch,
  LibraryQuery,
  LibrarySort,
  MediaResource,
  MetadataLanguage,
  MotionPreference,
  PosterDensity,
  ResourceInput,
  WatchStatus,
} from '../../../src/shared/types';
import type { SqlDatabase, SqlValue } from './driver';
import {
  collectionEntrySelect,
  entryJoinToEntry,
  rowToCollection,
  rowToEntry,
  rowToFilm,
  rowToResource,
  type CollectionRow,
  type EntryJoinRow,
  type EntryRow,
  type FilmRow,
  type ResourceRow,
} from './mappers';

const now = () => new Date().toISOString();

const ORDER_BY: Record<LibrarySort, string> = {
  collected_desc: 'e.collected_at DESC, e.sort_order ASC',
  collected_asc: 'e.collected_at ASC, e.sort_order ASC',
  title_asc: 'f.title ASC',
  title_desc: 'f.title DESC',
  year_desc: 'f.year IS NULL, f.year DESC, f.title ASC',
  year_asc: 'f.year IS NULL, f.year ASC, f.title ASC',
  rating_desc: 'e.personal_rating IS NULL, e.personal_rating DESC, f.title ASC',
};

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export function normaliseSort(value: unknown): LibrarySort {
  return typeof value === 'string' && value in ORDER_BY
    ? (value as LibrarySort)
    : 'collected_desc';
}

export class LibraryRepository {
  constructor(private readonly db: SqlDatabase) {}

  /** Groups several repository writes into one atomic unit. */
  inTransaction<T>(fn: () => T): T {
    return this.db.transaction(fn);
  }

  /* ---------------------------------------------------------------- */
  /* Films                                                             */
  /* ---------------------------------------------------------------- */

  insertFilm(film: Film): void {
    this.db
      .prepare(
        `INSERT INTO films (
           id, title, original_title, year, overview, tagline, poster_path, backdrop_path,
           media_type, runtime, genres, original_language, metadata_source, external_id,
           metadata_updated_at, created_at, updated_at, series_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        film.id,
        film.title,
        film.originalTitle,
        film.year,
        film.overview,
        film.tagline,
        film.posterPath,
        film.backdropPath,
        film.mediaType,
        film.runtime,
        JSON.stringify(film.genres),
        film.originalLanguage,
        film.metadataSource,
        film.externalId,
        film.metadataUpdatedAt,
        film.createdAt,
        film.updatedAt,
        film.series === undefined ? null : JSON.stringify(film.series),
      );
  }

  getFilm(id: string): Film | null {
    const row = this.db.prepare('SELECT * FROM films WHERE id = ?').get<FilmRow>(id);
    return row ? rowToFilm(row) : null;
  }

  getFilmByExternal(source: string, externalId: string, mediaType: Film['mediaType']): Film | null {
    const row = this.db
      .prepare('SELECT * FROM films WHERE metadata_source = ? AND external_id = ? AND media_type = ?')
      .get<FilmRow>(source, externalId, mediaType);
    return row ? rowToFilm(row) : null;
  }

  updateFilm(id: string, patch: FilmPatch & { metadataUpdatedAt?: string | null; series?: Film['series'] }): Film {
    const assignments: string[] = [];
    const values: SqlValue[] = [];

    const push = (column: string, value: SqlValue) => {
      assignments.push(`${column} = ?`);
      values.push(value);
    };

    if (patch.title !== undefined) push('title', patch.title);
    if (patch.originalTitle !== undefined) push('original_title', patch.originalTitle);
    if (patch.year !== undefined) push('year', patch.year);
    if (patch.overview !== undefined) push('overview', patch.overview);
    if (patch.tagline !== undefined) push('tagline', patch.tagline);
    if (patch.posterPath !== undefined) push('poster_path', patch.posterPath);
    if (patch.backdropPath !== undefined) push('backdrop_path', patch.backdropPath);
    if (patch.mediaType !== undefined) push('media_type', patch.mediaType);
    if (patch.runtime !== undefined) push('runtime', patch.runtime);
    if (patch.genres !== undefined) push('genres', JSON.stringify(patch.genres));
    if (patch.originalLanguage !== undefined) push('original_language', patch.originalLanguage);
    if (patch.series !== undefined) push('series_json',JSON.stringify(patch.series));
    if (patch.metadataUpdatedAt !== undefined) {
      push('metadata_updated_at', patch.metadataUpdatedAt);
    }

    if (assignments.length > 0) {
      push('updated_at', now());
      values.push(id);
      this.db
        .prepare(`UPDATE films SET ${assignments.join(', ')} WHERE id = ?`)
        .run(...values);
    }

    const film = this.getFilm(id);
    if (!film) throw new Error(`Film ${id} not found after update`);
    return film;
  }

  deleteFilm(id: string): void {
    // Cascades to collection_entries, collection_films and media_resources.
    this.db.prepare('DELETE FROM films WHERE id = ?').run(id);
  }

  listFilmYears(): number[] {
    const rows = this.db
      .prepare(
        'SELECT DISTINCT year FROM films WHERE year IS NOT NULL ORDER BY year DESC',
      )
      .all<{ year: number }>();
    return rows.map((row) => row.year);
  }

  listAllFilms(): Film[] {
    const rows = this.db.prepare('SELECT * FROM films ORDER BY created_at ASC').all<FilmRow>();
    return rows.map(rowToFilm);
  }

  listCloudResources(filmId?: string): import('../../../src/shared/quarkSync').QuarkCloudResource[] {
    return this.db.prepare(`SELECT scope || ':' || file_id AS id, film_id AS filmId, file_id AS fileId, name, path, season, episode,
      size_bytes AS size, technical_json AS technical,
      present, seen_at AS lastSeenAt, scope = (SELECT scope FROM quark_sync_source WHERE id = 1) AS active
      FROM quark_cloud_files ${filmId ? 'WHERE film_id = ?' : 'WHERE film_id IS NOT NULL'} ORDER BY path`)
      .all<any>(...(filmId ? [filmId] : [])).map(row => ({ ...row,technical:JSON.parse(row.technical),present: Boolean(row.present),active: Boolean(row.active) }));
  }

  listAllEntries(): CollectionEntry[] {
    const rows = this.db.prepare(`${collectionEntrySelect} ORDER BY e.created_at ASC`).all<EntryJoinRow>();
    const membership = this.collectionIdsForEntries(rows.map((row) => row.id));
    return rows.map((row) => entryJoinToEntry(row, membership.get(row.id) ?? []));
  }

  listMemberships(): Array<{ collectionId: string; entryId: string; sortOrder: number; addedAt: string }> {
    const rows = this.db
      .prepare(
        `SELECT collection_id, collection_entry_id, sort_order, added_at
         FROM collection_films ORDER BY collection_id, sort_order`,
      )
      .all<{
        collection_id: string;
        collection_entry_id: string;
        sort_order: number;
        added_at: string;
      }>();
    return rows.map((row) => ({
      collectionId: row.collection_id,
      entryId: row.collection_entry_id,
      sortOrder: row.sort_order,
      addedAt: row.added_at,
    }));
  }

  listAllResources(): MediaResource[] {
    const rows = this.db
      .prepare('SELECT * FROM media_resources ORDER BY created_at ASC')
      .all<ResourceRow>();
    return rows.map(rowToResource);
  }

  /* ---------------------------------------------------------------- */
  /* Collection entries                                                */
  /* ---------------------------------------------------------------- */

  insertEntry(entry: CollectionEntry): void {
    this.db
      .prepare(
        `INSERT INTO collection_entries (
           id, film_id, personal_rating, watch_status, collected_at, watched_at,
           favorite_reason, personal_review, sort_order, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.filmId,
        entry.personalRating,
        entry.watchStatus,
        entry.collectedAt,
        entry.watchedAt,
        entry.favoriteReason,
        entry.personalReview,
        entry.sortOrder,
        entry.createdAt,
        entry.updatedAt,
      );
  }

  getEntryByFilmId(filmId: string): CollectionEntry | null {
    const row = this.db
      .prepare(`${collectionEntrySelect} WHERE e.film_id = ?`)
      .get<EntryJoinRow>(filmId);
    if (!row) return null;
    return entryJoinToEntry(row, this.collectionIdsForEntry(row.id));
  }

  getEntry(id: string): CollectionEntry | null {
    const row = this.db
      .prepare(`${collectionEntrySelect} WHERE e.id = ?`)
      .get<EntryJoinRow>(id);
    if (!row) return null;
    return entryJoinToEntry(row, this.collectionIdsForEntry(row.id));
  }

  listEntries(query: LibraryQuery = {}): CollectionEntry[] {
    const where: string[] = [];
    const values: SqlValue[] = [];

    const search = query.search?.trim();
    if (search) {
      const term = `%${escapeLike(search)}%`;
      // Match title, original title, overview and collector notes so a search
      // for a line remembered from a personal review still finds the film.
      where.push(
        `(f.title LIKE ? ESCAPE '\\'
          OR COALESCE(f.original_title, '') LIKE ? ESCAPE '\\'
          OR COALESCE(f.overview, '') LIKE ? ESCAPE '\\'
          OR COALESCE(e.personal_review, '') LIKE ? ESCAPE '\\'
          OR COALESCE(e.favorite_reason, '') LIKE ? ESCAPE '\\')`,
      );
      values.push(term, term, term, term, term);
    }

    if (query.year != null) {
      where.push('f.year = ?');
      values.push(query.year);
    }

    if (query.watchStatus && query.watchStatus !== 'all') {
      where.push('e.watch_status = ?');
      values.push(query.watchStatus);
    }

    if (query.collectionId) {
      where.push(
        'EXISTS (SELECT 1 FROM collection_films cf WHERE cf.collection_entry_id = e.id AND cf.collection_id = ?)',
      );
      values.push(query.collectionId);
    }

    const orderBy = ORDER_BY[normaliseSort(query.sort)];
    const sql = `${collectionEntrySelect} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${orderBy}`;
    const rows = this.db.prepare(sql).all<EntryJoinRow>(...values);
    const membership = this.collectionIdsForEntries(rows.map((row) => row.id));
    return rows.map((row) => entryJoinToEntry(row, membership.get(row.id) ?? []));
  }

  updateEntry(id: string, patch: EntryPatch): CollectionEntry {
    const assignments: string[] = [];
    const values: SqlValue[] = [];

    const push = (column: string, value: SqlValue) => {
      assignments.push(`${column} = ?`);
      values.push(value);
    };

    if (patch.personalRating !== undefined) push('personal_rating', patch.personalRating);
    if (patch.watchStatus !== undefined) push('watch_status', patch.watchStatus);
    if (patch.collectedAt !== undefined) push('collected_at', patch.collectedAt);
    if (patch.watchedAt !== undefined) push('watched_at', patch.watchedAt);
    if (patch.favoriteReason !== undefined) push('favorite_reason', patch.favoriteReason);
    if (patch.personalReview !== undefined) push('personal_review', patch.personalReview);

    if (assignments.length > 0) {
      push('updated_at', now());
      values.push(id);
      this.db
        .prepare(`UPDATE collection_entries SET ${assignments.join(', ')} WHERE id = ?`)
        .run(...values);
    }

    const entry = this.getEntry(id);
    if (!entry) throw new Error(`Collection entry ${id} not found after update`);
    return entry;
  }

  countByStatus(): Record<WatchStatus | 'total', number> {
    const rows = this.db
      .prepare('SELECT watch_status, COUNT(*) AS count FROM collection_entries GROUP BY watch_status')
      .all<{ watch_status: WatchStatus; count: number }>();
    const result: Record<string, number> = { total: 0, want: 0, watching: 0, watched: 0, dropped: 0 };
    for (const row of rows) {
      result[row.watch_status] = row.count;
      result.total += row.count;
    }
    return result as Record<WatchStatus | 'total', number>;
  }

  nextEntrySortOrder(): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(sort_order), 0) AS max FROM collection_entries')
      .get<{ max: number }>();
    return (row?.max ?? 0) + 1;
  }

  /* ---------------------------------------------------------------- */
  /* Topics / collections                                              */
  /* ---------------------------------------------------------------- */

  listCollections(): FilmCollection[] {
    const rows = this.db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM collection_films cf WHERE cf.collection_id = c.id) AS film_count
         FROM collections c
         ORDER BY c.sort_order ASC, c.created_at ASC`,
      )
      .all<CollectionRow>();
    if (rows.length === 0) return [];
    const previews = this.collectionPreviewPosters(rows.map((row) => row.id));
    return rows.map((row) => rowToCollection(row, previews.get(row.id) ?? []));
  }

  getCollection(id: string): FilmCollection | null {
    const row = this.db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM collection_films cf WHERE cf.collection_id = c.id) AS film_count
         FROM collections c WHERE c.id = ?`,
      )
      .get<CollectionRow>(id);
    if (!row) return null;
    return rowToCollection(row, this.collectionPreviewPosters([row.id]).get(row.id) ?? []);
  }

  getCollectionByName(name: string): FilmCollection | null {
    const row = this.db
      .prepare('SELECT * FROM collections WHERE name = ? COLLATE NOCASE')
      .get<CollectionRow>(name);
    return row ? rowToCollection(row) : null;
  }

  createCollection(input: {
    id: string;
    name: string;
    description: string | null;
    coverPath: string | null;
  }): FilmCollection {
    const timestamp = now();
    const order = this.db
      .prepare('SELECT COALESCE(MAX(sort_order), 0) AS max FROM collections')
      .get<{ max: number }>();
    this.db
      .prepare(
        `INSERT INTO collections (id, name, description, cover_path, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.name,
        input.description,
        input.coverPath,
        (order?.max ?? 0) + 1,
        timestamp,
        timestamp,
      );
    const created = this.getCollection(input.id);
    if (!created) throw new Error('Collection insert failed');
    return created;
  }

  updateCollection(
    id: string,
    patch: { name?: string; description?: string | null; coverPath?: string | null },
  ): FilmCollection {
    const assignments: string[] = [];
    const values: SqlValue[] = [];
    if (patch.name !== undefined) {
      assignments.push('name = ?');
      values.push(patch.name);
    }
    if (patch.description !== undefined) {
      assignments.push('description = ?');
      values.push(patch.description);
    }
    if (patch.coverPath !== undefined) {
      assignments.push('cover_path = ?');
      values.push(patch.coverPath);
    }
    if (assignments.length > 0) {
      assignments.push('updated_at = ?');
      values.push(now());
      values.push(id);
      this.db
        .prepare(`UPDATE collections SET ${assignments.join(', ')} WHERE id = ?`)
        .run(...values);
    }
    const collection = this.getCollection(id);
    if (!collection) throw new Error(`Collection ${id} not found after update`);
    return collection;
  }

  deleteCollection(id: string): void {
    // Cascades to collection_films; films and entries are untouched.
    this.db.prepare('DELETE FROM collections WHERE id = ?').run(id);
  }

  reorderCollections(orderedIds: string[]): void {
    this.db.transaction(() => {
      const statement = this.db.prepare('UPDATE collections SET sort_order = ?, updated_at = ? WHERE id = ?');
      const timestamp = now();
      orderedIds.forEach((id, index) => {
        statement.run(index + 1, timestamp, id);
      });
    });
  }

  addFilmToCollection(collectionId: string, entryId: string): void {
    const order = this.db
      .prepare(
        'SELECT COALESCE(MAX(sort_order), 0) AS max FROM collection_films WHERE collection_id = ?',
      )
      .get<{ max: number }>(collectionId);
    this.db
      .prepare(
        `INSERT INTO collection_films (collection_id, collection_entry_id, sort_order, added_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (collection_id, collection_entry_id) DO NOTHING`,
      )
      .run(collectionId, entryId, (order?.max ?? 0) + 1, now());
    this.db
      .prepare('UPDATE collections SET updated_at = ? WHERE id = ?')
      .run(now(), collectionId);
  }

  removeFilmFromCollection(collectionId: string, entryId: string): void {
    this.db
      .prepare('DELETE FROM collection_films WHERE collection_id = ? AND collection_entry_id = ?')
      .run(collectionId, entryId);
    this.db
      .prepare('UPDATE collections SET updated_at = ? WHERE id = ?')
      .run(now(), collectionId);
  }

  listEntriesInCollection(collectionId: string): CollectionEntry[] {
    const rows = this.db
      .prepare(
        `${collectionEntrySelect}
         JOIN collection_films cf ON cf.collection_entry_id = e.id
         WHERE cf.collection_id = ?
         ORDER BY cf.sort_order ASC, e.collected_at DESC`,
      )
      .all<EntryJoinRow>(collectionId);
    const membership = this.collectionIdsForEntries(rows.map((row) => row.id));
    return rows.map((row) => entryJoinToEntry(row, membership.get(row.id) ?? []));
  }

  collectionIdsForEntry(entryId: string): string[] {
    return this.collectionIdsForEntries([entryId]).get(entryId) ?? [];
  }

  private collectionIdsForEntries(entryIds: string[]): Map<string, string[]> {
    const map = new Map<string, string[]>();
    if (entryIds.length === 0) return map;
    const placeholders = entryIds.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT collection_id, collection_entry_id FROM collection_films
         WHERE collection_entry_id IN (${placeholders})`,
      )
      .all<{ collection_id: string; collection_entry_id: string }>(...entryIds);
    for (const row of rows) {
      const list = map.get(row.collection_entry_id) ?? [];
      list.push(row.collection_id);
      map.set(row.collection_entry_id, list);
    }
    return map;
  }

  private collectionPreviewPosters(collectionIds: string[]): Map<string, string[]> {
    const map = new Map<string, string[]>();
    if (collectionIds.length === 0) return map;
    const placeholders = collectionIds.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT cf.collection_id, f.poster_path
         FROM collection_films cf
         JOIN collection_entries e ON e.id = cf.collection_entry_id
         JOIN films f ON f.id = e.film_id
         WHERE cf.collection_id IN (${placeholders}) AND f.poster_path IS NOT NULL
         ORDER BY cf.sort_order ASC`,
      )
      .all<{ collection_id: string; poster_path: string }>(...collectionIds);
    for (const row of rows) {
      const list = map.get(row.collection_id) ?? [];
      if (list.length < 4) list.push(row.poster_path);
      map.set(row.collection_id, list);
    }
    return map;
  }

  /* ---------------------------------------------------------------- */
  /* Quark resources                                                   */
  /* ---------------------------------------------------------------- */

  listResources(filmId: string): MediaResource[] {
    const rows = this.db
      .prepare('SELECT * FROM media_resources WHERE film_id = ? ORDER BY created_at ASC')
      .all<ResourceRow>(filmId);
    return rows.map(rowToResource);
  }

  getResource(id: string): MediaResource | null {
    const row = this.db.prepare('SELECT * FROM media_resources WHERE id = ?').get<ResourceRow>(id);
    return row ? rowToResource(row) : null;
  }

  createResource(id: string, input: ResourceInput): MediaResource {
    const timestamp = now();
    this.db
      .prepare(
        `INSERT INTO media_resources (
           id, film_id, provider, resource_name, share_url, access_code, quality_label,
           version_label, subtitle_label, audio_label, notes, availability_status, created_at, updated_at
         ) VALUES (?, ?, 'quark', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.filmId,
        input.resourceName,
        input.shareUrl,
        input.accessCode ?? null,
        input.qualityLabel ?? null,
        input.versionLabel ?? null,
        input.subtitleLabel ?? null,
        input.audioLabel ?? null,
        input.notes ?? null,
        input.availabilityStatus ?? 'unchecked',
        timestamp,
        timestamp,
      );
    const resource = this.getResource(id);
    if (!resource) throw new Error('Resource insert failed');
    return resource;
  }

  updateResource(id: string, patch: Partial<ResourceInput>): MediaResource {
    const mapping: Array<[keyof ResourceInput, string]> = [
      ['resourceName', 'resource_name'],
      ['shareUrl', 'share_url'],
      ['accessCode', 'access_code'],
      ['qualityLabel', 'quality_label'],
      ['versionLabel', 'version_label'],
      ['subtitleLabel', 'subtitle_label'],
      ['audioLabel', 'audio_label'],
      ['notes', 'notes'],
      ['availabilityStatus', 'availability_status'],
    ];
    const assignments: string[] = [];
    const values: SqlValue[] = [];
    for (const [key, column] of mapping) {
      const value = patch[key];
      if (value !== undefined) {
        assignments.push(`${column} = ?`);
        values.push((value as string | null) ?? null);
      }
    }
    if (assignments.length > 0) {
      assignments.push('updated_at = ?');
      values.push(now());
      values.push(id);
      this.db
        .prepare(`UPDATE media_resources SET ${assignments.join(', ')} WHERE id = ?`)
        .run(...values);
    }
    const resource = this.getResource(id);
    if (!resource) throw new Error(`Resource ${id} not found after update`);
    return resource;
  }

  deleteResource(id: string): void {
    this.db.prepare('DELETE FROM media_resources WHERE id = ?').run(id);
  }

  countResources(): number {
    const row = this.db
      .prepare('SELECT (SELECT COUNT(*) FROM media_resources) + (SELECT COUNT(*) FROM quark_cloud_files WHERE film_id IS NOT NULL) AS count')
      .get<{ count: number }>();
    return row?.count ?? 0;
  }

  /* ---------------------------------------------------------------- */
  /* Settings                                                          */
  /* ---------------------------------------------------------------- */

  getSettings(): AppSettings {
    const defaults: AppSettings = {
      metadataLanguage: 'zh-CN',
      defaultSort: 'collected_desc',
      posterDensity: 'comfortable',
      motionPreference: 'system',
    };
    const rows = this.db.prepare('SELECT key, value FROM app_settings').all<{
      key: string;
      value: string;
    }>();
    const stored = new Map(rows.map((row) => [row.key, row.value]));

    const language = stored.get('metadataLanguage');
    if (language === 'zh-CN' || language === 'en-US') {
      defaults.metadataLanguage = language as MetadataLanguage;
    }
    const density = stored.get('posterDensity');
    if (density === 'comfortable' || density === 'compact') {
      defaults.posterDensity = density as PosterDensity;
    }
    const motion = stored.get('motionPreference');
    if (motion === 'system' || motion === 'reduce' || motion === 'full') {
      defaults.motionPreference = motion as MotionPreference;
    }
    defaults.defaultSort = normaliseSort(stored.get('defaultSort'));
    return defaults;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, now());
  }

  allSettings(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM app_settings').all<{
      key: string;
      value: string;
    }>();
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }
}

export { rowToEntry, type EntryRow };
