import {UpdateNotice} from './UpdatePanel';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Icon } from './icons';
import { NAV_ITEMS } from './navigation';

export function AppShell({
  onOpenPalette,
  onOpenImport,
}: {
  onOpenPalette: () => void;
  onOpenImport: () => void;
}) {
  const location = useLocation();
  const navRef = useRef<HTMLElement | null>(null);
  const cursorRef = useRef<HTMLSpanElement | null>(null);
  const pageRef = useRef<HTMLElement | null>(null);
  const [pageScrolled, setPageScrolled] = useState(false);
  const title = resolveTitle(location.pathname);
  const homeMode = location.pathname === '/';
  const filmMode = location.pathname.startsWith('/film/');
  const immersive = homeMode || filmMode || location.pathname.startsWith('/collections/');

  // Reset before child effects handle query-only section links.
  useLayoutEffect(() => {
    pageRef.current?.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    setPageScrolled(false);
  }, [location.pathname]);

  useLayoutEffect(() => {
    const nav = navRef.current, cursor = cursorRef.current;
    if (!nav || !cursor) return;
    let live = true, frame = 0;
    const place = () => {
      if (!live) return;
      const active = nav.querySelector<HTMLElement>('[aria-current="page"], [data-context="true"]');
      cursor.style.opacity = active ? '1' : '0';
      if (active) {
        cursor.style.width = `${active.offsetWidth + 24}px`;
        cursor.style.transform = `translate3d(${active.offsetLeft - 12}px, -50%, 0)`;
      }
      frame = requestAnimationFrame(() => cursor.dataset.ready = 'true');
    };
    const observer = new ResizeObserver(place);
    observer.observe(nav);
    for (const item of nav.children) if (item !== cursor) observer.observe(item);
    void document.fonts.ready.then(place);
    place();
    return () => { live = false; cancelAnimationFrame(frame); observer.disconnect(); };
  }, [location.pathname]);

  useEffect(() => { document.title = `${title} · My Cinema`; }, [title]);

  return (
    <div className="app-shell" data-immersive={immersive} data-home={homeMode} data-scrolled={pageScrolled}>
      <div className="main">
        <header className="topbar">
          <NavLink to="/" className="cinema-brand" aria-label="My Cinema 首页">
            <span>My Cinema</span><span className="cinema-brand-sub">私人电影收藏</span>
          </NavLink>
          <nav ref={navRef} className="cinema-nav" aria-label="主导航">
            <span ref={cursorRef} className="cinema-nav-cursor" aria-hidden="true" />
            {NAV_ITEMS.filter((item) => item.to !== '/settings').map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className="cinema-nav-link"
                data-context={filmMode && item.to === '/library'}
                title={item.shortcut ? `${item.label}（${item.shortcut}）` : item.label}>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="topbar-actions"><UpdateNotice/>
            <button type="button" className="cinema-icon-button" onClick={onOpenPalette} aria-label="打开全局搜索" title="全局搜索（Ctrl+K）"><Icon name="search" size={15} /></button>
            <button type="button" className="cinema-icon-button" onClick={onOpenImport} aria-label="添加影视作品" title="添加影视作品"><Icon name="plus" size={18} /></button>
            <NavLink to="/settings" className="cinema-icon-button" aria-label="设置" title="设置"><Icon name="settings" size={18} /></NavLink>
          </div>
        </header>
        <main className="page" ref={pageRef} onScroll={(event) => setPageScrolled(event.currentTarget.scrollTop > 64)}>
          <div key={location.pathname} className="page-inner" data-wide={immersive}><Outlet /></div>
        </main>
      </div>
    </div>
  );
}

function resolveTitle(pathname: string): string {
  if (pathname === '/') return '首页';
  if (pathname.startsWith('/library')) return '影视库';
  if (pathname.startsWith('/collections')) return '专题';
  if (pathname.startsWith('/watchlist')) return '想看';
  if (pathname.startsWith('/settings')) return '设置';
  if (pathname.startsWith('/film/')) return '影视详情';
  return 'My Cinema';
}
