import {useState} from 'react';
import type {CollectionEntry} from '@shared/types';
import {api,describeError} from '../lib/api';
import {useAppState} from '../lib/appState';
import {useToast} from '../lib/toast';
import {Modal} from './primitives';
import {seriesFolders} from '@shared/franchises';
export function SeriesFolderDialog({entries,onClose}:{entries:CollectionEntry[];onClose:()=>void}){
  const [selected,setSelected]=useState(new Set<string>()),[name,setName]=useState(''),[query,setQuery]=useState(''),[busy,setBusy]=useState(false);
  const {invalidate}=useAppState(),toast=useToast();
  const save=async(remove=false)=>{setBusy(true);try{await api.library.assignFranchise([...selected],remove?null:name);invalidate();onClose();}catch(error){toast.error(describeError(error));}finally{setBusy(false);}};
  const groups=seriesFolders(entries).filter(folder=>!folder.standalone),visible=entries.filter(e=>e.film.title.toLowerCase().includes(query.toLowerCase()));
  return <Modal open wide title="整理系列文件夹" subtitle="可以把关联剧集、特别篇和衍生电影放在同一影视宇宙中，原来的系列信息和聚合保留。" onClose={onClose} footer={<><button className="btn btn-secondary" disabled={busy||!selected.size} onClick={()=>void save(true)}>取消宇宙归类</button><button className="btn btn-primary" disabled={busy||!selected.size||!name.trim()} onClick={()=>void save()}>放入文件夹（{selected.size}）</button></>}>
    <label>文件夹名称<input className="input" list="series-folder-names" value={name} maxLength={100} onChange={e=>setName(e.target.value)}/></label><datalist id="series-folder-names">{groups.map(g=><option key={g.key} value={g.title}/>)}</datalist>
    <input className="input" aria-label="搜索要整理的作品" placeholder="搜索作品…" value={query} onChange={e=>setQuery(e.target.value)}/>
    <button className="btn btn-secondary" onClick={()=>setSelected(new Set([...selected,...visible.map(e=>e.filmId)]))}>选中当前搜索结果（{visible.length}）</button> <button className="btn btn-ghost" onClick={()=>setSelected(new Set())}>清空选择</button><div className="folder-selection">{visible.map(e=><label key={e.id}><input type="checkbox" checked={selected.has(e.filmId)} onChange={event=>{const next=new Set(selected);if(event.target.checked)next.add(e.filmId);else next.delete(e.filmId);setSelected(next);}}/>{e.film.title} <small>{e.film.year}</small></label>)}</div>
  </Modal>;
}
