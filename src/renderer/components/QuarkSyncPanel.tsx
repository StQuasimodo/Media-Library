import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CollectionEntry } from '@shared/types';
import type { QuarkMatchQuery, QuarkSyncGroup, QuarkSyncStatus } from '@shared/quarkSync';
import { api, describeError } from '../lib/api';
import { useAppState } from '../lib/appState';

type Operation = (action: () => Promise<QuarkSyncStatus>) => Promise<void>;
function MatchGroup({group,busy,perform}: {group:QuarkSyncGroup;busy:boolean;perform:Operation}) {
  const [query,setQuery]=useState(group.query);
  const [selected,setSelected]=useState('');
  const [existing,setExisting]=useState<CollectionEntry[] | null>(null);
  const [existingQuery,setExistingQuery]=useState(group.query.title);
  const [existingId,setExistingId]=useState('');
  const [lookupBusy,setLookupBusy]=useState(false);
  const [lookupError,setLookupError]=useState<string | null>(null);
  useEffect(()=>{setQuery(group.query);},[group.query.title,group.query.year,group.query.mediaType]);
  const signature=group.candidates.map(item=>`${item.mediaType}:${item.externalId}:${item.confidence}`).join('|');
  useEffect(()=>{
    const high=group.candidates.find(candidate=>candidate.confidence==='high');
    setSelected(high ? `${high.mediaType}:${high.externalId}` : '');
  },[signature]);
  async function lookup() {
    setLookupBusy(true);setLookupError(null);
    try {setExisting((await api.library.list({search:existingQuery})).slice(0,100));setExistingId('');}
    catch(error){setLookupError(describeError(error));}
    finally{setLookupBusy(false);}
  }
  return <article className="quark-match-group" data-match-state={group.state}>
    <div className="row gap-2 wrap"><strong>{group.query.title}</strong>
      <span className="tag">{group.query.year ?? '年份待确认'}</span><span className="tag">{group.files} 个视频</span>
      {group.film ? <Link className="link-button" to={`/film/${group.film.id}`}>已关联《{group.film.title}》</Link> : null}
      {group.state==='ignored' ? <span className="setting-help">已忽略</span> : null}
    </div>
    {group.formats.length ? <div className="row gap-2 wrap quark-resource-tags" aria-label="文件名识别的资源信息">{group.formats.map(value=><span className="tag" key={value}>{value}</span>)}</div> : null}
    <details><summary className="setting-help">查看文件路径</summary>{group.examples.map(path=><p className="setting-help quark-path" key={path}>{path}</p>)}</details>
    {group.film || group.state==='ignored' ? <button type="button" className="link-button" disabled={busy} onClick={()=>void perform(()=>api.quarkSync.ignore(group.key,false))}>更改匹配</button> : <>
      <div className="quark-match-query">
        <label>片名<input aria-label="匹配片名" className="input" value={query.title} disabled={busy} onChange={event=>setQuery({...query,title:event.target.value})}/></label>
        <label>年份<input aria-label="匹配年份" className="input" type="number" min={1800} max={2200} value={query.year ?? ''} disabled={busy} onChange={event=>setQuery({...query,year:event.target.value ? Number(event.target.value) : null})}/></label>
        <label>类型<select aria-label="匹配类型" className="select" value={query.mediaType} disabled={busy} onChange={event=>setQuery({...query,mediaType:event.target.value as QuarkMatchQuery['mediaType']})}><option value="all">电影与剧集</option><option value="movie">电影</option><option value="tv">电视剧</option></select></label>
        <button type="button" className="btn btn-secondary" disabled={busy || !query.title.trim()} onClick={()=>void perform(()=>api.quarkSync.search(group.key,query))}>重新搜索</button>
      </div>
      {group.candidates.length ? <div className="row gap-2 wrap">
        <select className="select quark-match-candidate" aria-label="影视匹配候选" value={selected} disabled={busy} onChange={event=>setSelected(event.target.value)}>
          <option value="">请选择确认的影视作品</option>{group.candidates.map(candidate=><option key={`${candidate.mediaType}:${candidate.externalId}`} value={`${candidate.mediaType}:${candidate.externalId}`}>{candidate.title} · {candidate.year ?? '未知年份'} · {candidate.mediaType==='tv'?'电视剧':'电影'}{candidate.confidence==='high'?' · 高置信':''}</option>)}
        </select>
        <button type="button" className="btn cinema-primary" disabled={busy || !selected} onClick={()=>void perform(()=>{
          const candidate=group.candidates.find(item=>`${item.mediaType}:${item.externalId}`===selected)!;
          return api.quarkSync.confirm(group.key,candidate.externalId,candidate.mediaType);
        })}>确认导入并关联</button>
      </div> : <p className="setting-help">{group.state==='pending'?'等待自动匹配，也可修改关键词后搜索。':'暂无候选，请尝试调整片名、年份或类型。'}</p>}
      {group.error ? <p className="field-error" role="alert">{group.error}</p> : null}
      <div className="row gap-2 wrap">
        <button type="button" className="link-button" disabled={busy || lookupBusy} onClick={()=>void lookup()}>关联已有收藏</button>
        <button type="button" className="link-button" disabled={busy} onClick={()=>void perform(()=>api.quarkSync.ignore(group.key,true))}>忽略这组资源</button>
      </div>
      {existing ? <div className="quark-existing-match"><div className="row gap-2 wrap">
        <input className="input" aria-label="搜索已有收藏" value={existingQuery} disabled={busy || lookupBusy} onChange={event=>setExistingQuery(event.target.value)}/>
        <button type="button" className="btn btn-secondary" disabled={busy || lookupBusy} onClick={()=>void lookup()}>搜索收藏</button>
      </div><div className="row gap-2 wrap"><select className="select" aria-label="已有收藏候选" value={existingId} disabled={busy} onChange={event=>setExistingId(event.target.value)}><option value="">选择已有收藏（最多显示100项）</option>{existing.map(entry=><option value={entry.filmId} key={entry.id}>{entry.film.title} · {entry.film.year ?? '未知年份'} · {entry.film.mediaType==='tv'?'电视剧':'电影'}</option>)}</select>
        <button type="button" className="btn btn-secondary" disabled={busy || !existingId} onClick={()=>void perform(()=>api.quarkSync.linkExisting(group.key,existingId))}>确认关联已有收藏</button></div></div> : null}
      {lookupError ? <p className="field-error">{lookupError}</p> : null}
    </>}
  </article>;
}
export function QuarkSyncPanel({folderId,blocked,refreshToken,onBusyChange,onSourceChange}: {folderId:string|null;blocked:boolean;refreshToken:number;onBusyChange:(value:boolean)=>void;onSourceChange:(value:boolean)=>void}) {
  const [status,setStatus]=useState<QuarkSyncStatus | null>(null);
  const [actionBusy,setActionBusy]=useState(false);
  const [error,setError]=useState<string | null>(null);
  const [autoRead,setAutoRead]=useState(true), [autoImport,setAutoImport]=useState(false);
  const [all,setAll]=useState(false),[limit,setLimit]=useState(30);
  const {invalidate}=useAppState();
  useEffect(()=>{
    let live=true;
    void api.quarkSync.status().then(value=>{if(live){setStatus(value);onBusyChange(value.busy);onSourceChange(Boolean(value.source.folder));}}).catch(cause=>{if(live)setError(describeError(cause));});
    return()=>{live=false;};
  },[refreshToken]);
  useEffect(()=>{
    if(!status?.busy)return;
    let live=true;
    const timer=setInterval(()=>{void api.quarkSync.status().then(value=>{
      if(!live)return;setStatus(value);onBusyChange(value.busy);onSourceChange(Boolean(value.source.folder));if(!value.busy)invalidate();
    }).catch(cause=>{if(live)setError(describeError(cause));});},900);
    return()=>{live=false;clearInterval(timer);};
  },[status?.busy]);
  useEffect(()=>{if(status){setAutoRead(status.source.autoRead);setAutoImport(status.source.autoImport);}},[status?.source.autoRead,status?.source.autoImport]);
  const busy=blocked || actionBusy || Boolean(status?.busy);
  async function perform(action:()=>Promise<QuarkSyncStatus>) {
    setActionBusy(true);setError(null);onBusyChange(true);
    setStatus(previous=>previous ? {...previous,busy:true} : previous);
    try {setStatus(await action());}
    catch(cause){setError(describeError(cause));}
    finally {
      try {const value=await api.quarkSync.status();setStatus(value);onBusyChange(value.busy);onSourceChange(Boolean(value.source.folder));if(!value.busy)invalidate();}
      catch {/* keep the actionable operation error */}
      setActionBusy(false);
    }
  }
  const pending=status?.groups.filter(group=>!group.film && group.state!=='ignored') ?? [];
  const displayed=(all ? status?.groups ?? [] : pending);
  const high=pending.filter(group=>group.candidates.some(candidate=>candidate.confidence==='high')).length;
  return <div className="quark-sync-panel">
    <h3 className="section-card-title">目录匹配与收藏关联</h3>
    <p className="setting-help">逐层浏览到影视目录后，使用当前目录开始递归读取。视频会按片名与季集归并，匹配 TMDB 后直接关联文件，无需创建分享链接。画质、编码、音轨等由文件名和目录识别，未读取视频流。</p>
    <div className="quark-sync-options">
      <label><input type="checkbox" checked={autoRead} disabled={busy} onChange={event=>setAutoRead(event.target.checked)}/> 启动时自动读取并匹配</label>
      <label><input type="checkbox" checked={autoImport} disabled={busy} onChange={event=>setAutoImport(event.target.checked)}/> 自动导入唯一高置信匹配</label>
    </div>
    <p className="setting-help">高置信要求片名或原名一致、年份一致且候选唯一。其他结果留待确认；已确认剧集的新集数会沿用原关联。重新关联账号会重置同步范围，收藏保留。</p>
    {status?.source.folder ? <p className="setting-help quark-path">当前同步目录：{status.source.folder.path}<br/>上次完整读取：{status.source.lastScanAt ? new Date(status.source.lastScanAt).toLocaleString() : '尚未读取'}</p> : null}
    <div className="row gap-2 wrap">
      <button type="button" className="btn cinema-primary" disabled={busy || !folderId} onClick={()=>void perform(async()=>{
        await api.quarkSync.configure(folderId!,autoRead,autoImport);return api.quarkSync.scan();
      })}>使用当前目录并开始匹配</button>
      {status?.source.folder ? <>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>void perform(()=>api.quarkSync.scan())}>读取增量并匹配</button>
        <button type="button" className="link-button" disabled={busy} onClick={()=>void perform(()=>api.quarkSync.configure(status.source.folder!.id,autoRead,autoImport))}>保存同步选项</button>
        <button type="button" className="link-button" disabled={busy} onClick={()=>void perform(()=>api.quarkSync.match())}>继续匹配待确认项</button>
      </> : null}
      {(status?.busy || actionBusy) ? <button type="button" className="btn btn-secondary" onClick={()=>void api.quarkSync.cancel().catch(cause=>setError(describeError(cause)))}>取消任务</button> : null}
    </div>
    <p className="setting-help" role="status">{status?.busy ? status.progress || '正在处理目录匹配…' : status?.source.lastScanAt ? `${status.videos} 个视频 · ${status.groups.length} 组作品 · ${status.groups.filter(group=>group.film).length} 组已关联 · ${pending.length} 组待处理` : '尚未生成匹配清单。'}</p>
    {(error || status?.error) ? <p className="field-error" role="alert">{error || status?.error}</p> : null}
    {status?.groups.length ? <>
      <div className="row gap-2 wrap">
        <button type="button" className="btn btn-secondary" disabled={busy || !high} onClick={()=>void perform(()=>api.quarkSync.confirmHigh())}>确认 {high} 组高置信匹配</button>
        <label className="setting-help"><input type="checkbox" checked={all} onChange={event=>{setAll(event.target.checked);setLimit(30);}}/> 显示已关联和忽略的分组</label>
      </div>
      {displayed.slice(0,limit).map(group=><MatchGroup key={group.key} group={group} busy={busy} perform={perform}/>)}
      {displayed.length>limit ? <button type="button" className="link-button" onClick={()=>setLimit(limit+30)}>显示更多分组（{displayed.length-limit}）</button> : null}
    </> : null}
  </div>;
}
