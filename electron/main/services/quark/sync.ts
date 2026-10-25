import type { CoreContext } from '../../runtime';
import type { QuarkFolder } from '../../../../src/shared/quark';
import type { QuarkWebItem } from '../../../../src/shared/quarkWeb';
import type { QuarkMatchQuery, QuarkSyncGroup, QuarkSyncStatus } from '../../../../src/shared/quarkSync';
import type { MediaType } from '../../../../src/shared/types';
import { AppError } from '../../errors';
import { inferVideoName, isVideoName } from './filename';
import { groupIdentity, rankMatches } from './matching';
import { SyncRepository, type CloudFile, type StoredFile, type SyncState } from './syncRepository';
import { inferResourceInfo } from './resourceInfo';
import { resourceInfoLabels } from '../../../../src/shared/quarkResource';

export interface SyncReader {
  read(id: string, signal: AbortSignal): Promise<QuarkWebItem[]>;
  folder(id: string): QuarkFolder | null;
  ready(): void;
}
type Context = Pick<CoreContext, 'db' | 'repo' | 'library' | 'metadata'>;
type MatchCache = Pick<QuarkSyncGroup, 'candidates' | 'error'>;

/** All directory reads are staged before one inventory transaction; confirmed choices persist in SQLite. */
export class QuarkSync {
  private reader: SyncReader | null = null;
  private controller: AbortController | null = null;
  private phase: QuarkSyncStatus['phase'] = 'idle';
  private progress = '';
  private error: string | null = null;
  private cache = new Map<string, MatchCache>();
  constructor(private readonly context: () => Context) {}
  private get store() { return new SyncRepository(this.context().db); }
  get busy() { return this.controller !== null; }
  assertIdle() { if (this.busy) throw new AppError('VALIDATION', '请先等待或取消当前目录匹配任务。'); }
  bindReader(reader: SyncReader) { this.reader = reader; }
  private requireReader() {
    if (!this.reader) throw new AppError('VALIDATION', '夸克连接尚未就绪。');
    this.reader.ready(); return this.reader;
  }
  status(): QuarkSyncStatus {
    const {scope,...source}=this.store.state();
    const files=source.folder ? this.store.files(scope,source.folder.id) : [];
    const grouped=new Map<string,typeof files>();
    for (const file of files) { const group=grouped.get(file.groupKey) ?? []; group.push(file); grouped.set(file.groupKey,group); }
    const groups=[...grouped].map(([key,items])=>this.groupView(key,items,{scope,...source}));
    return {source,busy:this.busy,phase:this.phase,progress:this.progress,error:this.error,groups,videos:files.length};
  }
  private groupView(key: string, items: StoredFile[], source: SyncState): QuarkSyncGroup {
    const choice=this.store.choice(source.scope,source.folder!.id,key);
    const first=items[0];
    const query=choice?.query ?? {title:first.title,year:first.year,mediaType:first.mediaType};
    const linkedIds=[...new Set(items.map(file=>file.filmId).filter((id): id is string=>Boolean(id)))];
    const conflict=linkedIds.length > 1;
    const filmId=conflict ? null : choice?.filmId ?? (linkedIds.length === 1 ? linkedIds[0] : null);
    const film=filmId ? this.context().repo.getFilm(filmId) : null;
    const cache=this.cache.get(key);
    return {key,query,files:items.length,examples:items.slice(0,3).map(file=>file.path),
      formats:[...new Set(items.flatMap(file=>resourceInfoLabels(file.technical)))].slice(0,8),
      state:choice?.ignored ? 'ignored' : film ? 'linked' : cache?.error ? 'error' : cache?.candidates.length ? 'review' : 'pending',
      film:film ? {id:film.id,title:film.title} : null,
      candidates:conflict ? (cache?.candidates ?? []).map(candidate=>({...candidate,confidence:'review'})) : cache?.candidates ?? [],
      error:cache?.error ?? (conflict ? '同组文件原先关联了不同作品，请人工确认，不会自动覆盖旧关联。' : null)};
  }
  configure(id: string, autoRead: boolean, autoImport: boolean) {
    this.assertIdle(); const reader=this.requireReader();
    const current=this.store.state();
    const folder=reader.folder(id) ?? (current.folder?.id===id ? current.folder : null);
    if (!folder || typeof autoRead !== 'boolean' || typeof autoImport !== 'boolean') throw new AppError('VALIDATION','请从云端目录中选择同步范围。');
    this.store.configure(folder,autoRead,autoImport); if(current.folder?.id!==folder.id)this.cache.clear(); this.error=null;
    return this.status();
  }
  resetConnection() {
    this.assertIdle(); this.store.reset(); this.cache.clear(); this.error=null; this.progress='';
  }
  private active(signal: AbortSignal) {
    if (signal.aborted) throw new AppError('VALIDATION','已取消任务；已完成的关联保留，未完成的目录读取不会提交。');
  }
  private async job(phase: QuarkSyncStatus['phase'], work: (signal: AbortSignal) => Promise<void>) {
    this.assertIdle(); this.requireReader();
    const controller=new AbortController(); this.controller=controller; this.phase=phase; this.error=null;
    try { await work(controller.signal); }
    catch (error) {
      this.error=controller.signal.aborted ? '已取消任务。' : error instanceof AppError ? error.message : '目录匹配失败，请重试；原收藏和上次完整清单已保留。';
      throw new AppError(error instanceof AppError ? error.code : 'NETWORK',this.error);
    } finally { this.controller=null; this.phase='idle'; this.progress=''; }
    return this.status();
  }
  start() {
    this.assertIdle(); this.requireReader();
    if (!this.store.state().folder) throw new AppError('VALIDATION','请先选择影视目录。');
    void this.scan().catch(()=>{}); return this.status();
  }
  async scan() {
    const source=this.store.state();
    if (!source.folder) throw new AppError('VALIDATION','请先选择影视目录。');
    return this.job('reading',async signal=>{
      const queue=[{folder:source.folder!,parents:source.folder!.path.split('/'),depth:0}];
      const seenDirectories=new Set<string>(), seenFiles=new Set<string>();
      const files: CloudFile[]=[]; let entries=0;
      while(queue.length) {
        this.active(signal);
        const current=queue.shift()!;
        if (seenDirectories.has(current.folder.id)) continue;
        seenDirectories.add(current.folder.id);
        if(seenDirectories.size>200 || current.depth>32) throw new AppError('VALIDATION','目录范围过大，请选择更具体的影视目录。');
        this.progress=`已读取 ${seenDirectories.size-1} 个目录，发现 ${files.length} 个视频`;
        const items=await this.requireReader().read(current.folder.id,signal);
        this.active(signal); entries+=items.length;
        if(entries>20_000) throw new AppError('VALIDATION','条目超过20000项，请选择更具体的影视目录。');
        for(const item of items) {
          const path=`${current.folder.path}/${item.name}`;
          if(path.length>4096) throw new AppError('VALIDATION','目录层级或名称过长，请缩小同步范围。');
          if(item.directory) queue.push({folder:{id:item.id,name:item.name,path},parents:[...current.parents,item.name],depth:current.depth+1});
          else if((item.video || isVideoName(item.name)) && !seenFiles.has(item.id)) {
            seenFiles.add(item.id);
            const hint=inferVideoName(item.name,current.parents);
            const mediaType=hint.season!==null || hint.episode!==null || current.parents.some(part=>/^(电视剧|tv|series)$/i.test(part)) ? 'tv' : 'all';
            const groupKey=groupIdentity({title:hint.title,year:hint.year,mediaType});
            files.push({...hint,id:item.id,parentId:current.folder.id,name:item.name,path,mediaType,groupKey,
              size:item.size,technical:inferResourceInfo(item.name,current.parents)});
          }
        }
      }
      this.active(signal);
      this.store.replace(source.scope,source.folder!.id,files,new Date().toISOString());
      await this.matchPending(signal);
    });
  }
  startMatching() {
    this.assertIdle(); this.requireReader();
    void this.job('matching',signal=>this.matchPending(signal)).catch(()=>{}); return this.status();
  }
  private group(key: string) {
    const source=this.store.state();
    if(!source.folder) throw new AppError('VALIDATION','请先选择影视目录。');
    const items=this.store.files(source.scope,source.folder.id,key);
    if(!items.length) throw new AppError('VALIDATION','该资源分组已变化，请刷新目录。');
    return {source,group:this.groupView(key,items,source),root:source.folder.id};
  }
  private async matchPending(signal: AbortSignal) {
    this.phase='matching';
    const groups=this.status().groups;
    // Previously confirmed links do not depend on TMDB being available. Apply
    // them before an unresolved group's authentication/network error can pause searches.
    for (const group of groups) {
      this.active(signal);
      if (group.film && group.state!=='ignored') {
        const {source,root}=this.group(group.key);
        this.store.choose(source.scope,root,group.key,group.film.id,false);
      }
    }
    for(let index=0;index<groups.length;index++) {
      this.active(signal); const {source,group}=this.group(groups[index].key);
      this.progress=`正在匹配 ${index+1} / ${groups.length} 部作品`;
      if(group.state==='ignored') continue;
      // Reuse an explicitly confirmed choice for newly discovered episodes/versions.
      if(group.film) continue;
      if(!this.context().metadata.hasApiKey) { this.error='完整目录已保存；请先在影视元数据中配置 TMDB，再继续匹配。'; break; }
      if(!group.candidates.length) {
        try { await this.find(group.key,group.query,signal); }
        catch(error) {
          this.active(signal);
          if(error instanceof AppError && error.code==='NO_RESULTS') continue;
          this.error='TMDB 匹配暂时无法继续，请检查 API 配置或网络后继续；目录清单已保留。'; break;
        }
      }
      const current=this.group(group.key).group;
      const high=current.candidates.find(candidate=>candidate.confidence==='high');
      if(source.autoImport && high) {
        try { await this.importMatch(group.key,high.externalId,high.mediaType,signal); }
        catch(error) { this.active(signal); this.error=error instanceof AppError ? error.message : '自动导入暂停，请检查后重试。'; break; }
      }
    }
  }
  private validateQuery(query: QuarkMatchQuery): QuarkMatchQuery {
    if(!query || typeof query.title!=='string' || !query.title.trim() || query.title.length>200 ||
      (query.year!==null && (!Number.isInteger(query.year) || query.year<1800 || query.year>2200)) ||
      !['all','movie','tv'].includes(query.mediaType)) throw new AppError('VALIDATION','请填写有效片名、年份和作品类型。');
    return {...query,title:query.title.trim()};
  }
  private async find(key: string, input: QuarkMatchQuery, signal: AbortSignal) {
    const query=this.validateQuery(input);
    const {source,root}=this.group(key);
    this.active(signal);
    this.store.setQuery(source.scope,root,key,query);
    try {
      const results=await this.context().metadata.search({query:query.title,year:query.year,mediaType:query.mediaType});
      this.active(signal);
      this.cache.set(key,{candidates:rankMatches(results,query),error:null});
    } catch(error) {
      this.active(signal);
      this.cache.set(key,{candidates:[],error:error instanceof AppError ? error.message : '搜索失败，请重试。'});
      throw error;
    }
  }
  async search(key: string, query: QuarkMatchQuery) {
    return this.job('matching',async signal=>{ await this.find(key,query,signal); });
  }
  private async importMatch(key: string, externalId: string, mediaType: MediaType, signal: AbortSignal) {
    const {source,group,root}=this.group(key);
    if(!group.candidates.some(candidate=>candidate.externalId===externalId && candidate.mediaType===mediaType)) throw new AppError('VALIDATION','请选择本次搜索返回的影视候选。');
    this.phase='importing'; this.active(signal);
    const candidate=await this.context().metadata.getCandidate(externalId,mediaType);
    this.active(signal);
    const result=await this.context().library.importCandidate(candidate,{},()=>this.active(signal));
    this.active(signal);
    this.store.choose(source.scope,root,key,result.film.id,false);
    this.cache.set(key,{candidates:[],error:result.imageWarning});
    this.phase='matching';
  }
  async confirm(key: string, externalId: string, mediaType: MediaType) {
    return this.job('importing',signal=>this.importMatch(key,externalId,mediaType,signal));
  }
  async confirmHigh() {
    return this.job('importing',async signal=>{
      for(const group of this.status().groups) {
        this.active(signal);
        if(group.film || group.state==='ignored') continue;
        const high=group.candidates.find(candidate=>candidate.confidence==='high');
        if(high) await this.importMatch(group.key,high.externalId,high.mediaType,signal);
      }
    });
  }
  linkExisting(key: string, filmId: string) {
    this.assertIdle(); this.requireReader(); const {source,root}=this.group(key);
    if(!this.context().repo.getFilm(filmId)) throw new AppError('NOT_FOUND','收藏作品不存在。');
    this.store.choose(source.scope,root,key,filmId,false); this.cache.delete(key); return this.status();
  }
  ignore(key: string, ignored: boolean) {
    this.assertIdle(); this.requireReader(); const {source,root}=this.group(key);
    this.store.choose(source.scope,root,key,null,ignored); this.cache.delete(key); return this.status();
  }
  cancel() { this.controller?.abort(); if(this.busy)this.progress='正在取消，等待当前请求结束…'; }
  async readOnStartup() {
    if(this.store.state().autoRead && this.store.state().folder) {
      try { await this.scan(); } catch { /* visible sanitized status; never loop retries */ }
    }
  }
}
