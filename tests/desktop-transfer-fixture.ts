import { join } from 'node:path';
import type { Film } from '../src/shared/types';
import { BackupService } from '../electron/main/services/backup';
import { SCHEMA_VERSION } from '../electron/main/data/migrations';
import { SyncRepository } from '../electron/main/services/quark/syncRepository';
import { TestApp } from './helpers';
export const transferStamp='2026-11-18T00:00:00.000Z';
export function transferService(app:TestApp){return new BackupService({dbFile:app.dbFile,backupDir:join(app.dir,'backups'),schemaVersion:SCHEMA_VERSION,appVersion:'migration-test',logger:app.logger,getDb:()=>app.db,getRepo:()=>app.repo,closeDb:()=>app.db.close(),openDb:()=>app.restart()});}
export function seedDesktopTransfer(app:TestApp){
 const common={year:1999,overview:'跨端收藏迁移测试',tagline:null,posterPath:'poster/windows-only.jpg',backdropPath:'backdrop/windows-only.jpg',runtime:120,genres:['剧情'],originalLanguage:'en',metadataSource:'tmdb' as const,metadataUpdatedAt:transferStamp,createdAt:transferStamp,updatedAt:transferStamp};
 const films:Film[]=[{...common,id:'desktop-matrix',title:'黑客帝国',originalTitle:'The Matrix',mediaType:'movie',externalId:'603',series:{key:'tmdb:collection:234',title:'黑客帝国系列',order:1}},{...common,id:'desktop-season',title:'绝命毒师 · 第1季',originalTitle:'Breaking Bad Season 1',mediaType:'tv',externalId:'1396:season:1',year:2008,series:{key:'tmdb:tv:1396',title:'绝命毒师',order:1,franchise:{key:'manual:crime','title':'犯罪宇宙'}}}];
 for(const [n,film] of films.entries()){app.repo.insertFilm(film);app.repo.insertEntry({id:'entry-'+film.id,filmId:film.id,film,personalRating:n?9.5:8.5,watchStatus:'watched',collectedAt:transferStamp,watchedAt:transferStamp,favoriteReason:'收藏理由 ✓',personalReview:'保留电脑短评',sortOrder:n,createdAt:transferStamp,updatedAt:transferStamp,collectionIds:[]});}
 const topic=app.repo.createCollection({id:'desktop-topic',name:'重看计划',description:'电影与剧集',coverPath:null});for(const f of films)app.repo.addFilmToCollection(topic.id,'entry-'+f.id);
 app.repo.createResource('desktop-resource',{filmId:films[0].id,resourceName:'夸克分享',shareUrl:'https://pan.quark.cn/s/migration-fixture',accessCode:'test',qualityLabel:'2160p',versionLabel:'原盘',subtitleLabel:'简体中文',audioLabel:'DTS',notes:'公开测试记录',availabilityStatus:'unchecked'});
 const store=new SyncRepository(app.db),state=store.state();store.configure({id:'migrate-root',name:'影视',path:'/影视'},true,false);
 const insert=app.db.prepare(`INSERT INTO quark_cloud_files(scope,file_id,root_id,parent_id,name,path,size_bytes,title,media_type,group_key,present,seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
 for(const [id,name,group,present] of [['migrate-matrix-file','The.Matrix.1999.1080p.H264.mkv','matrix',1],['migrate-season-e01','Breaking.Bad.S01E01.1080p.mkv','season',1],['migrate-season-e02','Breaking.Bad.S01E02.1080p.mkv','season',1],['migrate-ignored-file','花絮.mp4','ignored',0],['migrate-pending-file','未确认.mp4','pending',1]] as const){insert.run(state.scope,id,'migrate-root','migrate-root',name,'/影视/'+name,123456,name,'movie',group,present,transferStamp);}
 store.choose(state.scope,'migrate-root','matrix',films[0].id,false);store.choose(state.scope,'migrate-root','season',films[1].id,false);store.choose(state.scope,'migrate-root','ignored',null,true);
 insert.run('different-account','not-this-account','other-root','other-root','other.mkv','/other.mkv',100,'Other','movie','other',1,transferStamp);
 app.db.prepare(`UPDATE quark_cloud_files SET film_id=? WHERE scope='different-account'`).run(films[0].id);
 for(const table of ['collections','media_resources'])app.db.prepare(`UPDATE ${table} SET created_at=?,updated_at=?`).run(transferStamp,transferStamp);app.db.prepare('UPDATE collection_films SET added_at=?').run(transferStamp);
}
