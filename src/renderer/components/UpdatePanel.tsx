import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import type {UpdateStatus} from '@shared/updates';
import {api,describeError} from '../lib/api';
import {useToast} from '../lib/toast';
import {formatBytes} from '../lib/format';
function useUpdates(){const [state,setState]=useState<UpdateStatus|null>(null);useEffect(()=>{let alive=true;const poll=()=>{if(api.updates)void api.updates.status().then(value=>{if(alive)setState(value);}).catch(()=>{});};poll();const timer=setInterval(poll,1500);return()=>{alive=false;clearInterval(timer);};},[]);return {state,setState};}
export function UpdateNotice(){const {state}=useUpdates();if(!state?.manifest||!['available','downloading','ready'].includes(state.phase))return null;return <Link className="cinema-nav-link" to="/settings#updates">{state.phase==='ready'?'更新已就绪':state.phase==='downloading'?'正在下载更新':`新版本 ${state.manifest.version}`}</Link>;}
export function UpdatePanel(){const {state,setState}=useUpdates(),toast=useToast();const [mirror,setMirror]=useState<string|null>(null),[busy,setBusy]=useState(false);
  const action=async(work:()=>Promise<UpdateStatus|void>)=>{setBusy(true);try{const result=await work();if(result)setState(result);}catch(error){toast.error(describeError(error));}finally{setBusy(false);}};
  return <section className="section-card" id="updates"><div className="section-card-head"><h2 className="section-card-title">应用更新</h2><p className="section-card-desc">自动检查新版本；GitHub不可用时使用你配置的镜像。下载完成后校验更新清单签名和安装包哈希，安装前保存数据库备份。</p></div>
    <p>当前版本 {state?.currentVersion??'—'}{state?.manifest?` · 可更新至 ${state.manifest.version}`:state?.lastChecked&&state.phase==='idle'?' · 当前已是最新版本':''}</p>
    <label className="row gap-2"><input type="checkbox" checked={state?.preferences.automatic??true} disabled={!state||busy} onChange={event=>void action(()=>api.updates.configure({automatic:event.target.checked}))}/>自动检查更新</label>
    <label className="row gap-2"><input type="checkbox" checked={state?.preferences.preview??false} disabled={!state||busy} onChange={event=>void action(()=>api.updates.configure({preview:event.target.checked}))}/>接收开发预览版</label>
    <label>镜像前缀或HTTPS模板<input className="input" placeholder="https://你的镜像域名/ 或 https://example/?url={url}" value={mirror??state?.preferences.mirror??''} onChange={event=>setMirror(event.target.value)}/></label>
    <button className="btn btn-secondary btn-sm" disabled={busy||!state} onClick={()=>void action(async()=>{const result=await api.updates.configure({mirror:mirror??state!.preferences.mirror});setMirror(null);return result;})}>保存镜像</button>
    {state?.error?<p role="alert" className="field-error">{state.error}</p>:null}
    {state?.phase==='downloading'?<p role="status">正在下载 {formatBytes(state.downloadedBytes)} / {formatBytes(state.manifest?.asset.bytes??0)}</p>:null}
    <div className="row gap-2" style={{marginTop:16}}><button className="btn btn-secondary" disabled={busy||!state||['checking','downloading'].includes(state.phase)} onClick={()=>void action(()=>api.updates.check())}>{state?.phase==='checking'?'检查中…':'检查更新'}</button>
      {state?.manifest&&['available','error'].includes(state.phase)?<button className="btn btn-primary" disabled={busy} onClick={()=>void action(()=>api.updates.download())}>下载更新</button>:null}
      {state?.phase==='ready'?<button className="btn btn-primary" disabled={busy} onClick={()=>{if(window.confirm('即将保存数据库备份并退出My Cinema，启动已验证的安装包。继续？'))void action(()=>api.updates.install());}}>退出并安装</button>:null}
    </div><p className="setting-help">镜像只接收公开更新请求，影视库和账号凭据不会发给镜像。未配置镜像时仅从GitHub获取更新。</p>
  </section>;
}
