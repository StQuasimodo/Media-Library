import { afterEach,beforeEach,expect,it } from 'vitest';
import { AppError } from '../electron/main/errors';
import { TestApp,candidate } from './helpers';
import { groupSeriesEntries,identifySeries,titleSequence } from '../src/shared/series';
import { TmdbProvider } from '../electron/main/services/metadata/tmdb';
import { MetadataService } from '../electron/main/services/metadataService';
import { SqlDatabase } from '../electron/main/data/driver';
import { migrations } from '../electron/main/data/migrations';
import { openLibraryDatabase,peekSchemaVersion } from '../electron/main/data/database';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
let app:TestApp;
beforeEach(()=>{app=new TestApp();});afterEach(()=>app.dispose());
const manual=(title:string,mediaType:'movie'|'tv'='movie')=>app.library.createManualFilm({title,mediaType}).entry;
it('同剧按真实TMDB身份聚合，季号按1、2、10排列，其他系列保留原相对顺序',async()=>{
  const tv=async(n:number)=> (await app.library.importCandidate(candidate({title:`译名不同 · 第${n}季`,mediaType:'tv',externalId:`1396:season:${n}`,posterUrl:null,backdropUrl:null}))).entry;
  const ten=await tv(10),other=manual('其他电影'),two=await tv(2),one=await tv(1);
  expect(groupSeriesEntries([ten,other,two,one]).map(e=>e.id)).toEqual([one.id,two.id,ten.id,other.id]);
});
it('标题支持阿拉伯、中文和罗马序号；无序号第一部与后续部相邻，防止普通相似片名误合并',()=>{
  const ten=manual('流浪地球10'),other=manual('流浪少年'),two=manual('流浪地球2'),one=manual('流浪地球');
  expect(groupSeriesEntries([ten,other,two,one]).map(e=>e.id)).toEqual([one.id,two.id,ten.id,other.id]);
  expect(titleSequence('绝命毒师 · 第十二季','tv')).toEqual({root:'绝命毒师',order:12});
  expect(titleSequence('Rocky IV','movie')).toEqual({root:'Rocky',order:4});
  expect(titleSequence('十二怒汉','movie')).toBeNull();expect(titleSequence('1917','movie')).toBeNull();
  expect(identifySeries([manual('哈利的故事'),manual('哈利的旅行'),manual('天下第一'),manual('独一无二'),manual('District9')]).size).toBe(0);
});
it('无相似片名的电影也按官方系列归类，手工序号可覆盖标题数字',async()=>{
  const create=async(title:string,id:string,order:number)=> (await app.library.importCandidate(candidate({title,externalId:id,posterUrl:null,backdropUrl:null,series:{key:'tmdb:collection:9',title:'系列',order}}))).entry;
  const third=await create('全然不同的续篇','3',3),first=await create('起点','1',1),second=await create('新的名称','2',2);
  expect(groupSeriesEntries([third,first,second]).map(e=>e.id)).toEqual([first.id,second.id,third.id]);
  app.library.updateFilm(third.filmId,{series:{key:'manual:movie:custom',title:'自定系列',order:1}});
  app.library.updateFilm(second.filmId,{series:{key:'manual:movie:custom',title:'自定系列',order:2}});
  expect(groupSeriesEntries([app.repo.getEntry(second.id)!,app.repo.getEntry(third.id)!]).map(e=>e.id)).toEqual([third.id,second.id]);
  await app.library.applyExternalMetadata(third.filmId,candidate({series:{key:'tmdb:collection:99',title:'外部系列',order:9},posterUrl:null,backdropUrl:null}));
  expect(app.repo.getFilm(third.filmId)?.series?.key).toBe('manual:movie:custom');
});
it('电影系列按官方成员首映顺序获取并缓存同系列列表，导入刷新均保留系列数据',async()=>{
  let collectionCalls=0;
  const provider=new TmdbProvider({getConfig:()=>({apiKey:'fixture-key',language:'zh-CN'}),fetchImpl:(async(input:string|URL|Request)=>{
    if(String(input).includes('/collection/9')){collectionCalls++;return Response.json({parts:[{id:2,release_date:'2010-01-01'},{id:1,release_date:'2000-01-01'}]});}
    return Response.json({title:'电影',overview:'简介',belongs_to_collection:{id:9,name:'系列'}});
  }) as typeof fetch});
  expect((await provider.getCandidate('2','movie')).series).toMatchObject({key:'tmdb:collection:9',order:2});
  expect((await provider.movieSeries('1'))?.order).toBe(1);expect(collectionCalls).toBe(1);
});
it('旧库后台补系列只更新系列资料，不改标题和个人字段；关闭上下文后禁止落库',async()=>{
  const film=await app.library.importCandidate(candidate({title:'我的自定义片名',posterUrl:null,backdropUrl:null}));
  app.library.updateEntry(film.entry.id,{personalRating:9});
  let finish!:(value:any)=>void;
  const provider={configured:true,movieSeries:()=>new Promise(resolve=>{finish=resolve;})} as unknown as TmdbProvider;
  const metadata=new MetadataService(provider,app.repo,app.library);
  const job=metadata.resolveSeries();finish({key:'tmdb:collection:1',title:'系列',order:2});await job;
  expect(app.repo.getFilm(film.film.id)).toMatchObject({title:'我的自定义片名',series:{order:2}});
  expect(app.repo.getEntry(film.entry.id)?.personalRating).toBe(9);
  const next=await app.library.importCandidate(candidate({externalId:'100',posterUrl:null,backdropUrl:null}));
  const pending=metadata.resolveSeries();metadata.dispose();finish(null);await pending;
  expect(app.repo.getFilm(next.film.id)?.series).toBeUndefined();
});
it('v3升级v4先备份并保留评分与原电影，系列未知不伪造',()=>{
  const path=join(app.dir,'v3.db');let db=new SqlDatabase(path);
  db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT,applied_at TEXT)');
  for(const migration of migrations.filter(m=>m.version<=3)){migration.up(db);db.prepare('INSERT INTO schema_migrations VALUES(?,?,?)').run(migration.version,migration.name,'fixture');}
  db.prepare('INSERT INTO films(id,title,created_at,updated_at) VALUES(?,?,?,?)').run('kept','原收藏','x','x');db.close();
  const opened=openLibraryDatabase(path);db=opened.db;
  expect(opened.applied).toEqual([4]);expect(db.prepare('SELECT title,series_json FROM films').get()).toEqual({title:'原收藏',series_json:null});db.close();
  const snapshots=readdirSync(join(app.dir,'backups')).filter(name=>name.startsWith('pre-migration-v3-'));expect(snapshots).toHaveLength(1);
  expect(peekSchemaVersion(join(app.dir,'backups',snapshots[0]))).toBe(3);
});

it('网络或鉴权失败暂停后台补充，避免对剩余收藏连续请求',async()=>{
  for(const id of ['1','2','3','4'])await app.library.importCandidate(candidate({externalId:id,posterUrl:null,backdropUrl:null}));
  let calls=0;
  const provider={configured:true,movieSeries:async()=>{calls++;throw new AppError('NETWORK','网络不可用');}} as unknown as TmdbProvider;
  const metadata=new MetadataService(provider,app.repo,app.library);
  await metadata.resolveSeries();expect(calls).toBeLessThanOrEqual(2);
  const previous=calls;await metadata.resolveSeries();expect(calls).toBe(previous);
});

it('手动重分类只影响选中的作品，不将同名其他作品带入自定义系列',()=>{
  const first=manual('影墙排序'),second=manual('影墙排序2'),tenth=manual('影墙排序10');
  app.library.updateFilm(second.filmId,{series:{key:'manual:movie:custom',title:'自定',order:2}});
  const entries=[first,app.repo.getEntry(second.id)!,tenth];const identities=identifySeries(entries);
  expect(identities.get(first.id)?.key).toBe(identities.get(tenth.id)?.key);
  expect(identities.get(second.id)?.key).not.toBe(identities.get(first.id)?.key);
});
