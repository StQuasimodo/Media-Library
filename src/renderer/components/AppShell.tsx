import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import { useAppState } from '../lib/appState';
import { useAsyncData } from '../lib/useAsync';
import { Icon } from './icons';
import { NAV_ITEMS } from './navigation';

export function AppShell({
  onOpenPalette,
  onOpenImport,
}: {
  onOpenPalette: () => void;
  onOpenImport: () => void;
}) {
  const { version } = useAppState();
  const location = useLocation();
  const stats = useAsyncData(() => api.library.stats(), [version]);

  const title = resolveTitle(location.pathname);

  // Window/taskbar title follows the current screen.
  useEffect(() => {
    document.title = title === 'My Cinema' ? 'My Cinema' : `${title} · My Cinema`;
  }, [title]);
  const counts: Record<string, number | undefined> = {
    '/library': stats.data?.totalFilms,
    '/watchlist': stats.data?.wantFilms,
    '/collections': stats.data?.collectionCount,
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="film" size={17} />
          </span>
          <span className="brand-text">
            <span className="brand-title">My Cinema</span>
            <span className="brand-subtitle">私人放映室</span>
          </span>
        </div>

        <nav className="nav-group" aria-label="主导航">
          <span className="nav-label">收藏</span>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className="nav-item"
              title={item.shortcut ? `${item.label}（${item.shortcut}）` : item.label}
            >
              <Icon name={item.icon} size={17} />
              <span>{item.label}</span>
              {counts[item.to] ? <span className="nav-count">{counts[item.to]}</span> : null}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button type="button" className="btn btn-secondary btn-sm btn-block" onClick={onOpenImport}>
            <Icon name="plus" size={15} />
            添加影视作品
          </button>
          <p className="sidebar-note">
            数据只保存在本机。影视资料来自 TMDB，夸克资源由你手动维护。
          </p>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <span className="topbar-title">{title}</span>
          <div className="topbar-actions">
            <button
              type="button"
              className="search-trigger"
              onClick={onOpenPalette}
              aria-label="打开全局搜索"
            >
              <Icon name="search" size={15} />
              <span>搜索收藏、专题…</span>
              <kbd className="kbd">Ctrl K</kbd>
            </button>
          </div>
        </header>
        <main className="page">
          {/* The home stage and the film stage run edge to edge of the content
              area; list pages stay on the readable measure. */}
          <div
            className="page-inner"
            data-wide={location.pathname === '/' || location.pathname.startsWith('/film/')}
          >
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function resolveTitle(pathname: string): string {
  if (pathname === '/') return '首页';
  if (pathname.startsWith('/library')) return '影视库';
  if (pathname.startsWith('/collections/')) return '专题';
  if (pathname.startsWith('/collections')) return '专题';
  if (pathname.startsWith('/watchlist')) return '想看';
  if (pathname.startsWith('/settings')) return '设置';
  if (pathname.startsWith('/film/')) return '影视详情';
  return 'My Cinema';
}
