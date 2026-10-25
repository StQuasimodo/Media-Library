import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { candidate, pngFetch, TestApp } from './helpers';
import { QuarkSync, type SyncReader } from '../electron/main/services/quark/sync';
import { MetadataService } from '../electron/main/services/metadataService';
import type { TmdbProvider } from '../electron/main/services/metadata/tmdb';
import type { MediaType, MetadataSearchResult } from '../src/shared/types';
import type { QuarkWebItem } from '../src/shared/quarkWeb';
import { AppError } from '../electron/main/errors';
import { rankMatches } from '../electron/main/services/quark/matching';

let app: TestApp, service: QuarkSync, configured: boolean, calls: number;
let tree: Record<string,QuarkWebItem[]>;
const folder={id:'source',name:'影视',path:'夸克网盘/影视'};
const item=(id:string,name:string,directory=false): QuarkWebItem=>({id,name,directory,video:!directory,size:null});
const movie={...candidate({externalId:'603',title:'The Matrix',originalTitle:'The Matrix',year:1999}),posterUrl:null,backdropUrl:null};
const show={...candidate({externalId:'603',title:'Dark',originalTitle:'Dark',year:2017,mediaType:'tv'}),posterUrl:null,backdropUrl:null};
let results: MetadataSearchResult[];
let searchError: Error | null;
let candidateOverride: ReturnType<typeof candidate> | null;
let readOverride: SyncReader['read'] | null;
const provider={get configured(){return configured;},search:async(options:{query:string})=>{
  calls++; if(searchError) throw searchError;
  return results.filter(result=>result.title.toLowerCase()===options.query.toLowerCase());
},getCandidate:async(_id:string,type:MediaType)=>candidateOverride ?? (type==='tv'?show:movie)};
const reader: SyncReader={folder:id=>id===folder.id?folder:null,ready:()=>{},read:async(id,signal)=>{
  if(readOverride)return readOverride(id,signal);return tree[id] ?? [];
}};
const context=()=>({db:app.db,repo:app.repo,library:app.library,metadata:new MetadataService(provider as unknown as TmdbProvider,app.repo,app.library)});
beforeEach(()=>{
  app=new TestApp();configured=true;calls=0;results=[movie,show];searchError=null;readOverride=null;candidateOverride=null;
  tree={source:[item('movie','The.Matrix.1999.1080p.mkv'),item('show','Dark.2017',true)],
    show:[item('season','Season 1',true)],season:[item('e1','S01E01.mkv'),item('e2','S01E02.mkv')]};
  service=new QuarkSync(context);service.bindReader(reader);service.configure(folder.id,true,false);
});
afterEach(()=>{app.dispose();});

describe('完整目录、匹配与真实 SQLite 关联',()=>{
  it('递归读取并归并剧集，首次候选不擅自入库；确认后关联真实FID',async()=>{
    const status=await service.scan();
    expect(status.videos).toBe(3);expect(status.groups).toHaveLength(2);
    expect(status.groups.map(group=>group.files).sort()).toEqual([1,2]);
    expect(status.groups.every(group=>group.candidates[0].confidence==='high')).toBe(true);
    expect(app.repo.listAllFilms()).toHaveLength(0);
    await service.confirmHigh();
    const films=app.repo.listAllFilms();expect(films).toHaveLength(2);
    const tv=films.find(film=>film.mediaType==='tv')!;
    expect(app.library.getFilmDetail(tv.id).cloudResources.map(file=>file.episode)).toEqual([1,2]);
    // TMDB movie and TV namespaces can contain the exact same numeric ID.
    expect(films.every(film=>film.externalId==='603')).toBe(true);
    expect(new Set(films.map(film=>film.id)).size).toBe(2);
  });
  it('可自动导入唯一高置信结果；新增集数与同FID改名增量复用，保留个人资料',async()=>{
    service.configure(folder.id,true,true);await service.scan();
    const tv=app.repo.listAllFilms().find(film=>film.mediaType==='tv')!;
    const entry=app.repo.getEntryByFilmId(tv.id)!;app.library.updateEntry(entry.id,{personalRating:8.5,personalReview:'我的短评'});
    const searched=calls;
    tree.season[0].name='Dark.S01E01.1080p.mkv';tree.season.push(item('e3','S01E03.mkv'));
    await service.scan();
    expect(calls).toBe(searched);expect(app.repo.listAllFilms()).toHaveLength(2);
    const detail=app.library.getFilmDetail(tv.id);
    expect(detail.cloudResources).toHaveLength(3);expect(detail.cloudResources.find(file=>file.fileId==='e1')?.name).toContain('Dark');
    expect(detail.entry).toMatchObject({personalRating:8.5,personalReview:'我的短评'});
  });
  it('完整读取后才标记未找到，始终保留收藏和原关联',async()=>{
    service.configure(folder.id,true,true);await service.scan();
    const tv=app.repo.listAllFilms().find(film=>film.mediaType==='tv')!;
    tree.season=tree.season.slice(0,1);await service.scan();
    expect(app.repo.listAllFilms()).toHaveLength(2);
    expect(app.library.getFilmDetail(tv.id).cloudResources).toHaveLength(2);
    expect(app.library.getFilmDetail(tv.id).cloudResources.find(file=>file.fileId==='e2')?.present).toBe(false);
  });
  it('中途失败不写半份目录、不误标资源消失',async()=>{
    service.configure(folder.id,true,true);await service.scan();
    const before=service.status();const film=app.repo.listAllFilms().find(film=>film.mediaType==='movie')!;
    tree.source=tree.source.filter(file=>file.id!=='movie');
    readOverride=async id=>{if(id==='season')throw new Error('transport failure');return tree[id];};
    await expect(service.scan()).rejects.toThrow();
    expect(service.status().source.lastScanAt).toBe(before.source.lastScanAt);
    expect(service.status().videos).toBe(3);expect(app.library.getFilmDetail(film.id).cloudResources[0].present).toBe(true);
  });
  it('取消目录读取保留上次完整状态，不产生收藏',async()=>{
    let started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});
    readOverride=async(id,signal)=>id==='season'?new Promise((_resolve,reject)=>{
      signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true});started();
    }):tree[id];
    const job=service.scan();const rejected=expect(job).rejects.toThrow();await ready;service.cancel();await rejected;
    expect(service.status()).toMatchObject({busy:false,videos:0,source:{lastScanAt:null}});
    expect(app.repo.listAllFilms()).toHaveLength(0);
  });
  it('取消正在缓存图片的导入，不会在请求返回后偷偷创建收藏',async()=>{
    app.dispose();
    let begun!:()=>void,finish!: (value:Response)=>void;
    const started=new Promise<void>(resolve=>{begun=resolve;});
    const response=new Promise<Response>(resolve=>{finish=resolve;});
    app=new TestApp({fetchImpl:(async()=>{begun();return response;}) as typeof fetch});
    service.configure(folder.id,true,true);tree.source=tree.source.slice(0,1);
    candidateOverride=candidate({...movie,posterUrl:'https://image.tmdb.org/cancel-test.png'});
    const job=service.scan();const rejected=expect(job).rejects.toThrow();
    await started;service.cancel();finish(await pngFetch()('https://image.tmdb.org/test.png'));
    await rejected;expect(app.repo.listAllFilms()).toHaveLength(0);
    expect(service.status().source.lastScanAt).not.toBeNull();
  });
  it('直接选季目录也从完整路径继承剧名与年份',async()=>{
    service.bindReader({...reader,folder:id=>id==='season'?{id,name:'Season 1',path:'夸克网盘/电视剧/Dark.2017/Season 1'}:null});
    service.configure('season',true,false);await service.scan();
    const groups=service.status().groups;
    expect(groups).toHaveLength(1);expect(groups[0].query).toEqual({title:'Dark',year:2017,mediaType:'tv'});
    expect(groups[0].files).toBe(2);
  });
  it('新增未知作品缺Key时，仍先给已确认剧集关联新增集数',async()=>{
    service.configure(folder.id,true,true);await service.scan();
    const tv=app.repo.listAllFilms().find(film=>film.mediaType==='tv')!;
    configured=false;tree.source.unshift(item('unknown','A.New.Film.2020.mkv'));
    tree.season.push(item('e3','S01E03.mkv'));await service.scan();
    expect(app.library.getFilmDetail(tv.id).cloudResources).toHaveLength(3);
    expect(service.status().error).toContain('配置 TMDB');
  });
  it('无Key仍保存完整目录，停止匹配并留下明确状态',async()=>{
    configured=false;await service.scan();
    expect(service.status().videos).toBe(3);expect(service.status().error).toContain('配置 TMDB');
    expect(service.status().groups.every(group=>group.state==='pending')).toBe(true);expect(calls).toBe(0);
  });
  it('网络或鉴权错误暂停队列，不对后续分组继续轰炸请求',async()=>{
    searchError=new AppError('NETWORK','网络不可达');await service.scan();
    expect(calls).toBe(1);expect(service.status().source.lastScanAt).not.toBeNull();
    expect(service.status().error).toContain('暂时无法继续');expect(app.repo.listAllFilms()).toHaveLength(0);
  });
  it('歧义结果不自动入库；用户只能确认本次候选',async()=>{
    results=[movie,{...movie,externalId:'999'}];tree.source=tree.source.slice(0,1);
    service.configure(folder.id,true,true);await service.scan();
    const group=service.status().groups[0];expect(group.candidates.every(candidate=>candidate.confidence==='review')).toBe(true);
    expect(app.repo.listAllFilms()).toHaveLength(0);
    await expect(service.confirm(group.key,'unoffered','movie')).rejects.toThrow('候选');
    await service.confirm(group.key,'603','movie');expect(app.repo.listAllFilms()).toHaveLength(1);
  });
  it('允许关联手动收藏，重启后自动读取复用关联，不覆盖评分或重新查询TMDB',async()=>{
    tree.source=tree.source.slice(0,1);await service.scan();
    const manual=app.library.createManualFilm({title:'我的黑客帝国',entry:{personalRating:9}});
    service.linkExisting(service.status().groups[0].key,manual.film.id);
    const searched=calls;app.restart();
    const restarted=new QuarkSync(context);restarted.bindReader(reader);await restarted.readOnStartup();
    expect(calls).toBe(searched);expect(restarted.status().groups[0].film?.id).toBe(manual.film.id);
    expect(app.library.getFilmDetail(manual.film.id).entry.personalRating).toBe(9);
    expect(app.library.getFilmDetail(manual.film.id).cloudResources[0].active).toBe(true);
  });
  it('忽略与更改匹配持久化，不删除原收藏',async()=>{
    service.configure(folder.id,true,true);await service.scan();
    const group=service.status().groups[0];service.ignore(group.key,true);const searched=calls;
    await service.scan();expect(calls).toBe(searched);expect(service.status().groups.find(item=>item.key===group.key)?.state).toBe('ignored');
    expect(app.repo.listAllFilms()).toHaveLength(2);
    service.ignore(group.key,false);expect(service.status().groups.find(item=>item.key===group.key)?.film).toBeNull();
    expect(app.repo.listAllFilms()).toHaveLength(2);
  });
  it('换连接隔离旧范围和FID，收藏保留，旧资源不会冒充当前连接',async()=>{
    service.configure(folder.id,true,true);await service.scan();const film=app.repo.listAllFilms()[0];
    service.resetConnection();expect(service.status().source.folder).toBeNull();
    expect(app.library.getFilmDetail(film.id).cloudResources.every(file=>!file.active)).toBe(true);
    service.configure(folder.id,true,true);await service.scan();
    const files=app.library.getFilmDetail(film.id).cloudResources;
    expect(files.some(file=>file.active)).toBe(true);expect(files.some(file=>!file.active)).toBe(true);
    expect(new Set(files.map(file=>file.id)).size).toBe(files.length);expect(app.repo.listAllFilms()).toHaveLength(2);
  });
  it('拒绝未知目录与正在运行期间更换范围，限制递归过大范围',async()=>{
    expect(()=>service.configure('unknown',true,false)).toThrow('范围');
    const massive=Array.from({length:201},(_,index)=>item('dir'+index,'目录'+index,true));tree.source=massive;
    await expect(service.scan()).rejects.toThrow('范围过大');expect(service.status().source.lastScanAt).toBeNull();
  });
});

it('电影与电视剧同名同年时也必须消歧，缺年份不授予高置信',()=>{
  expect(rankMatches([movie,{...movie,mediaType:'tv'}],{title:movie.title,year:movie.year,mediaType:'all'}).every(item=>item.confidence==='review')).toBe(true);
  expect(rankMatches([movie],{title:movie.title,year:null,mediaType:'movie'})[0].confidence).toBe('review');
});

it('合并分组遇到互相矛盾的旧关联时保留原值，不自动覆盖',async()=>{
  tree.source=[item('first','The.Matrix.1999.1080p.mkv'),item('second','Other.Film.2000.mkv')];
  await service.scan();
  const first=app.library.createManualFilm({title:'手动确认A'});
  const second=app.library.createManualFilm({title:'手动确认B'});
  for(const group of service.status().groups)service.linkExisting(group.key,group.query.year===1999?first.film.id:second.film.id);
  tree.source[1].name='The.Matrix.1999.2160p.mkv';service.configure(folder.id,true,true);
  await service.scan();
  const group=service.status().groups[0];expect(group.film).toBeNull();
  expect(group.candidates.every(candidate=>candidate.confidence==='review')).toBe(true);
  expect(group.error).toContain('不同作品');
  expect(app.library.getFilmDetail(first.film.id).cloudResources).toHaveLength(1);
  expect(app.library.getFilmDetail(second.film.id).cloudResources).toHaveLength(1);
});

it('资源画质、编码与大小跟随真实FID持久保存，改名重读更新字段而不重复入库',async()=>{
  tree.source[0]={...tree.source[0],name:'The.Matrix.1999.2160p.UHD.BluRay.HEVC.TrueHD.Atmos.7.1.REMUX.mkv',size:40_000_000_000};
  await service.scan();await service.confirmHigh();
  const film=app.repo.listAllFilms().find(film=>film.mediaType==='movie')!;
  app.restart();let file=app.library.getFilmDetail(film.id).cloudResources[0];
  expect(file.size).toBe(40_000_000_000);expect(file.technical).toMatchObject({resolution:'2160p',videoCodec:'H.265 / HEVC',audioCodecs:['TrueHD','Atmos'],audioChannels:['7.1']});
  tree.source[0].name='The.Matrix.1999.1080p.H264.mkv';
  service=new QuarkSync(context);service.bindReader(reader);await service.scan();
  file=app.library.getFilmDetail(film.id).cloudResources[0];
  expect(file.technical).toMatchObject({resolution:'1080p',videoCodec:'H.264 / AVC'});
  expect(app.library.getFilmDetail(film.id).cloudResources).toHaveLength(1);expect(app.repo.listAllFilms()).toHaveLength(2);
});
