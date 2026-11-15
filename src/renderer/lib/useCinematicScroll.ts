import { useEffect, type RefObject } from 'react';
import { prefersReducedMotion } from './motion';

/** One compositor update per frame; no React renders or image loads during scrolling. */
export function useCinematicScroll(ref: RefObject<HTMLElement | null>, identity: string | undefined) {
  useEffect(() => {
    const stage = ref.current;
    const scroll = stage?.closest<HTMLElement>('.page');
    if (!stage || !scroll) return;
    const artwork = stage.querySelector<HTMLElement>('.hero-layers');
    const scrim = stage.querySelector<HTMLElement>('.film-stage-scrim');
    const copy = stage.querySelector<HTMLElement>('.film-copy');
    let frame = 0;
    let travel = Math.max(260, stage.offsetHeight * .64);
    const update = () => {
      frame = 0;
      const progress = Math.max(0, Math.min(1, scroll.scrollTop / travel));
      const reduce = prefersReducedMotion();
      // Scope inherited properties to the moving layers. Updating the stage
      // invalidates every record, resource and action below the hero as well.
      artwork?.style.setProperty('--detail-focus', progress.toFixed(4));
      artwork?.style.setProperty('--detail-art-shift', `${reduce ? 0 : -24 * progress}px`);
      scrim?.style.setProperty('--detail-focus', progress.toFixed(4));
      copy?.style.setProperty('--detail-title-shift', `${reduce ? 0 : 42 * progress}px`);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const sizeObserver = new ResizeObserver(() => {
      travel = Math.max(260, stage.offsetHeight * .64);
      schedule();
    });
    sizeObserver.observe(stage);
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
      sizeObserver.disconnect();
    };
  }, [identity, ref]);
}
