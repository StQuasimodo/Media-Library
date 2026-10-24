import { useEffect, useRef } from 'react';
import type { CollectionEntry } from '@shared/types';
import { Icon } from './icons';
import { formatRating, imageUrl, statusLabel } from '../lib/format';
import { prefersReducedMotion } from '../lib/motion';

/**
 * PS5-style focus rail: the film under the cursor/focus defines the hero above
 * it. Focus is roving (`tabIndex` 0 on the active tile only) and arrow keys move
 * between tiles, so the rail is fully usable without a mouse.
 */
export function FocusRail({
  entries,
  activeIndex,
  onActivate,
  onOpen,
}: {
  entries: CollectionEntry[];
  activeIndex: number;
  onActivate: (index: number) => void;
  onOpen: (entry: CollectionEntry) => void;
}) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const node = itemRefs.current[activeIndex];
    if (!node) return;
    node.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      inline: 'center',
      block: 'nearest',
    });
  }, [activeIndex]);

  const move = (index: number, delta: number) => {
    const next = Math.max(0, Math.min(entries.length - 1, index + delta));
    if (next === index) return;
    onActivate(next);
    itemRefs.current[next]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        move(index, 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        move(index, -1);
        break;
      case 'Home':
        event.preventDefault();
        onActivate(0);
        itemRefs.current[0]?.focus();
        break;
      case 'End':
        event.preventDefault();
        onActivate(entries.length - 1);
        itemRefs.current[entries.length - 1]?.focus();
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        onOpen(entries[index]);
        break;
      default:
        break;
    }
  };

  return (
    <div className="focus-rail" role="group" aria-label="精选影视，使用左右方向键切换">
      {entries.map((entry, index) => {
        const poster = imageUrl(entry.film.posterPath);
        const active = index === activeIndex;
        return (
          <button
            key={entry.id}
            type="button"
            aria-current={active ? 'true' : undefined}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            className="rail-item"
            data-active={active}
            tabIndex={active ? 0 : -1}
            onMouseEnter={() => onActivate(index)}
            onFocus={() => onActivate(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
            onClick={() => onOpen(entry)}
          >
            <span className="rail-art">
              {poster ? (
                <img src={poster} alt="" loading={index < 6 ? 'eager' : 'lazy'} />
              ) : (
                <span className="poster-fallback">
                  <span className="poster-fallback-year">{entry.film.year ?? '—'}</span>
                  <span className="poster-fallback-title serif">{entry.film.title}</span>
                </span>
              )}
              <span className={`rail-status status-${entry.watchStatus}`}>
                <span className="chip-dot" />
                {statusLabel(entry.watchStatus)}
              </span>
            </span>
            <span className="rail-caption">
              <span className="rail-title">{entry.film.title}</span>
              <span className="rail-meta">
                {entry.film.year ?? '—'}
                {entry.personalRating != null ? (
                  <>
                    <span className="dot" />
                    <Icon name="star" size={11} />
                    {formatRating(entry.personalRating)}
                  </>
                ) : null}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
