import { useEffect, useRef, useState } from 'react';
import type { LibrarySort, WatchStatus } from '@shared/types';
import { api } from '../lib/api';
import { useAppState } from '../lib/appState';
import { useAsyncData, useDebounced } from '../lib/useAsync';
import { consumeSearchFocus } from '../lib/shortcuts';
import { EmptyState, ErrorState, PosterCard, SkeletonGrid } from '../components/primitives';
import { Icon } from '../components/icons';
import { PageHeading } from '../components/PageHeading';

const SORT_OPTIONS: Array<{ value: LibrarySort; label: string }> = [
  { value: 'collected_desc', label: '最近收藏' },
  { value: 'collected_asc', label: '最早收藏' },
  { value: 'title_asc', label: '标题 A→Z' },
  { value: 'title_desc', label: '标题 Z→A' },
  { value: 'year_desc', label: '年份新→旧' },
  { value: 'year_asc', label: '年份旧→新' },
  { value: 'rating_desc', label: '评分高→低' },
];

export function LibraryPage({ onOpenImport }: { onOpenImport: () => void }) {
  const { version, settings, info } = useAppState();
  const [search, setSearch] = useState('');
  const [year, setYear] = useState('');
  const [status, setStatus] = useState<WatchStatus | 'all'>('all');
  const [collectionId, setCollectionId] = useState('');
  const [sort, setSort] = useState<LibrarySort>(settings.defaultSort);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const debouncedSearch = useDebounced(search, 250);

  useEffect(() => {
    setSort(settings.defaultSort);
  }, [settings.defaultSort]);

  // Ctrl+F lands here; the flag survives the route change.
  useEffect(() => {
    if (consumeSearchFocus()) {
      searchRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    const handler = () => searchRef.current?.focus();
    window.addEventListener('cinema:focus-library-search', handler);
    return () => window.removeEventListener('cinema:focus-library-search', handler);
  }, []);

  const years = useAsyncData(() => api.library.years(), [version]);
  const collections = useAsyncData(() => api.collections.list(), [version]);

  const entries = useAsyncData(
    () =>
      api.library.list({
        search: debouncedSearch.trim() || undefined,
        year: year ? Number.parseInt(year, 10) : null,
        watchStatus: status,
        collectionId: collectionId || null,
        sort,
      }),
    [version, debouncedSearch, year, status, collectionId, sort],
  );

  const hasFilters = Boolean(search || year || status !== 'all' || collectionId);
  const list = entries.data ?? [];
  const compact = settings.posterDensity === 'compact';

  const clearFilters = () => {
    setSearch('');
    setYear('');
    setStatus('all');
    setCollectionId('');
  };

  return (
    <>
      <PageHeading title="全部收藏" eyebrow="THE COLLECTION" description="电影、剧集，以及留给自己的观影记录。">
        <button type="button" className="btn btn-secondary" onClick={onOpenImport}><Icon name="plus" size={14} /> 添加作品</button>
      </PageHeading>
      <div className="toolbar library-toolbar">
        <div className="search-field">
          <span className="search-icon">
            <Icon name="search" size={15} />
          </span>
          <input
            ref={searchRef}
            className="input"
            placeholder="搜索标题、原名、简介或笔记…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="搜索影视库"
          />
        </div>

        <select
          className="select"
          value={status}
          onChange={(event) => setStatus(event.target.value as WatchStatus | 'all')}
          aria-label="按观看状态筛选"
        >
          <option value="all">全部状态</option>
          <option value="want">想看</option>
          <option value="watching">观看中</option>
          <option value="watched">已看完</option>
          <option value="dropped">暂不观看</option>
        </select>

        <select
          className="select"
          value={year}
          onChange={(event) => setYear(event.target.value)}
          aria-label="按年份筛选"
        >
          <option value="">全部年份</option>
          {(years.data ?? []).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>

        <select
          className="select"
          value={collectionId}
          onChange={(event) => setCollectionId(event.target.value)}
          aria-label="按专题筛选"
        >
          <option value="">全部专题</option>
          {(collections.data ?? []).map((collection) => (
            <option key={collection.id} value={collection.id}>
              {collection.name}
            </option>
          ))}
        </select>

        <select
          className="select"
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

        <span className="toolbar-spacer" />
        <span className="result-count">{entries.loading ? '…' : `${list.length} 部`}</span>

      </div>

      {hasFilters ? (
        <div className="active-filters">
          {search ? <span className="chip is-active">搜索：{search}</span> : null}
          {year ? <span className="chip is-active">年份：{year}</span> : null}
          {status !== 'all' ? (
            <span className="chip is-active">
              状态：
              {status === 'want'
                ? '想看'
                : status === 'watching'
                  ? '观看中'
                  : status === 'watched'
                    ? '已看完'
                    : '暂不观看'}
            </span>
          ) : null}
          {collectionId ? (
            <span className="chip is-active">
              专题：{(collections.data ?? []).find((item) => item.id === collectionId)?.name ?? '—'}
            </span>
          ) : null}
          <button type="button" className="link-button" onClick={clearFilters}>
            清除筛选
          </button>
        </div>
      ) : null}

      {entries.loading && !entries.data ? (
        <SkeletonGrid count={12} compact={compact} />
      ) : entries.error ? (
        <ErrorState message={entries.error} onRetry={entries.reload} />
      ) : list.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon="search"
            title="没有符合条件的作品"
            text="试试更宽泛的关键词，或清除当前筛选条件。"
          >
            <button type="button" className="btn btn-secondary btn-sm" onClick={clearFilters}>
              清除筛选
            </button>
          </EmptyState>
        ) : (
          <EmptyState
            icon="library"
            title="收藏库还是空的"
            text={
              info?.hasMetadataApiKey
                ? '从 TMDB 搜索并导入第一部作品。资料与海报会保存在本机。'
                : info?.metadataCredentialState === 'unreadable' || info?.metadataCredentialState === 'unavailable'
                  ? '已保存的 TMDB API Key 暂时无法读取，请到「设置」重新检查，也可先手动添加作品。'
                  : '可以先手动添加一部作品，或到「设置」配置 TMDB API Key 后在线搜索。'
            }
          >
            <button type="button" className="btn btn-primary btn-sm" onClick={onOpenImport}>
              <Icon name="plus" size={14} />
              添加第一部作品
            </button>
          </EmptyState>
        )
      ) : (
        <div className={`poster-grid${compact ? ' is-compact' : ''}`}>
          {list.map((entry) => (
            <PosterCard key={entry.id} entry={entry} compact={compact} />
          ))}
        </div>
      )}
    </>
  );
}
