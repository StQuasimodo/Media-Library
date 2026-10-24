import { useState } from 'react';
import type { Film } from '@shared/types';
import { imageUrl } from '../lib/format';

type PosterFilm = Pick<Film, 'title' | 'year' | 'posterPath'>;

interface Props {
  film: PosterFilm;
  alt?: string;
  loading?: 'eager' | 'lazy';
}

/** Reset loading/error state when the cache path changes, including after refresh. */
export function PosterImage(props: Props) {
  return <PosterImageContent key={props.film.posterPath ?? ''} {...props} />;
}

function PosterImageContent({ film, alt = '', loading = 'lazy' }: Props) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const src = imageUrl(film.posterPath);

  if (!src || failed) {
    return (
      <span className="poster-fallback">
        <span className="poster-fallback-year">{film.year ?? '—'}</span>
        <span className="poster-fallback-title serif">{film.title}</span>
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading={loading}
      className={loaded ? 'is-loaded' : undefined}
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
    />
  );
}
