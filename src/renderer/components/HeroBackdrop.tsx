import { useEffect, useRef, useState } from 'react';

interface Layer {
  key: number;
  src: string | null;
}

/**
 * Cross-fades the full-bleed hero artwork.
 *
 * Two layers at most are mounted during a transition, and the incoming image is
 * pre-decoded before it is shown, so switching focus never flashes an empty
 * backdrop. Images come from the local cache via `mycinema://`, so re-showing a
 * previously viewed film costs no network request.
 */
export function HeroBackdrop({
  src,
  posterSrc,
  className = 'hero-layer',
}: {
  src: string | null;
  posterSrc?: string | null;
  className?: string;
}) {
  const [layers, setLayers] = useState<Layer[]>([{ key: 0, src }]);
  const lastSrc = useRef<string | null>(src);
  const nextKey = useRef(1);

  useEffect(() => {
    if (src === lastSrc.current) return;
    lastSrc.current = src;

    let cancelled = false;
    const commit = () => {
      if (cancelled) return;
      const key = nextKey.current++;
      setLayers((current) => [...current.slice(-1), { key, src }]);
      window.setTimeout(() => {
        setLayers((current) => (current.length > 1 ? current.slice(-1) : current));
      }, 460);
    };

    if (!src) {
      commit();
      return () => {
        cancelled = true;
      };
    }

    // Decode first: swapping on a decoded bitmap avoids the one-frame flash a
    // plain background-image swap can produce.
    const image = new Image();
    image.onload = commit;
    image.onerror = commit;
    image.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  return (
    <div className="hero-layers" aria-hidden="true">
      {layers.map((layer, index) => {
        const source = layer.src ?? posterSrc ?? null;
        const isNewest = index === layers.length - 1 && layers.length > 1;
        return (
          <div
            key={layer.key}
            className={`${className}${isNewest ? ' is-entering' : ''}`}
            style={source ? { backgroundImage: `url("${source}")` } : undefined}
            data-empty={!source}
          />
        );
      })}
    </div>
  );
}
