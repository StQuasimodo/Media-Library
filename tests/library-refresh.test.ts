import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryRefresh } from '../electron/main/services/libraryRefresh';
import { MetadataService } from '../electron/main/services/metadataService';
import { QuarkSync } from '../electron/main/services/quark/sync';
import type { TmdbProvider } from '../electron/main/services/metadata/tmdb';
import { AppError } from '../electron/main/errors';
import { TestApp, candidate, pngFetch } from './helpers';
import type { QuarkStatus } from '../src/shared/quark';

let app: TestApp;
let configured: boolean;
let metadata: MetadataService;
let sync: QuarkSync;
let refresh: LibraryRefresh;
let lookup: (id: string) => Promise<ReturnType<typeof candidate>>;
let readFailure: boolean;
let files: Array<{id:string;name:string;directory:boolean;video:boolean;size:number}>;
const folder = { id: 'media', name: '影视', path: '夸克网盘/影视' };
const emptyLegacy: QuarkStatus = { busy: false, folder: null, error: null, toolPath: null, recursive: true, autoRead: false, notices: [], inventory: null };
const legacy = { status: vi.fn(() => emptyLegacy), scan: vi.fn(), cancel: vi.fn() };

beforeEach(() => {
  app = new TestApp({ fetchImpl: pngFetch() }); configured = true; readFailure = false;
  files = [{id:'a',name:'Movie.2020.1080p.mkv',directory:false,video:true,size:100}];
  lookup = async id => candidate({externalId:id,title:`更新后的${id}`,posterUrl:`https://image.tmdb.org/t/p/w500/new-${id}.png`,backdropUrl:null});
  metadata = new MetadataService({ get configured() { return configured; }, search: async () => [], getCandidate: (id:string) => lookup(id) } as unknown as TmdbProvider, app.repo, app.library);
  sync = new QuarkSync(() => ({db:app.db,repo:app.repo,library:app.library,metadata}));
  sync.bindReader({folder: id => id === folder.id ? folder : null,ready:()=>{},read:async()=>{
    if (readFailure) throw new Error('private transport details must not escape'); return files;
  }});
  legacy.status.mockReset().mockReturnValue(emptyLegacy); legacy.scan.mockReset(); legacy.cancel.mockReset();
  refresh = new LibraryRefresh(() => ({repo:app.repo,metadata}), sync, legacy);
});
afterEach(async () => { refresh.cancel(); await refresh.wait(); app.dispose(); });

async function add(id: string) { return app.library.importCandidate(candidate({externalId:id,title:`原名${id}`})); }

describe('影视库一键刷新', () => {
  it('兼容已配置的官方工具目录读取，失败与网页目录结果分别汇总', async () => {
    await add('1');sync.configure(folder.id,false,false);
    legacy.status.mockReturnValue({...emptyLegacy,folder});legacy.scan.mockRejectedValue(new AppError('NETWORK','官方工具暂时无法读取。'));
    refresh.start();const result=await refresh.wait();
    expect(legacy.scan).toHaveBeenCalledOnce();expect(result.quark.state).toBe('partial');expect(result.updated).toBe(1);
  });
  it('已有目录任务时拒绝启动，避免并发覆盖同步状态', async () => {
    let release!:(value:[])=>void;
    sync.bindReader({folder:()=>folder,ready:()=>{},read:()=>new Promise(resolve=>{release=resolve;})});sync.configure(folder.id,false,false);
    const pending=sync.scan();expect(()=>refresh.start()).toThrow('目录匹配任务');release([]);await pending;
    expect(refresh.status().id).toBe(0);
  });
  it('重读完整目录和文件规格，保留明确关联、评分、专题、资源与手动系列；手动收藏跳过', async () => {
    const first=await add('1'); await add('2'); app.library.createManualFilm({title:'手动作品'});
    app.library.updateEntry(first.entry.id,{personalRating:9.2,personalReview:'不要覆盖',favoriteReason:'收藏理由'});
    app.library.updateFilm(first.film.id,{series:{key:'manual:mine',title:'私人系列',order:2,customOrder:true}});
    const topic=app.library.createCollection({name:'自选专题'});app.library.addFilmToCollection(topic.id,first.entry.id);
    app.library.createResource({filmId:first.film.id,resourceName:'分享记录',shareUrl:'https://pan.quark.cn/s/fixture'});
    sync.configure(folder.id,false,false);await sync.scan();sync.linkExisting(sync.status().groups[0].key,first.film.id);
    files.push({id:'b',name:'Movie.2020.2160p.HEVC.mkv',directory:false,video:true,size:200});
    refresh.start();const result=await refresh.wait();app.restart();
    expect(result).toMatchObject({total:3,completed:3,updated:2,skipped:1,failed:0,busy:false,quark:{state:'updated'}});
    const detail=app.library.getFilmDetail(first.film.id);
    expect(detail.film.title).toBe('更新后的1');expect(detail.entry).toMatchObject({personalRating:9.2,personalReview:'不要覆盖',favoriteReason:'收藏理由'});
    expect(detail.film.series?.key).toBe('manual:mine');expect(detail.resources).toHaveLength(1);
    expect(detail.collections.some(value=>value.id===topic.id)).toBe(true);
    expect(detail.cloudResources).toHaveLength(2);expect(detail.cloudResources.find(value=>value.fileId==='b')?.technical).toMatchObject({resolution:'2160p'});
  });
  it('夸克读取失败保留上次完整清单，仍刷新影视资料', async () => {
    await add('1');sync.configure(folder.id,false,false);await sync.scan();const previous=sync.status().source.lastScanAt;
    readFailure=true;refresh.start();const result=await refresh.wait();
    expect(result.quark.state).toBe('failed');expect(result.updated).toBe(1);
    expect(sync.status().videos).toBe(1);expect(sync.status().source.lastScanAt).toBe(previous);
    expect(JSON.stringify(result)).not.toContain('private transport details');
  });
  it('未配置TMDB时仍更新夸克清单，明确跳过影视资料', async () => {
    await add('1');configured=false;sync.configure(folder.id,false,false);
    refresh.start();const result=await refresh.wait();
    expect(sync.status().videos).toBe(1);expect(result).toMatchObject({updated:0,skipped:1,completed:1});
    expect(result.message).toContain('TMDB');
  });
  it('单部404继续其余作品；失败列表保留可识别的作品名称', async () => {
    await add('1');await add('2');lookup=async id=>{if(id==='1')throw new AppError('NOT_FOUND','TMDB资料已移除。');return candidate({externalId:id,title:'继续成功'});};
    refresh.start();const result=await refresh.wait();
    expect(result).toMatchObject({updated:1,failed:1,completed:2,quark:{state:'skipped'}});
    expect(result.errors[0]).toMatchObject({title:'原名1',message:'TMDB资料已移除。'});
  });
  it.each(['RATE_LIMITED','INVALID_API_KEY','NETWORK','BAD_RESPONSE'] as const)('%s后停止后续请求，不把未尝试作品计作成功', async code => {
    await add('1');await add('2');await add('3');const calls:string[]=[];
    lookup=async id=>{calls.push(id);throw new AppError(code,code==='BAD_RESPONSE' ? 'TMDB 返回了错误（HTTP 503）。' : '服务暂时不可用。');};
    refresh.start();const result=await refresh.wait();
    expect(calls).toHaveLength(1);expect(result).toMatchObject({updated:0,failed:1,skipped:2,completed:3});
    expect(result.message).toContain('暂停');
  });
  it('资料已更新但图片下载失败时保留旧缓存，并单独报告图片待重试', async () => {
    const original=await add('1');const store=vi.spyOn(app.images,'store').mockRejectedValue(new Error('image service unavailable'));
    refresh.start();const result=await refresh.wait();store.mockRestore();
    expect(result).toMatchObject({updated:1,failed:0,imageWarnings:1});
    expect(result.imageWarningDetails[0].message).toContain('海报下载失败');
    expect(app.repo.getFilm(original.film.id)).toMatchObject({title:'更新后的1',posterPath:original.film.posterPath});
  });
  it('重复启动复用同一任务，运行时拒绝冲突操作，状态快照不可反向修改', async () => {
    await add('1');let finish!:(value:ReturnType<typeof candidate>)=>void;
    lookup=()=>new Promise(resolve=>{finish=resolve;});const first=refresh.start();
    await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    expect(refresh.start().id).toBe(first.id);expect(()=>refresh.assertIdle()).toThrow('全部刷新');
    const snapshot=refresh.status();snapshot.errors.push({filmId:'x',title:'x',message:'x'});expect(refresh.status().errors).toHaveLength(0);
    finish(candidate());expect((await refresh.wait()).updated).toBe(1);
  });
  it('取消图片下载中的刷新后不写入迟到资料，原评分与图片保留', async () => {
    const original=await add('1');let release!:(path:string)=>void;
    const store=vi.spyOn(app.images,'store').mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
    refresh.start();await vi.waitFor(()=>expect(release).toBeTypeOf('function'));refresh.cancel();release('poster/new.png');
    const result=await refresh.wait();store.mockRestore();
    expect(result).toMatchObject({cancelled:true,updated:0,failed:0});
    expect(app.repo.getFilm(original.film.id)).toMatchObject({title:original.film.title,posterPath:original.film.posterPath});
  });
  it('上下文关闭或更换后，旧请求不能写入重新打开的数据库', async () => {
    const original=await add('1');let finish!:(value:ReturnType<typeof candidate>)=>void;
    lookup=()=>new Promise(resolve=>{finish=resolve;});refresh.start();await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    refresh.cancel();app.restart();finish(candidate({title:'不应写入'}));await refresh.wait();
    expect(app.repo.getFilm(original.film.id)?.title).toBe(original.film.title);
  });
  it('刷新中被删除的作品跳过，不重新创建；未配置夸克也可刷新资料', async () => {
    const original=await add('1');let finish!:(value:ReturnType<typeof candidate>)=>void;
    lookup=()=>new Promise(resolve=>{finish=resolve;});refresh.start();await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    app.library.removeFilm(original.film.id);finish(candidate());const result=await refresh.wait();
    expect(result).toMatchObject({updated:0,failed:0,skipped:1,quark:{state:'skipped'}});expect(app.repo.listAllFilms()).toHaveLength(0);
  });
});
