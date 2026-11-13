import {useState} from 'react';
import {api,describeError} from '../lib/api';
import {useAsyncData} from '../lib/useAsync';
import {useAppState} from '../lib/appState';
import {useToast} from '../lib/toast';
import {Modal,LoadingRow,ErrorState} from './primitives';

export function ArtworkGallery({filmId,kind,onClose}:{filmId:string;kind:'poster'|'backdrop'|'still';onClose:()=>void}) {
  const data=useAsyncData(()=>api.metadata.artwork(filmId),[filmId]);
  const {invalidate}=useAppState(),toast=useToast();const [busy,setBusy]=useState(false),[expanded,setExpanded]=useState('');
  const select=async(path:string|null)=>{
    if(kind==='still')return;setBusy(true);
    try{await api.metadata.selectArtwork(filmId,kind,path);invalidate();toast.success(path?'选图已锁定，刷新资料会保留':'已恢复自动选图');onClose();}
    catch(error){toast.error(describeError(error));}finally{setBusy(false);}
  };
  return <Modal open title={kind==='still'?'在线剧照':kind==='poster'?'选择海报':'选择背景宣传图'} wide onClose={onClose}
    subtitle={kind==='still'?'在线浏览剧照。':'选择喜欢的画面，选用后会在刷新时保留。'}>
    {data.loading?<LoadingRow label="读取图片库…"/>:null}{data.error?<ErrorState message={data.error} onRetry={data.reload}/>:null}
    {kind!=='still'?<button className="btn btn-secondary" disabled={busy} onClick={()=>void select(null)}>恢复自动选图</button>:null}
    {expanded?<button className="artwork-expanded" aria-label="返回图片列表" onClick={()=>setExpanded('')}><img src={expanded} alt="在线剧照"/></button>:<div className={`artwork-gallery ${kind==='poster'?'is-posters':''}`}>
      {(data.data??[]).filter(item=>item.kind===kind).map((item,index)=><button type="button" key={`${item.scope}:${item.path}:${index}`} disabled={busy} onClick={()=>kind==='still'?setExpanded(item.url):void select(item.path)}>
        <img loading="lazy" src={item.url} alt={`${kind==='poster'?'海报':kind==='backdrop'?'背景画面':'剧照'} ${index+1}`}/><span>{kind==='still'&&/^S\d+/.test(item.label)?item.label:`${kind==='poster'?'海报':kind==='backdrop'?'背景画面':'剧照'} ${index+1}`}</span><small>{kind==='still'?'放大查看':kind==='poster'?'选为海报并锁定':'选为背景并锁定'}</small>
      </button>)}
    </div>}
    {!data.loading&&!data.error&&!(data.data??[]).some(item=>item.kind===kind)?<p className="muted">暂无可用图片。</p>:null}
  </Modal>;
}
