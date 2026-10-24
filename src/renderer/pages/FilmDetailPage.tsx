import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { MediaResource, WatchStatus } from '@shared/types';
import { api, describeError } from '../lib/api';
import { useAppState } from '../lib/appState';
import { useToast } from '../lib/toast';
import { useAsyncData } from '../lib/useAsync';
import { ErrorState, LoadingRow, Segmented } from '../components/primitives';
import { HeroBackdrop } from '../components/HeroBackdrop';
import { PosterImage } from '../components/PosterImage';
import { Icon } from '../components/icons';
import {
  AVAILABILITY_LABEL,
  WATCH_STATUS_LABEL,
  WATCH_STATUS_OPTIONS,
  formatDate,
  formatDateTime,
  formatRating,
  formatRuntime,
  imageUrl,
  statusLabel,
} from '../lib/format';
import { prefersReducedMotion } from '../lib/motion';
import {
  ConfirmRemoveFilmDialog,
  EditEntryDialog,
  EditFilmDialog,
  ManageCollectionsDialog,
  ResourceDeleteDialog,
  ResourceDialog,
} from '../components/FilmDialogs';

export function FilmDetailPage() {
  const { filmId } = useParams<{ filmId: string }>();
  const [searchParams] = useSearchParams();
  const { version, invalidate } = useAppState();
  const toast = useToast();
  const navigate = useNavigate();

  const detail = useAsyncData(() => api.library.detail(filmId as string), [filmId, version]);
  const allCollections = useAsyncData(() => api.collections.list(), [version]);

  const [editFilmOpen, setEditFilmOpen] = useState(false);
  const [editEntryOpen, setEditEntryOpen] = useState(false);
  const [resourceOpen, setResourceOpen] = useState(false);
  const [editingResource, setEditingResource] = useState<MediaResource | null>(null);
  const [deletingResource, setDeletingResource] = useState<MediaResource | null>(null);
  const [removeFilmOpen, setRemoveFilmOpen] = useState(false);
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const resourcesRef = useRef<HTMLElement | null>(null);

  // Deep link from the home stage's "管理资源" action.
  useEffect(() => {
    if (searchParams.get('panel') !== 'resources') return;
    const node = resourcesRef.current;
    if (!node) return;
    node.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start',
    });
  }, [searchParams, detail.data]);

  if (!filmId) return null;
  if (detail.loading && !detail.data) return <div className="cinema-status"><LoadingRow label="正在读取影视资料…" /></div>;
  if (detail.error) return <div className="cinema-status"><ErrorState message={detail.error} onRetry={detail.reload} /></div>;
  if (!detail.data) return null;

  const { film, entry, resources } = detail.data;
  const backdrop = imageUrl(film.backdropPath);
  const poster = imageUrl(film.posterPath);

  const setStatus = async (status: WatchStatus) => {
    try {
      await api.library.updateEntry(entry.id, { watchStatus: status });
      invalidate();
      toast.push(`观看状态已改为「${WATCH_STATUS_LABEL[status]}」`);
    } catch (cause) {
      toast.error(describeError(cause));
    }
  };

  const refreshMetadata = async () => {
    setRefreshing(true);
    try {
      await api.metadata.refresh(film.id);
      invalidate();
      toast.success('已从 TMDB 刷新影视资料，个人数据未改动');
    } catch (cause) {
      toast.error(describeError(cause));
    } finally {
      setRefreshing(false);
    }
  };

  const copyText = async (text: string, label: string) => {
    try {
      await api.resources.copy(text);
      toast.success(`${label}已复制到剪贴板`);
    } catch (cause) {
      toast.error(describeError(cause));
    }
  };

  const openLink = async (url: string) => {
    try {
      await api.resources.open(url);
    } catch (cause) {
      toast.error(describeError(cause));
    }
  };

  const removeFilm = async () => {
    setBusy(true);
    try {
      const result = await api.library.removeFilm(film.id);
      invalidate();
      toast.push(
        result.removedResources > 0
          ? `已移除《${film.title}》及 ${result.removedResources} 条资源记录`
          : `已移除《${film.title}》`,
      );
      navigate('/library');
    } catch (cause) {
      toast.error(describeError(cause));
    } finally {
      setBusy(false);
      setRemoveFilmOpen(false);
    }
  };

  const deleteResource = async () => {
    if (!deletingResource) return;
    setBusy(true);
    try {
      await api.resources.remove(deletingResource.id);
      invalidate();
      toast.push('资源记录已删除');
      setDeletingResource(null);
    } catch (cause) {
      toast.error(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="film-detail">
      <section className={`film-stage${backdrop || poster ? '' : ' no-art'}`}>
        <HeroBackdrop src={backdrop} posterSrc={poster} />
        <div className="film-stage-scrim" />
        <Link to="/library" className="stage-back"><Icon name="chevronLeft" size={13} /> 返回影视库</Link>

        <div className="film-stage-inner">
          <div className="film-poster">
            <PosterImage film={film} alt={`${film.title} 海报`} loading="eager" />
          </div>

          <div className="film-copy">
            <div className="film-eyebrow">
              <Icon name="film" size={12} />
              {film.mediaType === 'tv' ? '剧集' : '电影'}
              <span className="hero-eyebrow-sep" />
              {statusLabel(entry.watchStatus)}
            </div>

            <h1 className="film-title">{film.title}</h1>
            {film.originalTitle && film.originalTitle !== film.title ? (
              <div className="film-original">{film.originalTitle}</div>
            ) : null}

            <div className="film-meta">
              {film.year ? <span>{film.year}</span> : null}
              {film.runtime ? <span className="meta-sep">{formatRuntime(film.runtime)}</span> : null}
              {film.genres.length > 0 ? (
                <span className="meta-sep">{film.genres.slice(0, 3).join(' / ')}</span>
              ) : null}
              {entry.personalRating != null ? (
                <span className="meta-sep hero-rating">
                  <Icon name="star" size={12} />
                  {formatRating(entry.personalRating)}
                  <span className="hero-rating-max">/10</span>
                </span>
              ) : null}
            </div>

            {entry.favoriteReason ? <blockquote className="film-dedication"><span className="visually-hidden">收藏理由：</span>{entry.favoriteReason}</blockquote> : null}
            <div className="film-actions">
              <button type="button" className="btn cinema-primary" onClick={() => resourcesRef.current?.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'instant' : 'smooth' })}>
                查看资源 <Icon name="chevronRight" size={14} />
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setEditEntryOpen(true)}
              >
                <Icon name="star" size={15} />
                编辑记录
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setCollectionsOpen(true)}
              >
                <Icon name="layers" size={15} />
                加入专题
              </button>

              <details className="film-tools" onKeyDown={(event) => {
                if (event.key === 'Escape') { event.preventDefault(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); }
              }}>
                <summary>更多操作 <Icon name="chevronRight" size={12} /></summary>
                <div className="film-tools-menu">
                  {film.metadataSource === 'tmdb' ? (
                    <button
                      type="button"
                      className="btn btn-icon"
                      title="从 TMDB 刷新资料"
                      aria-label="从 TMDB 刷新资料"
                      onClick={refreshMetadata}
                      disabled={refreshing}
                    >
                      {refreshing ? <span className="spinner" /> : <Icon name="refresh" size={16} />} 刷新资料
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-icon"
                    title="编辑影视资料"
                    aria-label="编辑影视资料"
                    onClick={() => setEditFilmOpen(true)}
                  >
                    <Icon name="edit" size={16} /> 编辑资料
                  </button>
                  <button
                    type="button"
                    className="btn btn-icon"
                    title="从收藏库移除"
                    aria-label="从收藏库移除"
                    onClick={() => setRemoveFilmOpen(true)}
                    style={{ color: 'rgba(226, 119, 111, 0.9)' }}
                  >
                    <Icon name="trash" size={16} /> 移除收藏
                  </button>
                </div>
              </details>
            </div>
          </div>
        </div>
      </section>

      <div className="film-body">
        <div>
          <section className="film-section personal-section">
            <div className="film-section-head">
              <Icon name="star" size={12} />
              我的记录
              <span className="spacer" />
              <button type="button" className="link-button" onClick={() => setEditEntryOpen(true)}>
                编辑
              </button>
            </div>
            <div className="film-record">
              <div>
                <div className="record-block-title">收藏理由</div>
                {entry.favoriteReason ? (
                  <p className="prose record-reason">{entry.favoriteReason}</p>
                ) : (
                  <p className="prose is-empty">还没有写下收藏理由。</p>
                )}
              </div>
              <div>
                <div className="record-block-title">个人短评</div>
                {entry.personalReview ? (
                  <p className="quote-block" style={{ borderColor: 'rgba(255,255,255,.14)' }}>
                    {entry.personalReview}
                  </p>
                ) : (
                  <p className="prose is-empty">还没有写下短评。</p>
                )}
              </div>
            </div>
          </section>

          <section className="film-section">
            <div className="film-section-head">
              <Icon name="film" size={12} />
              简介
            </div>
            {film.overview ? (
              <p className="prose">{film.overview}</p>
            ) : (
              <p className="prose is-empty">TMDB 没有提供简介，你可以在「编辑影视资料」中补充。</p>
            )}
            {film.tagline ? <p className="quote-block">{film.tagline}</p> : null}
          </section>

          <section className="film-section" ref={resourcesRef} id="resources">
            <div className="film-section-head">
              <Icon name="database" size={12} />
              夸克网盘资源
              <span className="spacer" />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setEditingResource(null);
                  setResourceOpen(true);
                }}
              >
                <Icon name="plus" size={13} />
                添加资源
              </button>
            </div>

            {resources.length === 0 ? (
              <p className="prose is-empty">
                还没有关联的分享资源。这里可以记录分享链接、提取码和画质备注；读取云端文件夹请到「设置 → 夸克文件夹」。
              </p>
            ) : (
              resources.map((resource) => (
                <div className="resource-row" key={resource.id}>
                  <div className="resource-head">
                    <span className="resource-name">{resource.resourceName}</span>
                    <span className="spacer" />
                    <span className="resource-actions">
                      <button
                        type="button"
                        className="btn btn-icon"
                        title="复制分享链接"
                        aria-label="复制分享链接"
                        onClick={() => void copyText(resource.shareUrl, '分享链接')}
                      >
                        <Icon name="copy" size={14} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-icon"
                        title="在浏览器中打开"
                        aria-label="在浏览器中打开"
                        onClick={() => void openLink(resource.shareUrl)}
                      >
                        <Icon name="external" size={14} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-icon"
                        title="编辑资源"
                        aria-label="编辑资源"
                        onClick={() => {
                          setEditingResource(resource);
                          setResourceOpen(true);
                        }}
                      >
                        <Icon name="edit" size={14} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-icon"
                        title="删除资源"
                        aria-label="删除资源"
                        onClick={() => setDeletingResource(resource)}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </span>
                  </div>

                  <div className="row wrap gap-2">
                    <span className="chip">{AVAILABILITY_LABEL[resource.availabilityStatus]}</span>
                    {resource.qualityLabel ? (
                      <span className="tag">{resource.qualityLabel}</span>
                    ) : null}
                    {resource.versionLabel ? (
                      <span className="tag">{resource.versionLabel}</span>
                    ) : null}
                    {resource.subtitleLabel ? (
                      <span className="tag">{resource.subtitleLabel}</span>
                    ) : null}
                    {resource.audioLabel ? <span className="tag">{resource.audioLabel}</span> : null}
                    {resource.accessCode ? (
                      <button
                        type="button"
                        className="code-chip"
                        title="复制提取码"
                        onClick={() => void copyText(resource.accessCode as string, '提取码')}
                      >
                        <Icon name="key" size={12} />
                        {resource.accessCode}
                      </button>
                    ) : null}
                  </div>

                  <div className="resource-url">{resource.shareUrl}</div>
                  {resource.notes ? <div className="resource-note">{resource.notes}</div> : null}
                </div>
              ))
            )}
          </section>
        </div>

        <aside className="film-aside">
          <div className="fact-block">
            <div className="fact-title">
              <Icon name="star" size={12} />
              个人评分
            </div>
            {entry.personalRating != null ? (
              <div className="rating-display">
                <span className="rating-big">{formatRating(entry.personalRating)}</span>
                <span className="rating-max">/ 10</span>
              </div>
            ) : (
              <p className="prose is-empty">尚未评分。</p>
            )}
          </div>

          <div className="fact-block">
            <div className="fact-title">
              <Icon name="clock" size={12} />
              观看状态
            </div>
            <Segmented
              ariaLabel="快速修改观看状态"
              value={entry.watchStatus}
              onChange={(value) => void setStatus(value)}
              options={WATCH_STATUS_OPTIONS}
            />
            <dl className="kv" style={{ marginTop: 16 }}>
              <dt>收藏于</dt>
              <dd>{formatDate(entry.collectedAt)}</dd>
              <dt>观看于</dt>
              <dd>{entry.watchedAt ? formatDate(entry.watchedAt) : '—'}</dd>
            </dl>
          </div>

          <div className="fact-block">
            <div className="fact-title">
              <Icon name="layers" size={12} />
              所属专题
              <span className="spacer" />
              <button
                type="button"
                className="link-button"
                onClick={() => setCollectionsOpen(true)}
              >
                管理
              </button>
            </div>
            {detail.data.collections.length === 0 ? (
              <p className="prose is-empty">还没有加入任何专题。</p>
            ) : (
              <div className="tag-row">
                {detail.data.collections.map((collection) => (
                  <Link key={collection.id} to={`/collections/${collection.id}`} className="tag">
                    {collection.name}
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="fact-block">
            <div className="fact-title">
              <Icon name="info" size={12} />
              资料信息
            </div>
            <dl className="kv">
              <dt>来源</dt>
              <dd>{film.metadataSource === 'tmdb' ? 'TMDB' : '手动录入'}</dd>
              <dt>TMDB ID</dt>
              <dd>{film.externalId ?? '—'}</dd>
              <dt>原始语言</dt>
              <dd>{film.originalLanguage ?? '—'}</dd>
              <dt>资料更新</dt>
              <dd>{formatDateTime(film.metadataUpdatedAt)}</dd>
              <dt>本地收录</dt>
              <dd>{formatDateTime(film.createdAt)}</dd>
            </dl>
          </div>
        </aside>
      </div>

      <EditFilmDialog
        open={editFilmOpen}
        film={film}
        onClose={() => setEditFilmOpen(false)}
        onSaved={invalidate}
      />
      <EditEntryDialog
        open={editEntryOpen}
        entry={entry}
        onClose={() => setEditEntryOpen(false)}
        onSaved={invalidate}
      />
      <ResourceDialog
        open={resourceOpen}
        filmId={film.id}
        resource={editingResource}
        onClose={() => setResourceOpen(false)}
        onSaved={invalidate}
      />
      <ManageCollectionsDialog
        open={collectionsOpen}
        entryId={entry.id}
        collections={allCollections.data ?? []}
        memberIds={detail.data.collections.map((collection) => collection.id)}
        onClose={() => setCollectionsOpen(false)}
        onChanged={invalidate}
      />
      <ConfirmRemoveFilmDialog
        open={removeFilmOpen}
        title={film.title}
        resourceCount={resources.length}
        busy={busy}
        onConfirm={() => void removeFilm()}
        onCancel={() => setRemoveFilmOpen(false)}
      />
      <ResourceDeleteDialog
        open={deletingResource !== null}
        name={deletingResource?.resourceName ?? ''}
        busy={busy}
        onConfirm={() => void deleteResource()}
        onCancel={() => setDeletingResource(null)}
      />
    </div>
  );
}
