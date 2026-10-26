import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { CollectionEntry } from '@shared/types';
import { groupSeriesEntries } from '@shared/series';
import { useResolveSeries } from '../lib/useSeries';
import { api, describeError } from '../lib/api';
import { useAppState } from '../lib/appState';
import { useToast } from '../lib/toast';
import { useAsyncData } from '../lib/useAsync';
import { EmptyState, ErrorState, LoadingRow, Modal, PosterCard } from '../components/primitives';
import { Icon } from '../components/icons';
import { HeroBackdrop } from '../components/HeroBackdrop';
import { imageUrl, statusLabel } from '../lib/format';

export function CollectionDetailPage() {
  const { collectionId } = useParams<{ collectionId: string }>();
  const { version, invalidate } = useAppState();
  const toast = useToast();
  const navigate = useNavigate();

  const detail = useAsyncData(
    () => api.collections.detail(collectionId as string),
    [collectionId, version],
  );
  const library = useAsyncData(() => api.library.list({ sort: 'title_asc' }), [version]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!pickerOpen) setPickerSearch('');
  }, [pickerOpen]);

  useResolveSeries(detail.data?.entries ?? []);

  if (!collectionId) return null;
  if (detail.loading && !detail.data) return <div className="cinema-status"><LoadingRow label="正在读取专题…" /></div>;
  if (detail.error) return <div className="cinema-status"><ErrorState message={detail.error} onRetry={detail.reload} /></div>;
  if (!detail.data) return null;

  const { collection } = detail.data;
  const entries = groupSeriesEntries(detail.data.entries);
  const artwork = entries.find((entry) => entry.film.backdropPath)?.film ??
    entries.find((entry) => entry.film.posterPath)?.film;
  const memberIds = new Set(entries.map((entry) => entry.id));
  const candidates = (library.data ?? []).filter((entry) => !memberIds.has(entry.id));
  const filtered = pickerSearch.trim()
    ? candidates.filter((entry) =>
        `${entry.film.title} ${entry.film.originalTitle ?? ''} ${entry.film.year ?? ''}`
          .toLowerCase()
          .includes(pickerSearch.trim().toLowerCase()),
      )
    : candidates;

  const add = async (entry: CollectionEntry) => {
    setBusyId(entry.id);
    try {
      await api.collections.addFilm(collection.id, entry.id);
      invalidate();
      toast.success(`已加入「${collection.name}」`);
    } catch (cause) {
      toast.error(describeError(cause));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (entry: CollectionEntry) => {
    setBusyId(entry.id);
    try {
      await api.collections.removeFilm(collection.id, entry.id);
      invalidate();
      toast.push(`已从专题中移除《${entry.film.title}》`);
    } catch (cause) {
      toast.error(describeError(cause));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <section className="collection-stage" aria-label="专题介绍">
        <HeroBackdrop src={imageUrl(artwork?.backdropPath)} posterSrc={imageUrl(artwork?.posterPath)} />
        <div className="film-stage-scrim" />
        <div className="collection-stage-inner">
          <button type="button" className="link-button collection-back" onClick={() => navigate('/collections')}>
            <Icon name="chevronLeft" size={13} /> 所有专题
          </button>
          <div className="eyebrow">私人选辑 · {entries.length} 部作品</div>
          <h1 className="collection-stage-title">{collection.name}</h1>
          {collection.description ? <p className="collection-stage-description">{collection.description}</p> : null}
          <button type="button" className="btn btn-secondary" onClick={() => setPickerOpen(true)}>
            <Icon name="plus" size={15} /> 添加作品
          </button>
        </div>
      </section>
      <div className="section-head collection-films-head">
        <h2 className="section-title">专题片目</h2>
        <span className="section-sub">{entries.length} 部作品</span>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          icon="layers"
          title="这个专题还是空的"
          text="从收藏库中挑选作品加入这个专题。一部作品可以同时属于多个专题。"
        >
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPickerOpen(true)}>
            <Icon name="plus" size={14} />
            添加作品
          </button>
        </EmptyState>
      ) : (
        <div className="poster-grid">
          {entries.map((entry) => (
            <div key={entry.id} className="collection-film">
              <PosterCard entry={entry} />
              <button
                type="button"
                className="btn btn-icon collection-remove"
                title="从专题中移除"
                aria-label={`从专题中移除 ${entry.film.title}`}
                disabled={busyId === entry.id}
                onClick={() => void remove(entry)}

              >
                <Icon name="close" size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={pickerOpen}
        wide
        title={`向「${collection.name}」添加作品`}
        subtitle="只显示尚未加入这个专题的收藏"
        onClose={() => setPickerOpen(false)}
        footer={
          <>
            <span className="spacer" />
            <button type="button" className="btn btn-secondary" onClick={() => setPickerOpen(false)}>
              完成
            </button>
          </>
        }
      >
        <div className="search-field" style={{ maxWidth: '100%', marginBottom: 14 }}>
          <input
            className="input"
            placeholder="筛选收藏库…"
            value={pickerSearch}
            onChange={(event) => setPickerSearch(event.target.value)}
            autoFocus
          />
        </div>

        {filtered.length === 0 ? (
          <p className="dim" style={{ fontSize: 13 }}>
            {candidates.length === 0
              ? '收藏库中的作品都已经在这个专题里了。'
              : '没有匹配的作品。'}
          </p>
        ) : (
          <div className="row-list" style={{ maxHeight: 420, overflowY: 'auto' }}>
            {filtered.map((entry) => (
              <div key={entry.id} className="row-card" style={{ gridTemplateColumns: '54px 1fr auto' }}>
                <Link to={`/film/${entry.film.id}`} className="row-poster">
                  {imageUrl(entry.film.posterPath) ? (
                    <img src={imageUrl(entry.film.posterPath) as string} alt="" loading="lazy" />
                  ) : null}
                </Link>
                <div className="row-main">
                  <div className="row-title">{entry.film.title}</div>
                  <div className="row-sub">
                    {[entry.film.year, statusLabel(entry.watchStatus)].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void add(entry)}
                  disabled={busyId === entry.id}
                >
                  {busyId === entry.id ? <span className="spinner" /> : <Icon name="plus" size={13} />}
                  加入
                </button>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}
