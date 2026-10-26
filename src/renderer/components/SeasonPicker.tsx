import { useEffect, useState } from 'react';
import type { MetadataSearchResult, MetadataSeasonList } from '@shared/types';
import { api, describeError } from '../lib/api';
import { useAppState } from '../lib/appState';
import { useToast } from '../lib/toast';
import { Icon } from './icons';

export function SeasonPicker({series,disabled,onChoose,onSeries,onManual,onOpen,onBusy}: {
  series:MetadataSearchResult;disabled:boolean;onChoose:(id:string)=>void;onSeries:()=>void;
  onManual:(number:number)=>void;onOpen:(id:string)=>void;onBusy:(busy:boolean)=>void;
}) {
  const [list,setList]=useState<MetadataSeasonList|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [selected,setSelected]=useState<number[]>([]);
  const [reload,setReload]=useState(0);
  const [manualNumber,setManualNumber]=useState('1');
  const [progress,setProgress]=useState('');
  const {invalidate}=useAppState();const toast=useToast();
  useEffect(()=>{
    let live=true;setError(null);setList(null);setSelected([]);
    void api.metadata.seasons(series.externalId).then(value=>{if(live)setList(value);})
      .catch(cause=>{if(live)setError(describeError(cause));});
    return()=>{live=false;};
  },[series.externalId,reload]);
  async function importSelected() {
    if(!list || disabled)return;
    onBusy(true);setError(null);let completed=0;
    try {
      for(const number of selected) {
        const season=list.seasons.find(value=>value.number===number);
        if(!season || season.collectedFilmId)continue;
        setProgress(`正在导入 ${completed+1} / ${selected.length} 季…`);
        const candidate=await api.metadata.candidate(`${series.externalId}:season:${number}`,'tv');
        const result=await api.library.importCandidate(candidate);
        completed++;invalidate();
        setList(previous=>previous ? {...previous,seasons:previous.seasons.map(item=>item.number===number ? {...item,collectedFilmId:result.film.id} : item)} : previous);
        setSelected(previous=>previous.filter(value=>value!==number));
        if(result.imageWarning)toast.error(`${candidate.title}：${result.imageWarning}`);
      }
      toast.success(`已处理 ${completed} 季，可分别编辑评分和观看状态。`);
    } catch(cause) {setError(`本次已保存 ${completed} 季。${describeError(cause)} 未完成的季可重试。`);}
    finally {setProgress('');onBusy(false);}
  }
  const available=list?.seasons.filter(season=>!season.collectedFilmId) ?? [];
  const validNumber=/^(0|[1-9]\d{0,3})$/.test(manualNumber);
  return <div className="season-picker">
    <h3>{list?.title ?? series.title}</h3>
    <p className="setting-help">选择要收藏的季。每季独立保存资料、评分和观看状态；特别篇单独列出。</p>
    <div className="row gap-2 wrap">
      <button className="btn btn-secondary" type="button" disabled={disabled} onClick={onSeries}>收藏整剧</button>
      <button className="link-button" type="button" disabled={disabled || !available.length} onClick={()=>setSelected(available.map(season=>season.number))}>选择全部未收藏的季</button>
      <button className="btn btn-primary" type="button" disabled={disabled || !selected.length} onClick={()=>void importSelected()}>导入所选 {selected.length} 季</button>
    </div>
    <p className="setting-help">批量导入默认标为“想看”，已有收藏的个人数据保留。选择单季“查看并确认”可先设置评分。</p>
    {progress ? <p role="status">{progress}</p> : null}
    {error ? <div className="field-error" role="alert">{error} <button className="link-button" disabled={disabled} onClick={()=>setReload(value=>value+1)}>重新读取季列表</button></div> : null}
    {!list && !error ? <p role="status">正在读取季列表…</p> : null}
    {list && !list.seasons.length ? <p>TMDB 尚未提供季列表，可以收藏整剧或手动补季。</p> : null}
    <div className="import-results">
      {list?.seasons.map(season=><article className="import-item" key={season.number} data-season-number={season.number}>
        <input type="checkbox" aria-label={`选择${season.number===0?'特别篇':`第${season.number}季`}`} disabled={disabled || Boolean(season.collectedFilmId)} checked={selected.includes(season.number)} onChange={event=>setSelected(previous=>event.target.checked ? [...previous,season.number] : previous.filter(value=>value!==season.number))}/>
        <div className="import-thumb">{season.posterUrl ? <img src={season.posterUrl} alt="" loading="lazy"/> : <div className="collection-cover-placeholder"><Icon name="film" size={18}/></div>}</div>
        <div className="import-main"><div className="import-title">{season.number===0?'特别篇':`第${season.number}季`}{season.name !== (season.number===0?'特别篇':`第${season.number}季`) ? ` · ${season.name}` : ''}</div>
          <div className="import-meta">{season.year ?? '年份缺失'} · {season.episodeCount === null ? '集数缺失' : `${season.episodeCount} 集`}{season.collectedFilmId ? ' · 已收藏' : ''}</div>
          <p className="import-overview">{season.overview ?? 'TMDB 暂无本季中文简介，读取详情时会尝试英文资料。'}</p>
          {!season.posterUrl ? <span className="setting-help">本季海报缺失</span> : null}
        </div>
        {season.collectedFilmId ? <button className="btn btn-secondary btn-sm" disabled={disabled} onClick={()=>onOpen(season.collectedFilmId!)}>打开收藏</button> :
          <button className="btn btn-secondary btn-sm" disabled={disabled} onClick={()=>onChoose(`${series.externalId}:season:${season.number}`)}>查看并确认</button>}
      </article>)}
    </div>
    <details><summary>缺少需要的季？手动补季</summary><div className="row gap-2 wrap" style={{marginTop:12}}>
      <label>季数 <input className="input" aria-label="手动补录季数" type="number" min={0} max={9999} value={manualNumber} disabled={disabled} onChange={event=>setManualNumber(event.target.value)}/></label>
      <button className="btn btn-secondary" disabled={disabled || !validNumber} onClick={()=>onManual(Number(manualNumber))}>填写本季资料</button>
    </div><p className="setting-help">将创建独立的手动收藏，可填写标题、年份与简介。</p></details>
  </div>;
}
