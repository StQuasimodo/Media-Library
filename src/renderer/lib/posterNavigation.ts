import type { KeyboardEvent } from 'react';
import { prefersReducedMotion } from './motion';
const pendingScroll = new WeakMap<HTMLElement, number>();
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
  const item=items[next],grid=event.currentTarget;
  item.focus({preventScroll:true});
  // Keep a single cancellable scroll per grid. Native scrollIntoView requests
  // can race when focus changes again before the browser starts scrolling.
  const previous=pendingScroll.get(grid);
  if(previous!==undefined)cancelAnimationFrame(previous);
  pendingScroll.set(grid,requestAnimationFrame(()=>{
    pendingScroll.delete(grid);
    if(!item.isConnected)return;
    const page=grid.closest<HTMLElement>('.page');
    if(!page)return;
    const bounds=item.getBoundingClientRect(),viewport=page.getBoundingClientRect();
    const start=page.scrollTop,top=viewport.top+112,bottom=viewport.bottom-24;
    const delta=bounds.top<top?bounds.top-top:bounds.bottom>bottom?bounds.bottom-bottom:0;
    const destination=Math.max(0,Math.min(page.scrollHeight-page.clientHeight,start+delta));
    page.scrollTo({top:start,behavior:'instant'});
    if(prefersReducedMotion()){page.scrollTo({top:destination,behavior:'instant'});return;}
    const began=performance.now();
    const advance=(now:number)=>{
      if(!item.isConnected){pendingScroll.delete(grid);return;}
      const progress=Math.min(1,(now-began)/240),eased=1-Math.pow(1-progress,3);
      page.scrollTo({top:start+(destination-start)*eased,behavior:'instant'});
      if(progress<1)pendingScroll.set(grid,requestAnimationFrame(advance));
      else pendingScroll.delete(grid);
    };
    pendingScroll.set(grid,requestAnimationFrame(advance));
  }));
}
