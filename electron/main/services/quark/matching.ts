import { createHash } from 'node:crypto';
import type { MetadataSearchResult } from '../../../../src/shared/types';
import type { QuarkMatchCandidate, QuarkMatchQuery } from '../../../../src/shared/quarkSync';

export const normalTitle = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export function groupIdentity(query: QuarkMatchQuery) {
  return createHash('sha256').update(JSON.stringify([normalTitle(query.title),query.year,query.mediaType])).digest('hex');
}
export function rankMatches(results: MetadataSearchResult[], query: QuarkMatchQuery): QuarkMatchCandidate[] {
  const seen=new Set<string>();
  const ranked=results.filter(result => {
    const identity=`${result.mediaType}:${result.externalId}`;
    if (seen.has(identity) || (query.mediaType !== 'all' && query.mediaType !== result.mediaType)) return false;
    seen.add(identity); return true;
  }).map(result => {
    const exact=normalTitle(query.title) === normalTitle(result.title) || Boolean(result.originalTitle && normalTitle(query.title) === normalTitle(result.originalTitle));
    const year=query.year !== null && query.year === result.year;
    return { result, high: exact && year, score: Number(exact)*100 + Number(year)*25 };
  }).sort((a,b) => b.score-a.score);
  const unique=ranked.filter(result=>result.high).length === 1;
  return ranked.slice(0,20).map(({result,high}) => ({...result, confidence: high && unique ? 'high' : 'review'}));
}
