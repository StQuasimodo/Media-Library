import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppState } from '../lib/appState';
import { describeError } from '../lib/api';
import { useToast } from '../lib/toast';
import { Icon } from './icons';

export function LibraryRefreshButton() {
  const { libraryRefresh, startLibraryRefresh } = useAppState();
  const [starting, setStarting] = useState(false);
  const toast = useToast();
  const busy = starting || Boolean(libraryRefresh?.busy);
  async function start() {
    setStarting(true);
    try { await startLibraryRefresh(); } catch (error) { toast.error(describeError(error)); }
    finally { setStarting(false); }
  }
  return <button type="button" className="btn btn-secondary btn-sm" aria-label="刷新全部影视资料和夸克信息"
    title="刷新整个影视库的资料、图片和已选夸克目录，不受当前筛选影响" disabled={busy} onClick={() => void start()}>
    {busy ? <span className="spinner" /> : <Icon name="refresh" size={14} />}{busy ? '刷新中…' : '全部刷新'}
  </button>;
}

export function LibraryRefreshNotice() {
  const { libraryRefresh: status, refreshPollingError, cancelLibraryRefresh } = useAppState();
  const toast = useToast();
  if (!status?.id) return null;
  const heading = status.busy
    ? status.cancelRequested ? '正在停止刷新，等待当前请求结束…' : status.phase === 'quark' ? '正在刷新夸克目录…' : `正在刷新影视资料 ${status.completed} / ${status.total}`
    : status.cancelled ? '刷新已停止' : '刷新结束';
  return <section className="library-refresh-notice" aria-label="全部刷新进度">
    <div className="row gap-2 wrap" role="status" aria-live="polite">
      <strong>{heading}</strong>
      {status.busy ? <progress aria-label="资料刷新进度" max={status.total || 1} value={status.phase === 'metadata' ? status.completed : undefined} /> : null}
      <span className="setting-help">资料已更新 {status.updated} 部 · 失败 {status.failed} 部 · 跳过 {status.skipped} 部{status.imageWarnings ? ` · 图片待重试 ${status.imageWarnings} 部` : ''}</span>
      {status.busy ? <button type="button" className="link-button" disabled={status.cancelRequested}
        onClick={() => void cancelLibraryRefresh().catch(error => toast.error(describeError(error)))}>停止刷新</button> : null}
    </div>
    {status.currentTitle ? <p className="setting-help">{status.currentTitle}</p> : null}
    {status.quark.message ? <p className="setting-help">夸克：{status.quark.message}</p> : null}
    {status.message ? <p className="setting-help">{status.message}</p> : null}
    {!status.busy && status.skipped > 0 && !status.message ? <p className="setting-help">手动添加、没有外部资料或刷新期间已删除的作品会跳过。</p> : null}
    {status.cancelled && status.completed < status.total ? <p className="setting-help">尚有 {status.total - status.completed} 部未处理，可再次全部刷新。</p> : null}
    {refreshPollingError ? <p className="field-error">进度暂时不可用：{refreshPollingError}，正在重试读取。</p> : null}
    {status.errors.length ? <details><summary className="link-button">查看失败作品{status.failed > status.errors.length ? '（前50项）' : ''}</summary>
      <ul>{status.errors.map(error => <li key={error.filmId}><Link to={`/film/${error.filmId}`}>{error.title}</Link>：{error.message}</li>)}</ul>
    </details> : null}
    {status.imageWarningDetails.length ? <details><summary className="link-button">查看图片未完整更新的作品{status.imageWarnings > status.imageWarningDetails.length ? '（前50项）' : ''}</summary>
      <ul>{status.imageWarningDetails.map(item => <li key={item.filmId}><Link to={`/film/${item.filmId}`}>{item.title}</Link>：{item.message}</li>)}</ul>
    </details> : null}
    <p className="setting-help">更新整个影视库；个人评分、短评和专题保留。<Link to="/settings">连接与配置</Link></p>
  </section>;
}
