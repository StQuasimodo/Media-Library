import { useState,useLayoutEffect,useRef } from 'react';
import { useBrowseState } from '../lib/useBrowseState';
import { FilmLink } from '../components/BrowseLink';
import { Link } from 'react-router-dom';
import type { LibrarySort, WatchStatus } from '@shared/types';
import { api, describeError } from '../lib/api';
import { useAppState } from '../lib/appState';
import { useToast } from '../lib/toast';
import { useAsyncData } from '../lib/useAsync';
import { EmptyState, ErrorState, SkeletonGrid } from '../components/primitives';
import { Icon } from '../components/icons';
import { PageHeading } from '../components/PageHeading';
import { PosterImage } from '../components/PosterImage';
import { formatDate, statusLabel } from '../lib/format';

const SORT_OPTIONS: Array<{ value: LibrarySort; label: string }> = [
  { value: 'collected_desc', label: '最近收藏' },
  { value: 'collected_asc', label: '最早收藏' },
  { value: 'title_asc', label: '标题 A→Z' },
  { value: 'year_desc', label: '年份新→旧' },
  { value: 'year_asc', label: '年份旧→新' },
];

export function WatchlistPage() {
  const { version, invalidate } = useAppState();
  const toast = useToast();
  const [sort, setSort] = useBrowseState<LibrarySort>('watchlist.sort','collected_desc');
  const [busyId, setBusyId] = useState<string | null>(null);

  const pendingFocus=useRef<string|null>(null);
  const entries = useAsyncData(
    () => api.library.list({ watchStatus: 'want', sort }),
    [version, sort],
  );

  const setStatus = async (entryId: string, status: WatchStatus, title: string) => {
    const current=entries.data??[],index=current.findIndex(entry=>entry.id===entryId),next=current[index+1]??current[index-1];pendingFocus.current=next?`watch:${next.id}:${status}`:'watch:empty';
    setBusyId(entryId);
    try {
      await api.library.updateEntry(entryId, { watchStatus: status });
      invalidate();
      toast.push(`《${title}》已标记为「${statusLabel(status)}」`);
    } catch (cause) {
      pendingFocus.current=null;toast.error(describeError(cause));
    } finally {
      setBusyId(null);
    }
  };

  const list = entries.data ?? [];
  useLayoutEffect(()=>{const key=pendingFocus.current;if(!key||list.some(entry=>entry.id===busyId))return;const target=document.querySelector<HTMLElement>(`[data-browse-key="${CSS.escape(key)}"]`);if(target){target.focus({preventScroll:true});pendingFocus.current=null;}},[entries.data,busyId]);

  return (
    <>
      <PageHeading title="想看清单" description={entries.loading ? '正在读取想看清单…' : entries.error ? '清单暂时无法读取。' : `${list.length} 部作品，留给下一次观影。`}>
        <select
          className="select"
          style={{ width: 'auto' }}
          value={sort}
          onChange={(event) => setSort(event.target.value as LibrarySort)}
          aria-label="排序方式"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </PageHeading>

      {entries.loading && !entries.data ? (
        <SkeletonGrid count={6} />
      ) : entries.error ? (
        <ErrorState message={entries.error} onRetry={entries.reload} />
      ) : list.length === 0 ? (
        <EmptyState
          icon="clock"
          title="没有想看的作品"
          text="把收藏中的作品标记为「想看」，它们就会出现在这里，方便你安排下一次观影。"
        >
          <Link to="/library" className="btn btn-secondary btn-sm" data-browse-key="watch:empty">
            去影视库标记
          </Link>
        </EmptyState>
      ) : (
        <div className="row-list watchlist-list">
          {list.map((entry, index) => (
            <div key={entry.id} className="row-card">
              <span className="watchlist-number">{String(index + 1).padStart(2, '0')}</span>
              <FilmLink film={entry.film} className="row-poster" tabIndex={-1} aria-label={`查看 ${entry.film.title}`} data-browse-key={`film:${entry.film.id}:poster`}>
                <PosterImage film={entry.film} />
              </FilmLink>
              <div className="row-main">
                <FilmLink film={entry.film} className="row-title">
                  {entry.film.title}
                </FilmLink>
                <div className="row-sub">
                  {[
                    entry.film.year,
                    entry.film.mediaType === 'tv' ? '剧集' : '电影',
                    `收藏于 ${formatDate(entry.collectedAt)}`,
                  ]
                    .filter(Boolean)
                    .map((value,index)=><span key={index} className={index?'meta-sep':undefined}>{value}</span>)}
                </div>
              </div>
              <div className="row-actions">
                {busyId === entry.id ? <span className="spinner" /> : null}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busyId === entry.id}
                  data-browse-key={`watch:${entry.id}:watching`} onClick={() => void setStatus(entry.id, 'watching', entry.film.title)}
                >
                  标记在看
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busyId === entry.id}
                  data-browse-key={`watch:${entry.id}:watched`} onClick={() => void setStatus(entry.id, 'watched', entry.film.title)}
                >
                  <Icon name="check" size={13} />
                  已看完
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
