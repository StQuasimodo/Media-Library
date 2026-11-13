import { useEffect, type RefObject } from 'react';
import { prefersReducedMotion } from './motion';

/** One compositor update per frame; no React renders or image loads during scrolling. */
export function useCinematicScroll(ref: RefObject<HTMLElement | null>, identity: string | undefined) {
  useEffect(() => {
    const stage = ref.current;
    const scroll = stage?.closest<HTMLElement>('.page');
    if (!stage || !scroll) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const progress = Math.max(0, Math.min(1, scroll.scrollTop / Math.max(260, stage.offsetHeight * .64)));
      const reduce = prefersReducedMotion();
      stage.style.setProperty('--detail-focus', progress.toFixed(4));
      stage.style.setProperty('--detail-art-shift', `${reduce ? 0 : -24 * progress}px`);
      stage.style.setProperty('--detail-title-shift', `${reduce ? 0 : 42 * progress}px`);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    scroll.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    media.addEventListener('change', schedule);
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
    update();
    return () => {
      cancelAnimationFrame(frame);
      scroll.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      media.removeEventListener('change', schedule);
      observer.disconnect();
    };
  }, [identity, ref]);
}
