import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {UPDATE_MIRRORS,type UpdateStatus} from '@shared/updates';
import {api,describeError} from '../lib/api';
import {useToast} from '../lib/toast';
import {formatBytes} from '../lib/format';
function useUpdates(){const [state,setState]=useState<UpdateStatus|null>(null);useEffect(()=>{let alive=true;const poll=()=>{if(api.updates)void api.updates.status().then(value=>{if(alive)setState(value);}).catch(()=>{});};poll();const timer=setInterval(poll,1500);return()=>{alive=false;clearInterval(timer);};},[]);return {state,setState};}
export function UpdateNotice(){const {state}=useUpdates();if(!state?.manifest||!['available','downloading','ready'].includes(state.phase))return null;return <Link className="cinema-nav-link" to="/settings#updates">{state.phase==='ready'?'更新已就绪':state.phase==='downloading'?'正在下载更新':`新版本 ${state.manifest.version}`}</Link>;}
export function UpdatePanel(){const {state,setState}=useUpdates(),toast=useToast();const [mirror,setMirror]=useState<string|null>(null),[busy,setBusy]=useState(false),[custom,setCustom]=useState(false);
  const saved=state?.preferences.mirror??'auto',known=['auto','',...UPDATE_MIRRORS.map(m=>m.url)].includes(saved);
  const action=async(work:()=>Promise<UpdateStatus|void>)=>{setBusy(true);try{const result=await work();if(result)setState(result);}catch(error){toast.error(describeError(error));}finally{setBusy(false);}};
  const saveMirror=async(value:string)=>{const result=await api.updates.configure({mirror:value});setMirror(null);setCustom(false);toast.success('镜像设置已保存，仅保存到本机；检查更新时才会联网。');return result;};
  return <section className="section-card" id="updates"><div className="section-card-head"><h2 className="section-card-title">应用更新</h2><p className="section-card-desc">自动检查新版本；GitHub不可用时按顺序回退内置镜像，也可指定镜像或自定义地址。下载完成后校验更新清单签名和安装包哈希，安装前保存数据库备份。</p></div>
    <p>当前版本 {state?.currentVersion??'—'}{state?.manifest?` · 可更新至 ${state.manifest.version}`:state?.lastChecked&&state.phase==='idle'?' · 当前已是最新版本':''}</p>
    <label className="row gap-2"><input type="checkbox" checked={state?.preferences.automatic??true} disabled={!state||busy} onChange={event=>void action(()=>api.updates.configure({automatic:event.target.checked}))}/>自动检查更新</label>
    <label className="row gap-2"><input type="checkbox" checked={state?.preferences.preview??false} disabled={!state||busy} onChange={event=>void action(()=>api.updates.configure({preview:event.target.checked}))}/>接收开发预览版</label>
    <label>更新下载来源<select className="select" aria-label="更新下载来源" disabled={busy||!state||state.phase==='downloading'} value={custom||!known?'custom':saved} onChange={event=>{const value=event.target.value;if(value==='custom'){setCustom(true);setMirror(known?'':saved);}else{void action(()=>saveMirror(value));}}}><option value="auto">GitHub优先，自动回退（推荐）</option><option value="">仅GitHub</option>{UPDATE_MIRRORS.map(item=><option key={item.id} value={item.url}>{item.label}</option>)}<option value="custom">自定义HTTPS镜像</option></select></label>
    {custom||!known?<><label>镜像前缀或HTTPS模板<input className="input" placeholder="https://你的镜像域名/ 或 https://example/?url={url}" value={mirror??state?.preferences.mirror??''} onChange={event=>setMirror(event.target.value)}/></label>
    <button className="btn btn-secondary btn-sm" disabled={busy||!state||state.phase==='downloading'} onClick={()=>void action(()=>saveMirror(mirror??state!.preferences.mirror))}>保存镜像</button></>:null}
    {state?.error?<p role="alert" className="field-error">{state.error}</p>:null}
    {state?.phase==='downloading'?<p role="status">正在下载 {formatBytes(state.downloadedBytes)} / {formatBytes(state.manifest?.asset.bytes??0)}</p>:null}
    <div className="row gap-2" style={{marginTop:16}}><button className="btn btn-secondary" disabled={busy||!state||['checking','downloading'].includes(state.phase)} onClick={()=>void action(()=>api.updates.check())}>{state?.phase==='checking'?'检查中…':'检查更新'}</button>
      {state?.manifest&&['available','error'].includes(state.phase)?<button className="btn btn-primary" disabled={busy} onClick={()=>void action(()=>api.updates.download())}>下载更新</button>:null}
      {state?.phase==='ready'?<button className="btn btn-primary" disabled={busy} onClick={()=>{if(window.confirm('即将保存数据库备份并退出My Cinema，启动已验证的安装包。继续？'))void action(()=>api.updates.install());}}>退出并安装</button>:null}
    </div><p className="setting-help">镜像只接收公开更新请求，影视库和账号凭据不会发给镜像。自动模式在GitHub失败后依次尝试GH-Proxy、GHFast、ghproxy.net；可选择仅GitHub。</p>
  </section>;
}
