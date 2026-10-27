/** TMDB's zh image tag does not identify Simplified versus Traditional text. */
export interface TmdbImage {
  file_path?: string;
  iso_639_1?: string | null;
  iso_3166_1?: string | null;
  width?: number;
  height?: number;
  vote_average?: number;
  vote_count?: number;
}

export interface TmdbImages {
  posters?: TmdbImage[];
  backdrops?: TmdbImage[];
}

function dimensions(image: TmdbImage): [number, number] | null {
  if (!image || typeof image !== 'object') return null;
  if (typeof image.file_path !== 'string' || !/^\/[a-zA-Z0-9_.-]+$/.test(image.file_path)) return null;
  const { width, height } = image;
  return typeof width === 'number' && Number.isFinite(width) && width > 0 &&
    typeof height === 'number' && Number.isFinite(height) && height > 0 ? [width, height] : null;
}

function score(image: TmdbImage, idealRatio: number): number {
  const count = Math.max(0, Math.min(image.vote_count ?? 0, 10000));
  const average = Math.max(0, Math.min(image.vote_average ?? 0, 10));
  // A single 10/10 vote must not outrank an established image by itself.
  const rating = (average * count + 6 * 20) / (count + 20);
  const width = image.width!, height = image.height!;
  const resolution = Math.min(width / (idealRatio > 1 ? 1920 : 1000), 2);
  return rating * 10 + resolution * 8 - Math.abs(width / height - idealRatio) * 12;
}

function ordered(images: TmdbImage[], ratio: number): TmdbImage[] {
  const seen = new Set<string>();
  return [...images].sort((a, b) => score(b, ratio) - score(a, ratio) ||
    (a.file_path! < b.file_path! ? -1 : a.file_path! > b.file_path! ? 1 : 0))
    .filter(image => !seen.has(image.file_path!) && Boolean(seen.add(image.file_path!)));
}

export function selectPoster(images: TmdbImage[] = []): string | null {
  if (!Array.isArray(images)) return null;
  const allowed = images.filter(image => {
    const size = dimensions(image);
    // Never trust an unclassified detail/search poster_path or a generic zh tag.
    const simplified = image.iso_639_1 === 'zh-Hans' || image.iso_639_1 === 'zh-CN' ||
      (image.iso_639_1 === 'zh' && image.iso_3166_1 === 'CN');
    return size && (image.iso_639_1 === 'en' || simplified) && size[0] >= 400 && size[1] >= 600 &&
      size[0] / size[1] >= 0.55 && size[0] / size[1] <= 0.85;
  });
  const simplified = allowed.filter(image => image.iso_639_1 !== 'en');
  return ordered(simplified.length ? simplified : allowed, 2 / 3)[0]?.file_path ?? null;
}

export function selectBackdrop(images: TmdbImage[] = [], season: number | null = null): string | null {
  if (!Array.isArray(images)) return null;
  const allowed = images.filter(image => {
    const size = dimensions(image);
    return size && (image.iso_639_1 === null || image.iso_639_1 === 'en') &&
      size[0] >= 1280 && size[1] >= 720 && size[0] / size[1] >= 1.5 && size[0] / size[1] <= 2.05 &&
      !((image.vote_count ?? 0) > 0 && (image.vote_average ?? 0) < 4);
  });
  // Prefer artwork tagged as textless. English backdrops are a last resort.
  const textless = allowed.filter(image => image.iso_639_1 === null);
  const ranked = ordered(textless.length ? textless : allowed, 16 / 9);
  if (!ranked.length) return null;
  const bestScore = score(ranked[0], 16 / 9);
  const pool = ranked.filter(image => score(image, 16 / 9) >= bestScore - 12).slice(0, 8);
  // These are show-gallery variants, not proven season-specific promotional art.
  const index = season === null ? 0 : Math.max(0, season - 1) % pool.length;
  return pool[index].file_path ?? null;
}
