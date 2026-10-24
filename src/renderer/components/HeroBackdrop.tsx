import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '../lib/motion';

interface Layer {
  key: number;
  src: string | null;
}

/** Keep the previous artwork visible until the next local image has decoded. */
export function HeroBackdrop({
  src,
  posterSrc,
  className = 'hero-layer',
}: {
  src: string | null;
  posterSrc?: string | null;
  className?: string;
}) {
  const [layers, setLayers] = useState<Layer[]>([{ key: 0, src: null }]);
  const nextKey = useRef(1);

  useEffect(() => {
    let cancelled = false;
    let image: HTMLImageElement | null = null;
    let cleanupTimer: number | undefined;

    const commit = (source: string | null) => {
      if (cancelled) return;
      const layer = { key: nextKey.current++, src: source };
      const reduceMotion = prefersReducedMotion();
      setLayers((current) => {
        if (current.at(-1)?.src === source) return current;
        return reduceMotion ? [layer] : [...current.slice(-1), layer];
      });
      cleanupTimer = window.setTimeout(() => {
        // An older transition must never finish a newer transition early.
        setLayers((current) => current.at(-1)?.key === layer.key ? [layer] : current);
      }, 460);
    };

    const load = async () => {
      const candidates = [...new Set([src, posterSrc].filter((url): url is string => Boolean(url)))];
      for (const source of candidates) {
        if (cancelled) return;
        try {
          const pending = new Image();
          image = pending;
          await new Promise<void>((resolve, reject) => {
            pending.onload = () => resolve();
            pending.onerror = () => reject(new Error('Artwork unavailable'));
            pending.src = source;
          });
          if (cancelled) return;
          // load alone does not guarantee that the bitmap is decoded.
          if (typeof pending.decode === 'function') await pending.decode();
          if (cancelled) return;
          commit(source);
          return;
        } catch {
          // A stale cache path may fail: try the poster before the empty state.
        }
      }
      commit(null);
    };

    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(cleanupTimer);
      if (image) {
        image.onload = null;
        image.onerror = null;
      }
    };
  }, [src, posterSrc]);

  return (
    <div className="hero-layers" aria-hidden="true" data-empty={!layers.at(-1)?.src}>
      {layers.map((layer, index) => (
        <div
          key={layer.key}
          className={`${className}${index === layers.length - 1 && layers.length > 1 ? ' is-entering' : ''}`}
          style={layer.src ? { backgroundImage: `url("${layer.src}")` } : undefined}
          data-empty={!layer.src}
        />
      ))}
    </div>
  );
}
