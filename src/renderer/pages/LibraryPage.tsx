import { handlePosterNavigation } from '../lib/posterNavigation';
import {folderTitle} from '@shared/folderTitle';
import {seriesFolders} from '@shared/franchises';
import {SeriesFolderDialog} from '../components/SeriesFolderDialog';
import {PosterImage} from '../components/PosterImage';
import { useEffect, useRef, useState } from 'react';
import type { LibrarySort, WatchStatus } from '@shared/types';
import { groupSeriesEntries,identifySeries } from '@shared/series';
import { useResolveSeries } from '../lib/useSeries';
import { useBrowseState } from '../lib/useBrowseState';
import { api } from '../lib/api';
import { useAppState } from '../lib/appState';
import { useAsyncData, useDebounced } from '../lib/useAsync';
import { consumeSearchFocus } from '../lib/shortcuts';
import { EmptyState, ErrorState, PosterCard, SkeletonGrid } from '../components/primitives';
import { Icon } from '../components/icons';
import { PageHeading } from '../components/PageHeading';
import { LibraryRefreshButton, LibraryRefreshNotice } from '../components/LibraryRefresh';

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
  const [view,setView]=useBrowseState('library.view', ()=>{try{return localStorage.getItem('mycinema.libraryView')??'wall';}catch{return 'wall';}});
  const [viewTransition,setViewTransition]=useState(false);
  const [folderKey,setFolderKey]=useBrowseState('library.folderKey', '');
  const [filtersOpen,setFiltersOpen]=useBrowseState('library.filtersOpen',false);
  const [folderDialog,setFolderDialog]=useState(false);
  const [seriesKey,setSeriesKey]=useBrowseState('library.seriesKey', '');
  const [seriesAnchor,setSeriesAnchor]=useBrowseState('library.seriesAnchor', '');
  const [grouped,setGrouped]=useBrowseState('library.grouped', ()=>{try{return localStorage.getItem('mycinema.groupSeries')!=='false';}catch{return true;}});
  const [search, setSearch] = useBrowseState('library.search', '');
  const [year, setYear] = useBrowseState('library.year', '');
  const [status, setStatus] = useBrowseState<WatchStatus | 'all'>('library.status', 'all');
  const [collectionId, setCollectionId] = useBrowseState('library.collectionId', '');
  const [sort, setSort] = useBrowseState<LibrarySort>('library.sort', settings.defaultSort);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const debouncedSearch = useDebounced(search, 250);

  const previousDefaultSort=useRef(settings.defaultSort);
  useEffect(()=>{if(previousDefaultSort.current!==settings.defaultSort)setSort(settings.defaultSort);previousDefaultSort.current=settings.defaultSort;},[settings.defaultSort]);

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

  const source=entries.data ?? [];
  const resolvingSeries=useResolveSeries(source);
  const identities=identifySeries(source);
  const seriesOptions=[...new Map([...identities.values()].map(value=>[value.key,value])).values()].sort((a,b)=>a.title.localeCompare(b.title,'zh-CN',{numeric:true}));
  const effectiveSeriesKey=seriesOptions.some(value=>value.key===seriesKey) ? seriesKey : identities.get(seriesAnchor)?.key ?? seriesKey;
  const filtered=effectiveSeriesKey ? source.filter(entry=>identities.get(entry.id)?.key===effectiveSeriesKey) : source;
  const list=grouped ? groupSeriesEntries(filtered,identities) : filtered;
  const folders=seriesFolders(list),currentFolder=folders.find(folder=>folder.key===folderKey);
  const visibleList=view==='folders'&&currentFolder?currentFolder.entries:list;
  const hasFilters = Boolean(search || year || status !== 'all' || collectionId || seriesKey);
  const compact = settings.posterDensity === 'compact';

  const clearFilters = () => {
    setSearch('');
    setYear('');
    setStatus('all');
    setCollectionId('');
    setSeriesKey('');setSeriesAnchor('');
  };

  return (
    <>
      <PageHeading className="library-heading" title="全部收藏" description={<span className="result-count">{entries.loading?'…':`${list.length} 部`}</span>}><button type="button" className="btn btn-secondary" onClick={onOpenImport}><Icon name="plus" size={14}/>添加作品</button></PageHeading>
      <div className="library-controls" aria-label="影视库浏览工具">
        <div className="search-field"><span className="search-icon"><Icon name="search" size={15}/></span><input ref={searchRef} className="input" placeholder="搜索标题、原名、简介或笔记…" value={search} onChange={event=>setSearch(event.target.value)} aria-label="搜索影视库"/></div>
        <div className="segmented" role="group" aria-label="影视库视图">{[['wall','海报墙'],['folders','系列文件夹']].map(([key,label])=><button type="button" key={key} aria-pressed={view===key} onClick={()=>{setViewTransition(true);setView(key);setFolderKey('');try{localStorage.setItem('mycinema.libraryView',key);}catch{}}}>{label}</button>)}</div>
        <select className="select library-sort" value={sort} onChange={event=>setSort(event.target.value as LibrarySort)} aria-label="排序方式">{SORT_OPTIONS.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>
        <button type="button" className="btn btn-secondary btn-sm" aria-expanded={filtersOpen} aria-controls="library-filters" onClick={()=>setFiltersOpen(!filtersOpen)}><Icon name="filter" size={14}/>筛选{hasFilters?<span className="filter-indicator" aria-label="已应用筛选"/>:null}</button><LibraryRefreshButton/>
        <details className="library-organize"><summary className="btn btn-icon" aria-label="整理选项" title="整理选项"><Icon name="more" size={18}/></summary><div className="library-organize-menu"><button type="button" className="btn btn-ghost" onClick={event=>{setFolderDialog(true);event.currentTarget.closest('details')?.removeAttribute('open');}}>整理系列文件夹</button><label className="row gap-2"><input type="checkbox" aria-label="同系列聚合" checked={grouped} onChange={event=>{setGrouped(event.target.checked);try{localStorage.setItem('mycinema.groupSeries',String(event.target.checked));}catch{}}}/>同系列聚合</label></div></details>
      </div>
      {filtersOpen?<div className="library-filter-panel" id="library-filters" aria-label="收藏筛选条件">
        <label>观看状态<select className="select" value={status} onChange={event=>setStatus(event.target.value as WatchStatus|'all')} aria-label="按观看状态筛选"><option value="all">全部状态</option><option value="want">想看</option><option value="watching">观看中</option><option value="watched">已看完</option><option value="dropped">暂不观看</option></select></label>
        <label>年份<select className="select" value={year} onChange={event=>setYear(event.target.value)} aria-label="按年份筛选"><option value="">全部年份</option>{(years.data??[]).map(value=><option key={value} value={value}>{value}</option>)}</select></label>
        <label>专题<select className="select" value={collectionId} onChange={event=>setCollectionId(event.target.value)} aria-label="按专题筛选"><option value="">全部专题</option>{(collections.data??[]).map(collection=><option key={collection.id} value={collection.id}>{collection.name}</option>)}</select></label>
        <label>系列<select className="select" aria-label="按系列筛选" value={effectiveSeriesKey} onChange={event=>{const key=event.target.value;setSeriesKey(key);setSeriesAnchor(source.find(entry=>identities.get(entry.id)?.key===key)?.id??'');}}><option value="">全部系列</option>{seriesOptions.map(series=><option key={series.key} value={series.key}>{series.title}</option>)}</select></label>
      </div>:null}
      <LibraryRefreshNotice/>{folderDialog?<SeriesFolderDialog entries={source} onClose={()=>setFolderDialog(false)}/>:null}
      {view==='folders'&&currentFolder?<div className="folder-breadcrumb"><button className="link-button" onClick={()=>{setViewTransition(true);setFolderKey('');}}>全部文件夹</button><span className="meta-sep">{folderTitle(currentFolder.title)}</span><span className="meta-sep">{currentFolder.entries.length} 部</span></div>:null}
      {resolvingSeries?<p className="setting-help" role="status">正在补充已有电影的系列信息…</p>:null}
      {hasFilters ? (
        <div className="active-filters">
          {seriesKey ? <span className="chip is-active">系列：{seriesOptions.find(series=>series.key===effectiveSeriesKey)?.title ?? '当前系列'}</span> : null}
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
      ) : view==='folders'&&!currentFolder ? (
        <div key={`${view}:${folderKey}`} onKeyDown={handlePosterNavigation} className={`series-folder-grid${viewTransition ? ' is-view-entering' : ''}`}>{folders.map(folder=>folder.standalone?<PosterCard key={folder.key} entry={folder.entries[0]} compact={compact}/>:<button className="series-folder-card" data-browse-key={`folder:${folder.key}`} key={folder.key} onClick={()=>{setViewTransition(true);setFolderKey(folder.key);}}>
          <div className="series-folder-art">{folder.entries.slice(0,3).reverse().map((entry,index)=><div key={entry.id} className={`folder-poster folder-poster-${index}`}><PosterImage film={entry.film}/></div>)}</div><strong>{folderTitle(folder.title)}</strong><span className="folder-count">{folder.entries.length} 部作品</span>
        </button>)}</div>
      ) : (
        <div key={`${view}:${folderKey}`} onKeyDown={handlePosterNavigation} className={`poster-grid${compact ? ' is-compact' : ''}${viewTransition ? ' is-view-entering' : ''}`}>
          {visibleList.map((entry) => (
            <PosterCard key={entry.id} entry={entry} compact={compact} />
          ))}
        </div>
      )}
    </>
  );
}
