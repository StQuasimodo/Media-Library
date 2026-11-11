import type {Film, RelatedTv,RelationshipHints} from './types';
import {parseTmdbIdentity} from './tmdbIdentity';

export type {RelationshipHints} from './types';
export interface TvTarget {id:string;title:string;aliases:string[];hints?:RelationshipHints;hintsAt?:string}
export function validRelationshipHints(value:unknown):value is RelationshipHints {if(!value||typeof value!=='object')return false;const h=value as RelationshipHints;return Array.isArray(h.cast)&&Array.isArray(h.creators)&&Array.isArray(h.keywords)&&h.cast.every(id=>Number.isSafeInteger(id)&&id>0)&&h.creators.every(id=>Number.isSafeInteger(id)&&id>0)&&h.keywords.every(k=>typeof k==='string');}
export function validRelatedTv(value:unknown):value is RelatedTv {if(!value||typeof value!=='object')return false;const r=value as RelatedTv;return r.source==='tmdb-evidence-v1'&&typeof r.tvId==='string'&&/^\d+$/.test(r.tvId)&&typeof r.title==='string'&&r.title.length>0&&r.title.length<=200&&Number.isFinite(r.score)&&r.score>=70;}
const stop=new Set(['the','a','an','movie','film','tv','series']);
const words=(text:string)=>text.normalize('NFKD').toLowerCase().replace(/\p{M}/gu,'').replace(/(电影版|剧场版|大电影|电影)/g,' $1 ').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export const seriesTitle=(text:string)=>text.replace(/\s*[·._ -]*第\s*\d+\s*季\s*$/i,'').replace(/\s*[·._ -]*(?:Season\s*|S)\d+\s*$/i,'').replace(/\s*·\s*特别篇$/,'').trim();
export function tvTargets(films:Film[]):TvTarget[]{
 const targets=new Map<string,TvTarget>();
 for(const film of films){if(film.mediaType!=='tv'||film.metadataSource!=='tmdb'||!film.externalId)continue;const id=parseTmdbIdentity(film.externalId,'tv')?.id;if(!id)continue;
  const title=seriesTitle(film.title),aliases=[title,seriesTitle(film.originalTitle??'')].filter(Boolean);const old=targets.get(id);
  if(old)old.aliases=[...new Set([...old.aliases,...aliases])];else targets.set(id,{id,title,aliases});
  const target=targets.get(id)!;if(validRelationshipHints(film.series?.relationshipHints)&&(!target.hints||(film.metadataUpdatedAt??'')>(target.hintsAt??''))){target.hints=film.series.relationshipHints;target.hintsAt=film.metadataUpdatedAt??'';}
 }return [...targets.values()].sort((a,b)=>a.id.localeCompare(b.id));
}
export function titleEvidence(movie:Pick<Film,'title'|'originalTitle'>,tv:TvTarget):{matches:number;distinctive:boolean}{
 const titles=[movie.title,movie.originalTitle??''].map(words);let distinctive=false;const matches=new Set<string>();
 for(const alias of tv.aliases){const name=words(alias);if(!name||name.length<2)continue;
  if(titles.some(title=>` ${title} `.includes(` ${name} `))){matches.add(name);const tokens=name.split(' ').filter(t=>!stop.has(t));if(/[\u3400-\u9fff]{3}/.test(name)||tokens.length>=2||tokens.some(t=>t.length>=8))distinctive=true;}
 }return {matches:matches.size,distinctive};
}
const overlap=(a:number[],b:number[])=>[...new Set(a.filter(id=>Number.isSafeInteger(id)&&id>0))].filter(id=>b.includes(id)).length;
export const hasContinuationHint=(h:RelationshipHints)=>h.keywords.some(k=>['spin off','based on tv series','based on television series','continuation of tv series','sequel to tv series','改编自电视剧','电视剧衍生'].includes(words(k)));
export function relatedTvCandidate(movie:Pick<Film,'title'|'originalTitle'>,tv:TvTarget,movieHints:RelationshipHints,tvHints:RelationshipHints):RelatedTv|null{
 const names=titleEvidence(movie,tv);
 const cast=overlap(movieHints.cast,tvHints.cast),creators=overlap(movieHints.creators,tvHints.creators);
 const continuation=hasContinuationHint(movieHints);
 const named=names.matches>0&&names.distinctive&&(cast>=2||(cast>=1&&(creators>=1||continuation)));
 const unnamed=continuation&&cast>=3&&creators>=1;if(!named&&!unnamed)return null;
 const score=Math.min(names.matches,2)*20+Math.min(cast,3)*20+(creators?25:0)+(continuation?25:0);
 if(score<70)return null;
 return {tvId:tv.id,title:tv.title,source:'tmdb-evidence-v1',score,evidence:[...(names.matches?['title']:[]),...(cast?[`cast:${cast}`]:[]),...(creators?[`creator:${creators}`]:[]),...(continuation?['continuation-keyword']:[])]};
}
export function chooseRelatedTv(candidates:RelatedTv[]):RelatedTv|null{
 const sorted=[...candidates].sort((a,b)=>b.score-a.score||a.tvId.localeCompare(b.tvId));
 return sorted.length&&(!sorted[1]||sorted[0].score-sorted[1].score>=15)?sorted[0]:null;
}
export function relationWritable(film:Film):boolean{return film.mediaType==='movie'&&film.metadataSource==='tmdb'&&Boolean(film.externalId)&&film.series?.franchise===undefined&&!film.series?.key.startsWith('manual:');}
