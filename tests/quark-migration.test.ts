import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect,it } from 'vitest';
import { SqlDatabase } from '../electron/main/data/driver';
import { migrations } from '../electron/main/data/migrations';
import { openLibraryDatabase,peekSchemaVersion } from '../electron/main/data/database';
it('真实v2数据库升级前生成一致快照，保留收藏、评分和分享资源，再允许电影与剧集同ID',()=>{
  const directory=mkdtempSync(join(tmpdir(),'cinema-migration-'));
  let db: SqlDatabase | null = new SqlDatabase(join(directory,'library.db'));
  try {
    db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL)');
    for(const migration of migrations.filter(item=>item.version<=2)) {
      migration.up(db);db.prepare('INSERT INTO schema_migrations VALUES(?,?,?)').run(migration.version,migration.name,'2020-01-01');
    }
    db.prepare('INSERT INTO films(id,title,metadata_source,external_id,media_type,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('movie','旧收藏','tmdb','603','movie','2020','2020');
    db.prepare('INSERT INTO collection_entries(id,film_id,personal_rating,created_at,updated_at,collected_at) VALUES(?,?,?,?,?,?)').run('entry','movie',8.5,'2020','2020','2020');
    db.prepare('INSERT INTO media_resources(id,film_id,resource_name,share_url,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('share','movie','原分享','https://pan.quark.cn/s/example','2020','2020');
    db.close();db=null;
    const opened=openLibraryDatabase(join(directory,'library.db'));db=opened.db;
    expect(opened.applied).toEqual([3]);expect(opened.schemaVersion).toBe(3);
    expect(db.prepare('SELECT personal_rating FROM collection_entries').get()).toEqual({personal_rating:8.5});
    expect(db.prepare('SELECT resource_name FROM media_resources').get()).toEqual({resource_name:'原分享'});
    db.prepare('INSERT INTO films(id,title,metadata_source,external_id,media_type,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('tv','同ID剧集','tmdb','603','tv','2021','2021');
    expect(db.prepare('SELECT COUNT(*) AS count FROM films').get()).toEqual({count:2});
    const snapshots=readdirSync(join(directory,'backups'));expect(snapshots).toHaveLength(1);
    expect(peekSchemaVersion(join(directory,'backups',snapshots[0]))).toBe(2);
  } finally {db?.close();rmSync(directory,{recursive:true,force:true});}
});
