import { useEffect, useState } from 'react';
import type { QuarkWebDirectory, QuarkWebStatus } from '@shared/quarkWeb';
import { api, describeError } from '../lib/api';
import { ConfirmDialog } from './primitives';
import { QuarkFolderPanel } from './QuarkFolderPanel';

const root = { id: '0', name: '夸克网盘' };
const labels = { not_checked: '尚未检查连接', login_required: '需要登录或重新登录', verified: '目录访问已验证', unavailable: '暂时无法验证连接' };
export function QuarkWebPanel() {
  const [status, setStatus] = useState<QuarkWebStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trail, setTrail] = useState([root]);
  const [directory, setDirectory] = useState<QuarkWebDirectory | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  useEffect(() => {
    let live = true;
    void api.quarkWeb.status().then(value => { if (live) setStatus(value); }).catch(cause => { if (live) setError(describeError(cause)); });
    return () => { live = false; };
  }, []);
  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await action(); } catch (cause) { setError(describeError(cause)); }
    finally { try { setStatus(await api.quarkWeb.status()); } catch { /* keep actionable error */ } setBusy(false); }
  }
  async function browse(next: typeof trail) {
    const value = await api.quarkWeb.list(next.at(-1)!.id); setDirectory(value); setTrail(next);
  }
  return <section id="quark" className="section-card">
    <div className="section-card-head"><h2 className="section-card-title">夸克网盘</h2>
      <p className="section-card-desc">在官方网页完成登录，再选择影视目录。登录会话独立保存在本机，无需安装 Skill 或填写 Cookie。</p></div>
    <p className="setting-name" role="status">{busy ? '正在处理…' : status ? labels[status.state] : '正在读取连接状态…'}</p>
    <div className="row gap-2 wrap">
      <button type="button" className="btn cinema-primary" disabled={busy} onClick={() => void perform(async () => {
        setDirectory(null); setTrail([root]); setStatus(await api.quarkWeb.connect());
      })}>关联夸克账号</button>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void perform(async () => {
        const value = await api.quarkWeb.check(); setStatus(value);
        if (value.state !== 'verified') { setDirectory(null); setTrail([root]); }
      })}>检查连接</button>
      <button type="button" className="btn btn-secondary" disabled={busy || status?.state !== 'verified'} onClick={() => void perform(() => browse([root]))}>浏览云端目录</button>
      <button type="button" className="link-button" disabled={busy} onClick={() => setDisconnecting(true)}>断开本机会话</button>
    </div>
    <p className="setting-help">网页登录接入仍在验证中。登录完成后回到这里点击“检查连接”；只有真实目录接口返回成功才显示已验证。当前可浏览目录，尚未自动匹配 TMDB 或加入收藏。</p>
    {(error || status?.error) ? <p role="alert" className="field-error">{error || status?.error}</p> : null}
    {directory ? <div className="quark-inventory">
      <div className="row gap-2 wrap">{trail.map((folder, index) => <button type="button" className="link-button" disabled={busy} key={folder.id} onClick={() => void perform(() => browse(trail.slice(0, index + 1)))}>{folder.name}{index < trail.length - 1 ? ' /' : ''}</button>)}
        <button type="button" className="link-button" disabled={busy} onClick={() => void perform(() => browse(trail))}>重新读取</button></div>
      <p className="setting-help">本目录已完整读取 {directory.total} 项，视频 {directory.items.filter(item => item.video).length} 项。当前显示前200项，点击文件夹进入。</p>
      <div className="quark-video-list">{directory.items.slice(0, 200).map(item => <div className="quark-video" key={item.id}>
        {item.directory ? <button type="button" className="link-button" disabled={busy} onClick={() => void perform(() => browse([...trail, { id: item.id, name: item.name }]))}>文件夹 · {item.name}</button>
          : <span>{item.video ? '视频' : '文件'} · {item.name}</span>}
      </div>)}</div>
    </div> : null}
    <details style={{ marginTop: 24 }}><summary className="setting-help">高级：官方工具目录桥接（原有入口）</summary><QuarkFolderPanel /></details>
    <ConfirmDialog open={disconnecting} title="断开本机会话？" message="将清除 My Cinema 自己保存的夸克网页登录会话。不会删除收藏或网盘文件，也不代表撤销其他应用的授权。" confirmLabel="断开" busy={busy}
      onCancel={() => setDisconnecting(false)} onConfirm={() => void perform(async () => {
        setStatus(await api.quarkWeb.disconnect()); setDirectory(null); setTrail([root]); setDisconnecting(false);
      })} />
  </section>;
}
