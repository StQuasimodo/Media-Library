import rules from './data/franchises.json';
import type {CollectionEntry,Film} from './types';
import {identifySeries,groupSeriesEntries} from './series';
import {parseTmdbIdentity} from './tmdbIdentity';
export interface SeriesFolder {key:string;title:string;entries:CollectionEntry[];standalone:boolean}
export function franchise(film:Film):{key:string;title:string}|null {
  if(film.series?.franchise!==undefined)return film.series.franchise;
  const identity=film.metadataSource==='tmdb'&&film.externalId?parseTmdbIdentity(film.externalId,film.mediaType):null;
  const rule=identity?rules.find(rule=>(film.mediaType==='tv'?rule.tv:rule.movie).includes(identity.id)):undefined;
  return rule?{key:rule.key,title:rule.title}:null;
}
export function seriesFolders(entries:CollectionEntry[]):SeriesFolder[]{
  const identities=identifySeries(entries),folders=new Map<string,SeriesFolder>();
  for(const entry of entries){const universe=franchise(entry.film),group=identities.get(entry.id);
    const key=universe?.key??group?.key??`film:${entry.filmId}`,title=universe?.title??group?.title??entry.film.title;
    if(!folders.has(key))folders.set(key,{key,title,entries:[],standalone:!universe&&!group});
    folders.get(key)!.entries.push(entry);
  }
  return [...folders.values()].map(folder=>({...folder,entries:groupSeriesEntries(folder.entries,identities)}));
}
