import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { LibrarySort, WatchStatus } from '@shared/types';
import { api, describeError } from '../lib/api';
import { useAppState } from '../lib/appState';
import { useToast } from '../lib/toast';
import { useAsyncData } from '../lib/useAsync';
import { EmptyState, ErrorState, SkeletonGrid } from '../components/primitives';
import { Icon } from '../components/icons';
import { formatDate, imageUrl, statusLabel } from '../lib/format';

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
  const [sort, setSort] = useState<LibrarySort>('collected_desc');
  const [busyId, setBusyId] = useState<string | null>(null);

  const entries = useAsyncData(
    () => api.library.list({ watchStatus: 'want', sort }),
    [version, sort],
  );

  const setStatus = async (entryId: string, status: WatchStatus, title: string) => {
    setBusyId(entryId);
    try {
      await api.library.updateEntry(entryId, { watchStatus: status });
      invalidate();
      toast.push(`《${title}》已标记为「${statusLabel(status)}」`);
    } catch (cause) {
      toast.error(describeError(cause));
    } finally {
      setBusyId(null);
    }
  };

  const list = entries.data ?? [];

  return (
    <>
      <div className="section-head">
        <h1 className="section-title" style={{ fontSize: 22 }}>
          想看
        </h1>
        <span className="section-sub">{entries.loading ? '…' : `${list.length} 部待看`}</span>
        <span className="spacer" />
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
      </div>

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
          <Link to="/library" className="btn btn-secondary btn-sm">
            去影视库标记
          </Link>
        </EmptyState>
      ) : (
        <div className="row-list">
          {list.map((entry) => (
            <div key={entry.id} className="row-card">
              <Link to={`/film/${entry.film.id}`} className="row-poster">
                {imageUrl(entry.film.posterPath) ? (
                  <img src={imageUrl(entry.film.posterPath) as string} alt="" loading="lazy" />
                ) : null}
              </Link>
              <div className="row-main">
                <Link to={`/film/${entry.film.id}`} className="row-title">
                  {entry.film.title}
                </Link>
                <div className="row-sub">
                  {[
                    entry.film.year,
                    entry.film.mediaType === 'tv' ? '剧集' : '电影',
                    `收藏于 ${formatDate(entry.collectedAt)}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              <div className="row-actions">
                {busyId === entry.id ? <span className="spinner" /> : null}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busyId === entry.id}
                  onClick={() => void setStatus(entry.id, 'watching', entry.film.title)}
                >
                  开始观看
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busyId === entry.id}
                  onClick={() => void setStatus(entry.id, 'watched', entry.film.title)}
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
