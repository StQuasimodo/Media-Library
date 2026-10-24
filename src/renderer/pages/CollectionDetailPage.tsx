import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { CollectionEntry } from '@shared/types';
import { api, describeError } from '../lib/api';
import { useAppState } from '../lib/appState';
import { useToast } from '../lib/toast';
import { useAsyncData } from '../lib/useAsync';
import { EmptyState, ErrorState, LoadingRow, Modal, PosterCard } from '../components/primitives';
import { Icon } from '../components/icons';
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

  if (!collectionId) return null;
  if (detail.loading && !detail.data) return <LoadingRow label="正在读取专题…" />;
  if (detail.error) return <ErrorState message={detail.error} onRetry={detail.reload} />;
  if (!detail.data) return null;

  const { collection, entries } = detail.data;
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
      <div className="row gap-2" style={{ marginBottom: 12 }}>
        <button type="button" className="link-button" onClick={() => navigate('/collections')}>
          ← 所有专题
        </button>
      </div>

      <div className="section-head" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <h1 className="section-title" style={{ fontSize: 26 }}>
            {collection.name}
          </h1>
          <p className="section-sub" style={{ marginTop: 6, maxWidth: 720 }}>
            {collection.description || '尚未填写专题描述'}
          </p>
          <div className="eyebrow" style={{ marginTop: 10 }}>
            {entries.length} 部作品
          </div>
        </div>
        <span className="spacer" />
        <button type="button" className="btn btn-primary" onClick={() => setPickerOpen(true)}>
          <Icon name="plus" size={15} />
          添加作品
        </button>
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
            <div key={entry.id} style={{ position: 'relative' }}>
              <PosterCard entry={entry} />
              <button
                type="button"
                className="btn btn-icon"
                title="从专题中移除"
                aria-label={`从专题中移除 ${entry.film.title}`}
                disabled={busyId === entry.id}
                onClick={() => void remove(entry)}
                style={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  width: 26,
                  height: 26,
                  background: 'rgba(10,13,18,0.8)',
                  border: '1px solid rgba(255,255,255,0.12)',
                }}
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
