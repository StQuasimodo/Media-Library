import type { SqlDatabase } from './driver';

export interface Migration {
  version: number;
  name: string;
  up: (db: SqlDatabase) => void;
}

const now = () => new Date().toISOString();

/**
 * Ordered, append-only schema migrations.
 *
 * Never edit a released migration: shipped databases recorded their version and
 * will not re-run it. Add a new entry instead.
 */
export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE films (
          id                   TEXT PRIMARY KEY,
          title                TEXT NOT NULL,
          original_title       TEXT,
          year                 INTEGER,
          overview             TEXT,
          tagline              TEXT,
          poster_path          TEXT,
          backdrop_path        TEXT,
          media_type           TEXT NOT NULL DEFAULT 'movie'
                               CHECK (media_type IN ('movie', 'tv')),
          runtime              INTEGER,
          genres               TEXT NOT NULL DEFAULT '[]',
          original_language    TEXT,
          metadata_source      TEXT NOT NULL DEFAULT 'manual'
                               CHECK (metadata_source IN ('tmdb', 'manual')),
          external_id          TEXT,
          metadata_updated_at  TEXT,
          created_at           TEXT NOT NULL,
          updated_at           TEXT NOT NULL
        );

        CREATE UNIQUE INDEX films_external_unique
          ON films (metadata_source, external_id)
          WHERE external_id IS NOT NULL;
        CREATE INDEX films_title_idx ON films (title);
        CREATE INDEX films_year_idx ON films (year);

        CREATE TABLE collection_entries (
          id               TEXT PRIMARY KEY,
          film_id          TEXT NOT NULL UNIQUE REFERENCES films (id) ON DELETE CASCADE,
          personal_rating  REAL
                           CHECK (personal_rating IS NULL
                                  OR (personal_rating >= 0 AND personal_rating <= 10)),
          watch_status     TEXT NOT NULL DEFAULT 'want'
                           CHECK (watch_status IN ('want', 'watching', 'watched', 'dropped')),
          collected_at     TEXT NOT NULL,
          watched_at       TEXT,
          favorite_reason  TEXT,
          personal_review  TEXT,
          sort_order       INTEGER NOT NULL DEFAULT 0,
          created_at       TEXT NOT NULL,
          updated_at       TEXT NOT NULL
        );

        CREATE INDEX entries_status_idx ON collection_entries (watch_status, sort_order);
        CREATE INDEX entries_collected_idx ON collection_entries (collected_at);

        CREATE TABLE collections (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          description TEXT,
          cover_path  TEXT,
          sort_order  INTEGER NOT NULL DEFAULT 0,
          created_at  TEXT NOT NULL,
          updated_at  TEXT NOT NULL
        );

        CREATE UNIQUE INDEX collections_name_unique ON collections (name COLLATE NOCASE);

        CREATE TABLE collection_films (
          collection_id       TEXT NOT NULL REFERENCES collections (id) ON DELETE CASCADE,
          collection_entry_id TEXT NOT NULL REFERENCES collection_entries (id) ON DELETE CASCADE,
          sort_order          INTEGER NOT NULL DEFAULT 0,
          added_at            TEXT NOT NULL,
          PRIMARY KEY (collection_id, collection_entry_id)
        );

        CREATE INDEX collection_films_entry_idx ON collection_films (collection_entry_id);

        CREATE TABLE media_resources (
          id                  TEXT PRIMARY KEY,
          film_id             TEXT NOT NULL REFERENCES films (id) ON DELETE CASCADE,
          provider            TEXT NOT NULL DEFAULT 'quark' CHECK (provider = 'quark'),
          resource_name       TEXT NOT NULL,
          share_url           TEXT NOT NULL,
          access_code         TEXT,
          quality_label       TEXT,
          version_label       TEXT,
          subtitle_label      TEXT,
          audio_label         TEXT,
          notes               TEXT,
          availability_status TEXT NOT NULL DEFAULT 'unchecked'
                              CHECK (availability_status IN ('unchecked', 'available', 'unavailable')),
          created_at          TEXT NOT NULL,
          updated_at          TEXT NOT NULL
        );

        CREATE INDEX resources_film_idx ON media_resources (film_id);

        CREATE TABLE app_settings (
          key        TEXT PRIMARY KEY,
          value      TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 2,
    name: 'schema_migration_bookkeeping',
    up: (db) => {
      // Created by the migrator before migrations run, so this migration only
      // seeds sensible defaults for settings introduced with the table.
      const timestamp = now();
      const insert = db.prepare(
        'INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)',
      );
      insert.run('metadataLanguage', 'zh-CN', timestamp);
      insert.run('defaultSort', 'collected_desc', timestamp);
      insert.run('posterDensity', 'comfortable', timestamp);
      insert.run('motionPreference', 'system', timestamp);
    },
  },
  {
    version: 3,
    name: 'quark_cloud_matching_and_typed_tmdb_identity',
    up: db => {
      db.exec(`
        DROP INDEX films_external_unique;
        CREATE UNIQUE INDEX films_external_unique ON films(metadata_source, media_type, external_id)
          WHERE external_id IS NOT NULL;
        CREATE TABLE quark_sync_source (
          id INTEGER PRIMARY KEY CHECK(id = 1), scope TEXT NOT NULL,
          folder_json TEXT, auto_read INTEGER NOT NULL DEFAULT 1,
          auto_import INTEGER NOT NULL DEFAULT 0, last_scan_at TEXT
        );
        CREATE TABLE quark_cloud_files (
          scope TEXT NOT NULL, file_id TEXT NOT NULL, root_id TEXT NOT NULL,
          parent_id TEXT NOT NULL, name TEXT NOT NULL, path TEXT NOT NULL,
          size_bytes INTEGER, technical_json TEXT NOT NULL DEFAULT '{}',
          title TEXT NOT NULL, year INTEGER, season INTEGER, episode INTEGER,
          media_type TEXT NOT NULL, group_key TEXT NOT NULL,
          film_id TEXT REFERENCES films(id) ON DELETE SET NULL,
          present INTEGER NOT NULL DEFAULT 1, seen_at TEXT NOT NULL,
          PRIMARY KEY(scope, file_id)
        );
        CREATE INDEX quark_cloud_film_idx ON quark_cloud_files(film_id);
        CREATE INDEX quark_cloud_group_idx ON quark_cloud_files(scope, root_id, group_key);
        CREATE TABLE quark_match_choices (
          scope TEXT NOT NULL, root_id TEXT NOT NULL, group_key TEXT NOT NULL,
          film_id TEXT REFERENCES films(id) ON DELETE CASCADE,
          ignored INTEGER NOT NULL DEFAULT 0, query_json TEXT,
          PRIMARY KEY(scope, root_id, group_key)
        );
      `);
    },
  },
];

export const SCHEMA_VERSION = migrations[migrations.length - 1].version;
