import { randomUUID } from 'node:crypto';
import type { SqlDatabase } from '../../data/driver';
import type { QuarkFolder, QuarkNameHint } from '../../../../src/shared/quark';
import type { QuarkMatchQuery, QuarkSyncSource } from '../../../../src/shared/quarkSync';
import type { QuarkResourceInfo } from '../../../../src/shared/quarkResource';

export interface CloudFile extends QuarkNameHint {
  id: string; parentId: string; name: string; path: string;
  mediaType: QuarkMatchQuery['mediaType']; groupKey: string;
  size: number | null; technical: QuarkResourceInfo;
}
export interface StoredFile extends CloudFile { filmId: string | null; present: boolean }
export interface SyncState extends QuarkSyncSource { scope: string }
export class SyncRepository {
  constructor(private readonly db: SqlDatabase) {}
  state(): SyncState {
    this.db.prepare('INSERT OR IGNORE INTO quark_sync_source(id,scope) VALUES (1,?)').run(randomUUID());
    const row = this.db.prepare('SELECT * FROM quark_sync_source WHERE id=1').get<any>()!;
    return { scope: row.scope, folder: row.folder_json ? JSON.parse(row.folder_json) : null,
      autoRead: Boolean(row.auto_read), autoImport: Boolean(row.auto_import), lastScanAt: row.last_scan_at };
  }
  configure(folder: QuarkFolder, autoRead: boolean, autoImport: boolean) {
    const previous=this.state();
    this.db.prepare('UPDATE quark_sync_source SET folder_json=?,auto_read=?,auto_import=?,last_scan_at=? WHERE id=1')
      .run(JSON.stringify(folder), Number(autoRead), Number(autoImport), previous.folder?.id===folder.id ? previous.lastScanAt : null);
  }
  reset() {
    this.state();
    this.db.prepare('UPDATE quark_sync_source SET scope=?,folder_json=NULL,auto_import=0,last_scan_at=NULL WHERE id=1').run(randomUUID());
  }
  files(scope: string, root: string, key?: string): StoredFile[] {
    return this.db.prepare(`SELECT file_id AS id,parent_id AS parentId,name,path,title,year,season,episode,
      size_bytes AS size,technical_json AS technical,media_type AS mediaType,group_key AS groupKey,film_id AS filmId,present FROM quark_cloud_files
      WHERE scope=? AND root_id=? AND present=1 ${key ? 'AND group_key=?' : ''} ORDER BY path`).all<any>(scope,root,...(key ? [key] : [])).map(row => ({ ...row, technical:JSON.parse(row.technical),present: Boolean(row.present) }));
  }
  replace(scope: string, root: string, files: CloudFile[], at: string) {
    this.db.transaction(() => {
      this.db.prepare('UPDATE quark_cloud_files SET present=0 WHERE scope=? AND root_id=?').run(scope,root);
      const statement=this.db.prepare(`INSERT INTO quark_cloud_files
        (scope,file_id,root_id,parent_id,name,path,title,year,season,episode,media_type,group_key,seen_at,size_bytes,technical_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(scope,file_id) DO UPDATE SET root_id=excluded.root_id,
        parent_id=excluded.parent_id,name=excluded.name,path=excluded.path,title=excluded.title,year=excluded.year,
        season=excluded.season,episode=excluded.episode,media_type=excluded.media_type,group_key=excluded.group_key,
        present=1,seen_at=excluded.seen_at,size_bytes=excluded.size_bytes,technical_json=excluded.technical_json`);
      for(const file of files) statement.run(scope,file.id,root,file.parentId,file.name,file.path,file.title,file.year,file.season,file.episode,file.mediaType,file.groupKey,at,file.size,JSON.stringify(file.technical));
      this.db.prepare('UPDATE quark_sync_source SET last_scan_at=? WHERE id=1 AND scope=?').run(at,scope);
    });
  }
  choice(scope: string, root: string, key: string): { filmId: string | null; ignored: boolean; query: QuarkMatchQuery | null } | null {
    const row=this.db.prepare('SELECT film_id,ignored,query_json FROM quark_match_choices WHERE scope=? AND root_id=? AND group_key=?').get<any>(scope,root,key);
    return row ? { filmId: row.film_id, ignored: Boolean(row.ignored), query: row.query_json ? JSON.parse(row.query_json) : null } : null;
  }
  setQuery(scope: string, root: string, key: string, query: QuarkMatchQuery) {
    this.db.prepare(`INSERT INTO quark_match_choices(scope,root_id,group_key,query_json) VALUES(?,?,?,?)
      ON CONFLICT(scope,root_id,group_key) DO UPDATE SET query_json=excluded.query_json`)
      .run(scope,root,key,JSON.stringify(query));
  }
  choose(scope: string, root: string, key: string, filmId: string | null, ignored: boolean, query: QuarkMatchQuery | null = null) {
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO quark_match_choices(scope,root_id,group_key,film_id,ignored,query_json) VALUES(?,?,?,?,?,?)
        ON CONFLICT(scope,root_id,group_key) DO UPDATE SET film_id=excluded.film_id,ignored=excluded.ignored,
        query_json=COALESCE(excluded.query_json,quark_match_choices.query_json)`)
        .run(scope,root,key,filmId,Number(ignored),query ? JSON.stringify(query) : null);
      this.db.prepare('UPDATE quark_cloud_files SET film_id=? WHERE scope=? AND root_id=? AND group_key=?').run(filmId,scope,root,key);
    });
  }
}
