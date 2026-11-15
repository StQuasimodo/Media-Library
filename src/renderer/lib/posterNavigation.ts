import type { KeyboardEvent } from 'react';
import { prefersReducedMotion } from './motion';
/** Directional browsing complements normal Tab navigation; modifiers remain native. */
export function handlePosterNavigation(event: KeyboardEvent<HTMLElement>) {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
  if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
  const target = (event.target as Element).closest<HTMLElement>('.poster-card,.series-folder-card');
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>('.poster-card,.series-folder-card')];
  const index = target ? items.indexOf(target) : -1;
  if (index < 0) return;
  const columns = getComputedStyle(event.currentTarget).gridTemplateColumns.trim().split(/\s+/).length;
  const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -columns : columns;
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Math.max(0,Math.min(items.length - 1,index + delta));
  event.preventDefault();
  items[next].focus({preventScroll:true});
  items[next].scrollIntoView({block:'nearest',inline:'nearest',behavior:prefersReducedMotion()?'instant':'smooth'});
}
