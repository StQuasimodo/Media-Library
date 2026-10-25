import { useEffect, useState } from 'react';
import type { QuarkFolder, QuarkStatus } from '@shared/quark';
import { api, describeError } from '../lib/api';
import { formatBytes, formatDateTime } from '../lib/format';
import { Modal } from './primitives';
import { Icon } from './icons';

const root: QuarkFolder = { id: '0', name: '夸克网盘', path: '夸克网盘' };

export function QuarkFolderPanel() {
  const [status, setStatus] = useState<QuarkStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [picker, setPicker] = useState(false);
  const [trail, setTrail] = useState<QuarkFolder[]>([root]);
  const [folders, setFolders] = useState<QuarkFolder[]>([]);
  const [recursive, setRecursive] = useState(true);
  const [autoRead, setAutoRead] = useState(true);
  const [search, setSearch] = useState('');
  const busy = working || Boolean(status?.busy);
  const current = trail[trail.length - 1];

  useEffect(() => {
    let alive = true;
    void api.quark.status().then((value) => { if (alive) setStatus(value); })
      .catch((cause) => { if (alive) setError(describeError(cause)); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => {
      void api.quark.status().then(setStatus).catch(() => {});
    }, 750);
    return () => window.clearInterval(timer);
  }, [busy]);

  async function perform(action: () => Promise<void>) {
    setWorking(true);
    setError(null);
    try { await action(); }
    catch (cause) { setError(describeError(cause)); }
    finally {
      try { setStatus(await api.quark.status()); } catch { /* keep the concrete operation error */ }
      setWorking(false);
    }
  }
  const browse = async (nextTrail: QuarkFolder[]) => {
    const result = await api.quark.browse(nextTrail[nextTrail.length - 1].id);
    setFolders(result.folders);
    setTrail(nextTrail);
    setPicker(true);
  };
  const select = async () => {
    await api.quark.selectFolder(current.id, recursive, autoRead);
    setPicker(false);
    setStatus(await api.quark.scan());
  };
  const videos = status?.inventory?.videos ?? [];
  const query = search.trim().toLocaleLowerCase();
  const visible = videos.filter((item) => !query || `${item.name} ${item.path} ${item.hint.title}`.toLocaleLowerCase().includes(query));
  const shownError = error || status?.error;

  return (
    <section className="section-card" id="quark-cli">
      <div className="section-card-head">
        <h2 className="section-card-title">夸克文件夹</h2>
        <p className="section-card-desc">
          自动读取选定云端文件夹中的视频清单，无需上传视频或逐条填写分享链接。
          仅浏览目录与文件名，不下载、移动或改名网盘文件。
        </p>
      </div>
      {!status?.toolPath ? (
        <p className="setting-help">
          请先从夸克官方仓库安装工具，并通过官方浏览器授权连接你的网盘，然后选择已安装的 quark-drive.cjs。
          My Cinema 不接收账号密码或 Cookie。
        </p>
      ) : <p className="setting-help">已选择本机夸克工具。请在夸克端核对实际授权范围，也可在那里撤销授权。</p>}
      <div className="row gap-2 wrap quark-actions">
        <button className="btn btn-secondary btn-sm" type="button" disabled={busy}
          onClick={() => void perform(async () => { const next = await api.quark.chooseTool(); if (next) setStatus(next); })}>
          {status?.toolPath ? '更换授权工具' : '选择已安装的官方工具'}
        </button>
        <button className="btn btn-secondary btn-sm" type="button" disabled={busy || !status?.toolPath}
          onClick={() => void perform(async () => {
            setRecursive(status?.recursive ?? true); setAutoRead(status?.autoRead ?? true);
            await browse([root]);
          })}>
          选择云端文件夹
        </button>
        {status?.folder ? <button className="btn btn-primary btn-sm" type="button" disabled={busy}
          onClick={() => void perform(async () => { setStatus(await api.quark.scan()); })}>重新读取</button> : null}
        {status?.busy ? <button className="btn btn-ghost btn-sm" type="button"
          onClick={() => void api.quark.cancel().catch((cause) => setError(describeError(cause)))}>取消读取</button> : null}
        <button className="link-button" type="button" onClick={() => void api.app.openExternal('https://github.com/quark-clouddrive/quarkclouddrive_offical').catch((cause) => setError(describeError(cause)))}>官方安装与授权说明</button>
      </div>
      {status?.folder ? <p className="setting-help quark-source">
        {status.folder.path} · {status.recursive ? '包含子文件夹' : '仅当前文件夹'} · {status.autoRead ? '启动时自动读取' : '按需读取'}
      </p> : null}
      {busy ? <p role="status" className="muted"><span className="spinner" /> 正在读取夸克目录…</p> : null}
      {shownError ? <p role="alert" className="field-error">{shownError}</p> : null}
      {status?.notices.map((notice, index) => <p className="quark-notice" key={`${index}-${notice}`}>{notice}</p>)}
      {status?.inventory ? (
        <div className="quark-inventory">
          <div className="setting-name">已读取 {videos.length} 个视频</div>
          <p className="setting-help">上次成功读取：{formatDateTime(status.inventory.scannedAt)}。片名与季集是文件名识别线索，尚未自动加入收藏或匹配 TMDB。</p>
          <input className="input" aria-label="筛选夸克视频" placeholder="筛选文件名、路径或识别片名…" value={search} onChange={(event) => setSearch(event.target.value)} />
          <p className="setting-help">匹配 {visible.length} 个，当前展示前 {Math.min(100, visible.length)} 个。</p>
          <div className="quark-video-list">
            {visible.slice(0, 100).map((video) => (
              <article className="quark-video" key={video.id}>
                <div className="quark-video-title">{video.hint.title}{video.hint.year ? ` · ${video.hint.year}` : ''}</div>
                <p className="setting-help">{video.name}</p>
                <p className="setting-help">{video.path} · {video.size == null ? '大小未知' : formatBytes(video.size)}{video.hint.season != null ? ` · 第 ${video.hint.season} 季` : ''}{video.hint.episode != null ? ` · 第 ${video.hint.episode} 集` : ''}</p>
                {video.checkUrl ? <button className="link-button" type="button" onClick={() => void api.app.openExternal(video.checkUrl!).catch((cause) => setError(describeError(cause)))}><Icon name="external" size={12} /> 在夸克中查看</button> : null}
              </article>
            ))}
          </div>
        </div>
      ) : null}
      <Modal open={picker} title="选择要自动读取的云端文件夹" onClose={() => setPicker(false)}
        footer={<><span className="spacer" /><button className="btn btn-primary" type="button" disabled={busy} onClick={() => void perform(select)}>读取此文件夹</button></>}>
        <div className="row gap-2 wrap quark-breadcrumbs">
          {trail.map((folder, index) => <button className="link-button" type="button" disabled={busy} key={folder.id} onClick={() => void perform(() => browse(trail.slice(0, index + 1)))}>{folder.name}{index < trail.length - 1 ? ' /' : ''}</button>)}
        </div>
        <label className="row gap-2"><input type="checkbox" checked={recursive} onChange={(event) => setRecursive(event.target.checked)} /> 包含子文件夹</label>
        <label className="row gap-2"><input type="checkbox" checked={autoRead} onChange={(event) => setAutoRead(event.target.checked)} /> 应用启动时自动读取</label>
        {shownError ? <p className="field-error" role="alert">{shownError}</p> : null}
        <div className="stack gap-2 quark-folders">
          {folders.map((folder) => <button className="btn btn-secondary" type="button" disabled={busy} key={folder.id} onClick={() => void perform(() => browse([...trail, folder]))}><Icon name="folder" size={15} /> {folder.name}</button>)}
          {!folders.length ? <p className="dim">没有子文件夹，可以直接读取当前文件夹。</p> : null}
        </div>
      </Modal>
    </section>
  );
}
