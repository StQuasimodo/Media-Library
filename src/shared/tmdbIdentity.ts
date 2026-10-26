import type { MediaType } from './types';

/** TMDB searches return series IDs; season records use a stable derived identity. */
export function parseTmdbIdentity(id: string, type: MediaType): { id: string; season: number | null } | null {
  if (typeof id !== 'string') return null;
  if (/^\d+$/.test(id)) return { id, season: null };
  const match = /^(\d+):season:(0|[1-9]\d{0,3})$/.exec(id);
  return type === 'tv' && match ? { id: match[1], season: Number(match[2]) } : null;
}
