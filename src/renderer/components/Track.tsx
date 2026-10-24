import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './icons';

/**
 * Horizontally scrolling content track with quiet scroll affordances.
 * The arrows only appear when there is actually overflow in that direction.
 */
export function Track({
  title,
  meta,
  action,
  children,
  tone = 'default',
}: {
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  tone?: 'default' | 'queue';
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const measure = useCallback(() => {
    const node = scroller.current;
    if (!node) return;
    setCanLeft(node.scrollLeft > 8);
    setCanRight(node.scrollLeft + node.clientWidth < node.scrollWidth - 8);
  }, []);

  useEffect(() => {
    measure();
    const node = scroller.current;
    if (!node) return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    node.addEventListener('scroll', measure, { passive: true });
    return () => {
      observer.disconnect();
      node.removeEventListener('scroll', measure);
    };
  }, [measure]);

  const scrollBy = (direction: 1 | -1) => {
    const node = scroller.current;
    if (!node) return;
    node.scrollBy({ left: direction * Math.max(320, node.clientWidth * 0.8), behavior: 'smooth' });
  };

  return (
    <section className={`track-section${tone === 'queue' ? ' is-queue' : ''}`}>
      <div className="section-head">
        <h2 className="section-title">{title}</h2>
        {meta ? <span className="section-sub">{meta}</span> : null}
        <span className="spacer" />
        {action}
        <div className="track-nav">
          <button
            type="button"
            className="btn btn-icon"
            aria-label={`${title}向左滚动`}
            disabled={!canLeft}
            onClick={() => scrollBy(-1)}
          >
            <Icon name="chevronLeft" size={16} />
          </button>
          <button
            type="button"
            className="btn btn-icon"
            aria-label={`${title}向右滚动`}
            disabled={!canRight}
            onClick={() => scrollBy(1)}
          >
            <Icon name="chevronRight" size={16} />
          </button>
        </div>
      </div>
      <div className="track" ref={scroller}>
        {children}
      </div>
    </section>
  );
}
