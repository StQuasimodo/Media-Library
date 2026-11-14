import {UpdateNotice} from './UpdatePanel';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Icon } from './icons';
import { NAV_ITEMS } from './navigation';
import { prefersReducedMotion } from '../lib/motion';

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
  const cursorAnimation = useRef<Animation | null>(null);
  const cursorTarget = useRef<{ left: number; width: number } | null>(null);
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
      frame = 0;
      if (!live) return;
      const active = nav.querySelector<HTMLElement>('[aria-current="page"], [data-context="true"]');
      if (!active) {
        cursor.style.opacity = '0';
        cursorAnimation.current?.cancel();
        cursorTarget.current = null;
        return;
      }
      const target = { left: active.offsetLeft - 12, width: active.offsetWidth + 24 };
      const reduce = prefersReducedMotion();
      if (reduce) cursorAnimation.current?.cancel();
      // ResizeObserver and font readiness can report the same target. Do not
      // restart an in-flight transition, especially during rapid navigation.
      if (cursorTarget.current?.left === target.left && cursorTarget.current.width === target.width) return;
      const previous = cursor.getBoundingClientRect();
      const previousLeft = previous.left - nav.getBoundingClientRect().left;
      const animate = cursor.dataset.ready === 'true' && previous.width > 0 && !reduce;
      cursorAnimation.current?.cancel();
      cursorTarget.current = target;
      // Set the final width once. FLIP carries the visual size change on the
      // compositor instead of requesting layout on every animation frame.
      cursor.style.width = `${target.width}px`;
      cursor.style.transform = `translate3d(${target.left}px, -50%, 0)`;
      cursor.style.opacity = '1';
      cursor.dataset.ready = 'true';
      if (animate) {
        cursorAnimation.current = cursor.animate([
          { transform: `translate3d(${previousLeft}px, -50%, 0) scaleX(${previous.width / target.width})` },
          { transform: `translate3d(${target.left}px, -50%, 0) scaleX(1)` },
        ], { duration: 360, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' });
      }
    };
    const schedule = () => { if (live && !frame) frame = requestAnimationFrame(place); };
    const observer = new ResizeObserver(schedule);
    observer.observe(nav);
    for (const item of nav.children) if (item !== cursor) observer.observe(item);
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    media.addEventListener('change', schedule);
    const preference = new MutationObserver(schedule);
    preference.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
    void document.fonts.ready.then(schedule);
    place();
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      preference.disconnect();
      media.removeEventListener('change', schedule);
    };
  }, [location.pathname]);

  useEffect(() => () => cursorAnimation.current?.cancel(), []);

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
