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
    subtitle={kind==='still'?'仅在线浏览，关闭后释放，不保存到图片缓存。':'本季图库优先；全剧图库未标注季份，请看图确认。手选后刷新保留。'}>
    {data.loading?<LoadingRow label="读取图片库…"/>:null}{data.error?<ErrorState message={data.error} onRetry={data.reload}/>:null}
    {kind!=='still'?<button className="btn btn-secondary" disabled={busy} onClick={()=>void select(null)}>恢复自动选图</button>:null}
    {expanded?<button className="artwork-expanded" aria-label="返回图片列表" onClick={()=>setExpanded('')}><img src={expanded} alt="在线剧照"/></button>:<div className={`artwork-gallery ${kind==='poster'?'is-posters':''}`}>
      {(data.data??[]).filter(item=>item.kind===kind).map((item,index)=><button type="button" key={`${item.scope}:${item.path}:${index}`} disabled={busy} onClick={()=>kind==='still'?setExpanded(item.url):void select(item.path)}>
        <img loading="lazy" src={item.url} alt={item.label}/><span>{item.label}</span><small>{kind==='still'?'放大查看':kind==='poster'?'选为海报并锁定':'选为背景并锁定'}</small>
      </button>)}
    </div>}
    {!data.loading&&!data.error&&!(data.data??[]).some(item=>item.kind===kind)?<p className="muted">暂无可用图片。保留当前展示，不会用其他季的剧照自动替代。</p>:null}
  </Modal>;
}
