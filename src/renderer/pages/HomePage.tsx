import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CollectionEntry } from '@shared/types';
import { api } from '../lib/api';
import { useAppState } from '../lib/appState';
import { useAsyncData } from '../lib/useAsync';
import { CollectionCard } from '../components/CollectionCard';
import { FocusRail } from '../components/FocusRail';
import { HeroBackdrop } from '../components/HeroBackdrop';
import { Track } from '../components/Track';
import { ErrorState, SkeletonGrid } from '../components/primitives';
import { Icon } from '../components/icons';
import { formatRating, formatRuntime, imageUrl, statusLabel } from '../lib/format';

export function HomePage({ onOpenImport }: { onOpenImport: () => void }) {
  const { version } = useAppState();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useAsyncData(() => api.library.home(), [version]);
  const [activeIndex, setActiveIndex] = useState(0);

  const railEntries = data?.recent ?? [];

  useEffect(() => {
    if (activeIndex > railEntries.length - 1) setActiveIndex(0);
  }, [railEntries.length, activeIndex]);

  const focused: CollectionEntry | null = railEntries[activeIndex] ?? data?.featured ?? null;

  // Warm the neighbouring backdrops so moving along the rail stays instant.
  useEffect(() => {
    for (const offset of [1, -1]) {
      const entry = railEntries[activeIndex + offset];
      const url = imageUrl(entry?.film.backdropPath);
      if (url) {
        const image = new Image();
        image.src = url;
      }
    }
  }, [activeIndex, railEntries]);

  if (loading && !data) {
    return (
      <div className="stack gap-6" style={{ paddingTop: 8 }}>
        <div className="skeleton" style={{ height: 460, borderRadius: 18 }} />
        <SkeletonGrid count={6} />
      </div>
    );
  }

  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const { stats, collections } = data;
  const isEmpty = stats.totalFilms === 0;
  const openEntry = (entry: CollectionEntry) => navigate(`/film/${entry.film.id}`);
  const wantEntries = data.wantEntries;
  const hasArtwork = Boolean(
    focused && (focused.film.backdropPath || focused.film.posterPath),
  );

  return (
    <div className="home">
      <section
        className={`hero-stage${isEmpty ? ' is-empty' : ''}${focused && !hasArtwork ? ' no-art' : ''}`}
        aria-label="精选影视"
      >
        {focused ? (
          <HeroBackdrop
            src={imageUrl(focused.film.backdropPath)}
            posterSrc={imageUrl(focused.film.posterPath)}
          />
        ) : (
          <div className="hero-layers">
            <div className="hero-layer" data-empty="true" />
          </div>
        )}
        <div className="hero-stage-scrim" />

        <div className="hero-stage-inner">
          {focused ? (
            <div className="hero-copy" key={focused.id}>
              <div className="hero-eyebrow">
                <Icon name="star" size={12} />
                {activeIndex === 0 ? '最近加入的收藏' : '收藏精选'}
                <span className="hero-eyebrow-sep" />
                {statusLabel(focused.watchStatus)}
              </div>

              <h1 className="hero-title">{focused.film.title}</h1>
              {focused.film.originalTitle && focused.film.originalTitle !== focused.film.title ? (
                <div className="hero-original">{focused.film.originalTitle}</div>
              ) : null}

              <div className="hero-meta">
                {focused.film.year ? <span>{focused.film.year}</span> : null}
                <span>{focused.film.mediaType === 'tv' ? '剧集' : '电影'}</span>
                {focused.film.runtime ? (
                  <span className="meta-sep">{formatRuntime(focused.film.runtime)}</span>
                ) : null}
                {focused.film.genres.length > 0 ? (
                  <span className="meta-sep">{focused.film.genres.slice(0, 3).join(' / ')}</span>
                ) : null}
                {focused.personalRating != null ? (
                  <span className="meta-sep hero-rating">
                    <Icon name="star" size={12} />
                    {formatRating(focused.personalRating)}
                    <span className="hero-rating-max">/10</span>
                  </span>
                ) : null}
              </div>

              {focused.film.overview ? (
                <p className="hero-overview">{focused.film.overview}</p>
              ) : focused.favoriteReason ? (
                <p className="hero-overview">「{focused.favoriteReason}」</p>
              ) : null}

              <div className="hero-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => openEntry(focused)}
                >
                  <Icon name="film" size={15} />
                  查看详情
                </button>
                <button
                  type="button"
                  className="link-button hero-resource-link"
                  onClick={() => navigate(`/film/${focused.film.id}?panel=resources`)}
                >
                  <Icon name="database" size={15} />
                  夸克资源
                </button>
              </div>


            </div>
          ) : (
            <div className="hero-copy hero-copy-empty">
              <div className="hero-eyebrow">
                <Icon name="film" size={12} />
                私人放映室
              </div>
              <h1 className="hero-empty-title serif">为你的电影，留一个安静的位置。</h1>
              <p className="hero-overview">
                My Cinema 只保存在这台电脑上。从 TMDB 导入第一部作品开始：资料、海报和背景图会缓存到本地，
                也可以在设置中连接夸克文件夹，读取云端资源清单。
              </p>
              <div className="hero-actions">
                <button type="button" className="btn btn-primary" onClick={onOpenImport}>
                  <Icon name="plus" size={15} />
                  添加第一部作品
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => navigate('/settings#metadata')}
                >
                  <Icon name="key" size={15} />
                  配置 TMDB Key
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {railEntries.length > 0 ? (
        <div className="focus-rail-wrap">
          <FocusRail
            entries={railEntries}
            activeIndex={activeIndex}
            onActivate={setActiveIndex}
            onOpen={openEntry}
          />
          <div className="focus-rail-footer">
            <span>最近收藏 · 共 {stats.totalFilms} 部</span>
            <button type="button" className="link-button" onClick={() => navigate('/library')}>
              全部收藏 <Icon name="chevronRight" size={13} />
            </button>
          </div>
        </div>
      ) : null}

      {isEmpty ? (
        <div className="home-empty">
          <p className="home-empty-lead">
            收藏库还是空的。添加作品后，这里会出现最近收藏、专题和想看清单；
            所有内容都来自你自己的收藏，不含任何演示数据。
          </p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenImport}>
            <Icon name="plus" size={14} />
            添加作品
          </button>
        </div>
      ) : (
        <>
          <Track
            title="专题"
            meta={collections.length > 0 ? `${collections.length} 个` : undefined}
            action={
              <button type="button" className="link-button" onClick={() => navigate('/collections')}>
                管理专题
              </button>
            }
          >
            {collections.length > 0 ? (
              collections.map((collection) => (
                <div className="track-item is-collection" key={collection.id}>
                  <CollectionCard collection={collection} />
                </div>
              ))
            ) : (
              <div className="track-empty">
                <span className="dim">还没有专题。</span>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => navigate('/collections')}
                >
                  创建第一个专题
                </button>
              </div>
            )}
          </Track>

          {wantEntries.length > 0 ? (
            <Track
              title="想看"
              meta={`${data.wantCount} 部待看`}
              tone="queue"
              action={
                <button
                  type="button"
                  className="link-button"
                  onClick={() => navigate('/watchlist')}
                >
                  打开清单
                </button>
              }
            >
              <ol className="queue">
                {wantEntries.map((entry, index) => (
                  <li key={entry.id} className="queue-item">
                    <button
                      type="button"
                      className="queue-link"
                      onClick={() => navigate(`/film/${entry.film.id}`)}
                    >
                      <span className="queue-index">{String(index + 1).padStart(2, '0')}</span>
                      <span className="queue-thumb">
                        {imageUrl(entry.film.posterPath) ? (
                          <img
                            src={imageUrl(entry.film.posterPath) as string}
                            alt=""
                            loading="lazy"
                          />
                        ) : null}
                      </span>
                      <span className="queue-main">
                        <span className="queue-title">{entry.film.title}</span>
                        <span className="queue-sub">
                          {[entry.film.year, entry.film.mediaType === 'tv' ? '剧集' : '电影']
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                      <Icon name="chevronRight" size={14} />
                    </button>
                  </li>
                ))}
              </ol>
            </Track>
          ) : null}
        </>
      )}
    </div>
  );
}
