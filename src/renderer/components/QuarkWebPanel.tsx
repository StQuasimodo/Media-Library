import { useEffect, useState } from 'react';
import type { QuarkWebDirectory, QuarkWebStatus } from '@shared/quarkWeb';
import { api, describeError } from '../lib/api';
import { ConfirmDialog } from './primitives';
import { QuarkFolderPanel } from './QuarkFolderPanel';
import { QuarkSyncPanel } from './QuarkSyncPanel';

const root = { id: '0', name: '夸克网盘' };
const labels = { not_checked: '尚未检查连接', login_required: '需要登录或重新登录', verified: '目录访问已验证', unavailable: '暂时无法验证连接' };
export function QuarkWebPanel() {
  const [status, setStatus] = useState<QuarkWebStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trail, setTrail] = useState([root]);
  const [directory, setDirectory] = useState<QuarkWebDirectory | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [syncBusy,setSyncBusy]=useState(false);
  const [hasSource,setHasSource]=useState(false);
  const [reconnecting,setReconnecting]=useState(false);
  const [refreshToken,setRefreshToken]=useState(0);
  const [visibleCount,setVisibleCount]=useState(200);
  const working=busy || syncBusy;
  useEffect(() => {
    let live = true;
    void api.quarkWeb.status().then(value => { if (live) setStatus(value); }).catch(cause => { if (live) setError(describeError(cause)); });
    return () => { live = false; };
  }, [syncBusy]);
  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await action(); } catch (cause) { setError(describeError(cause)); }
    finally { try { setStatus(await api.quarkWeb.status()); } catch { /* keep actionable error */ } setBusy(false); setRefreshToken(value=>value+1); }
  }
  async function browse(next: typeof trail) {
    const value = await api.quarkWeb.list(next.at(-1)!.id); setDirectory(value); setTrail(next); setVisibleCount(200);
  }
  async function connect() {
    await perform(async()=>{setDirectory(null);setTrail([root]);setStatus(await api.quarkWeb.connect());});
  }
  return <section id="quark" className="section-card">
    <div className="section-card-head"><h2 className="section-card-title">夸克网盘</h2>
      <p className="section-card-desc">在官方网页完成登录，再选择影视目录。登录会话独立保存在本机，无需安装 Skill 或填写 Cookie。</p></div>
    <p className="setting-name" role="status">{working ? '正在处理…' : status ? labels[status.state] : '正在读取连接状态…'}</p>
    <div className="row gap-2 wrap">
      <button type="button" className="btn cinema-primary" disabled={working} onClick={()=>{if(hasSource)setReconnecting(true);else void connect();}}>关联夸克账号</button>
      {status?.loginOpen ? <button type="button" className="btn btn-secondary" disabled={working} onClick={()=>void perform(async()=>{
        setDirectory(null);setTrail([root]);setStatus(await api.quarkWeb.finishLogin());
      })}>已登录，关闭窗口并检查</button> : null}
      <button type="button" className="btn btn-secondary" disabled={working} onClick={() => void perform(async () => {
        const value = await api.quarkWeb.check(); setStatus(value);
        setDirectory(null); setTrail([root]);
      })}>检查连接</button>
      <button type="button" className="btn btn-secondary" disabled={working || status?.state !== 'verified'} onClick={() => void perform(() => browse([root]))}>浏览云端目录</button>
      <button type="button" className="link-button" disabled={working} onClick={() => setDisconnecting(true)}>断开本机会话</button>
    </div>
    <p className="setting-help">完成官方网页登录后，关闭网页登录窗口并检查连接，再浏览到指定影视目录。下方可递归读取、匹配 TMDB 并直接关联云端文件；真实账号接入仍需本机验收。</p>
    {(error || status?.error) ? <p role="alert" className="field-error">{error || status?.error}</p> : null}
    {directory ? <div className="quark-inventory">
      <div className="row gap-2 wrap">{trail.map((folder, index) => <button type="button" className="link-button" disabled={working} key={folder.id} onClick={() => void perform(() => browse(trail.slice(0, index + 1)))}>{folder.name}{index < trail.length - 1 ? ' /' : ''}</button>)}
        <button type="button" className="link-button" disabled={working} onClick={() => void perform(() => browse(trail))}>重新读取</button></div>
      <p className="setting-help">本目录已完整读取 {directory.total} 项，视频 {directory.items.filter(item => item.video).length} 项。当前显示前{Math.min(visibleCount,directory.total)}项，点击文件夹进入。</p>
      <div className="quark-video-list">{directory.items.slice(0, visibleCount).map(item => <div className="quark-video" key={item.id}>
        {item.directory ? <button type="button" className="link-button" disabled={working} onClick={() => void perform(() => browse([...trail, { id: item.id, name: item.name }]))}>文件夹 · {item.name}</button>
          : <span>{item.video ? '视频' : '文件'} · {item.name}</span>}
      </div>)}</div>
      {visibleCount<directory.total ? <button type="button" className="link-button" disabled={working} onClick={()=>setVisibleCount(visibleCount+200)}>显示更多目录条目</button> : null}
    </div> : null}
    <QuarkSyncPanel folderId={directory ? trail.at(-1)!.id : null} blocked={busy || Boolean(status?.loginOpen)} refreshToken={refreshToken} onBusyChange={setSyncBusy} onSourceChange={setHasSource}/>
    <details style={{ marginTop: 24 }}><summary className="setting-help">高级：官方工具目录桥接（原有入口）</summary><QuarkFolderPanel /></details>
    <ConfirmDialog open={reconnecting} title="重新关联夸克账号？" message="重新关联将重置当前同步目录和自动导入选项，已有收藏及历史文件关联会保留。" confirmLabel="重新关联" busy={working} onCancel={()=>setReconnecting(false)} onConfirm={()=>{setReconnecting(false);void connect();}}/>
    <ConfirmDialog open={disconnecting} title="断开本机会话？" message="将清除 My Cinema 自己保存的夸克网页登录会话。不会删除收藏或网盘文件，也不代表撤销其他应用的授权。" confirmLabel="断开" busy={working}
      onCancel={() => setDisconnecting(false)} onConfirm={() => void perform(async () => {
        setStatus(await api.quarkWeb.disconnect()); setDirectory(null); setTrail([root]); setDisconnecting(false);
      })} />
  </section>;
}
