import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CollectionEntry } from '@shared/types';
import { api } from '../lib/api';
import { useAsyncData, useDebounced } from '../lib/useAsync';
import { imageUrl, formatRating, statusLabel } from '../lib/format';
import { Icon, type IconName } from './icons';
import { NAV_ITEMS } from './navigation';

interface ActionItem {
  kind: 'action';
  id: string;
  label: string;
  icon: IconName;
  run: () => void;
}

interface FilmItem {
  kind: 'film';
  id: string;
  entry: CollectionEntry;
  run: () => void;
}

type Item = ActionItem | FilmItem;

export function CommandPalette({
  open,
  onClose,
  onOpenImport,
}: {
  open: boolean;
  onClose: () => void;
  onOpenImport: () => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounced = useDebounced(query, 220);

  const results = useAsyncData<CollectionEntry[]>(
    async () => {
      const term = debounced.trim();
      if (!term) return [];
      return api.library.list({ search: term, sort: 'collected_desc' });
    },
    [debounced],
  );

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const actions = useMemo<ActionItem[]>(() => {
    const navigation = NAV_ITEMS.map((item) => ({
      kind: 'action' as const,
      id: `nav-${item.to}`,
      label: `前往${item.label}`,
      icon: item.icon,
      run: () => {
        navigate(item.to);
        onClose();
      },
    }));
    return [
      {
        kind: 'action',
        id: 'import',
        label: '添加影视作品…',
        icon: 'plus',
        run: () => {
          onClose();
          onOpenImport();
        },
      },
      ...navigation,
    ];
  }, [navigate, onClose, onOpenImport]);

  const items = useMemo<Item[]>(() => {
    const term = query.trim().toLowerCase();
    const matchedActions = term
      ? actions.filter((action) => action.label.toLowerCase().includes(term))
      : actions;
    const films: FilmItem[] = (results.data ?? []).slice(0, 20).map((entry) => ({
      kind: 'film',
      id: `film-${entry.id}`,
      entry,
      run: () => {
        navigate(`/film/${entry.film.id}`);
        onClose();
      },
    }));
    return [...films, ...matchedActions];
  }, [actions, query, results.data, navigate, onClose]);

  useEffect(() => {
    setActiveIndex((current) => (current >= items.length ? 0 : current));
  }, [items.length]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % Math.max(items.length, 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((current) => (current - 1 + items.length) % Math.max(items.length, 1));
        return;
      }
      if (event.key === 'Enter') {
        const item = items[activeIndex];
        if (item) {
          event.preventDefault();
          item.run();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, items, activeIndex, onClose]);

  if (!open) return null;

  const films = items.filter((item): item is FilmItem => item.kind === 'film');
  const actionItems = items.filter((item): item is ActionItem => item.kind === 'action');

  return (
    <div
      className="palette"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="palette-panel" role="dialog" aria-modal="true" aria-label="全局搜索">
        <div className="palette-input-row">
          <Icon name="search" size={17} />
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="搜索影视库，或跳转到页面…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="搜索"
          />
          {results.loading ? <span className="spinner" /> : null}
          <kbd className="kbd">Esc</kbd>
        </div>

        <div className="palette-results">
          {films.length > 0 ? <div className="palette-section">收藏</div> : null}
          {films.map((item, index) => {
            const poster = imageUrl(item.entry.film.posterPath);
            const globalIndex = index;
            return (
              <button
                key={item.id}
                type="button"
                className="palette-item"
                data-active={globalIndex === activeIndex}
                onMouseEnter={() => setActiveIndex(globalIndex)}
                onClick={item.run}
              >
                {poster ? (
                  <img className="palette-thumb" src={poster} alt="" />
                ) : (
                  <span className="palette-thumb" />
                )}
                <span className="palette-item-main">
                  <span className="palette-item-title">{item.entry.film.title}</span>
                  <span className="palette-item-sub">
                    {[
                      item.entry.film.year,
                      statusLabel(item.entry.watchStatus),
                      item.entry.personalRating != null
                        ? `${formatRating(item.entry.personalRating)} 分`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              </button>
            );
          })}

          {query.trim() && !results.loading && films.length === 0 ? (
            <div className="palette-empty">
              没有找到匹配的作品。
              {results.error ? <div style={{ marginTop: 6 }}>{results.error}</div> : null}
            </div>
          ) : null}

          {actionItems.length > 0 ? <div className="palette-section">操作</div> : null}
          {actionItems.map((item, index) => {
            const globalIndex = films.length + index;
            return (
              <button
                key={item.id}
                type="button"
                className="palette-item"
                data-active={globalIndex === activeIndex}
                onMouseEnter={() => setActiveIndex(globalIndex)}
                onClick={item.run}
              >
                <span className="palette-thumb" style={{ display: 'grid', placeItems: 'center' }}>
                  <Icon name={item.icon} size={16} />
                </span>
                <span className="palette-item-main">
                  <span className="palette-item-title">{item.label}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="palette-footer">
          <span>↑↓ 选择</span>
          <span>Enter 打开</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>
  );
}
