import type { CollectionEntry, Film, FilmSeries } from './types';
import { parseTmdbIdentity } from './tmdbIdentity';
const normal=(text:string)=>text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
function ordinal(text:string):number|null {
  if(/^\d+$/.test(text))return Number(text);
  const digits:Record<string,number>={'零':0,'〇':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
  if(/^[零〇一二两三四五六七八九十百]+$/.test(text)) {
    let result=0,current=0;
    for(const char of text) {if(char==='十' || char==='百'){result+=(current || 1)*(char==='十'?10:100);current=0;}else current=digits[char];}
    return result+current;
  }
  if(!/^(?=[IVXLCDM]+$)M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(text))return null;
  const roman:Record<string,number>={I:1,V:5,X:10,L:50,C:100,D:500,M:1000};let value=0;
  for(let i=0;i<text.length;i++)value+=roman[text[i]]<(roman[text[i+1]] ?? 0)?-roman[text[i]]:roman[text[i]];
  return value;
}
export function titleSequence(title:string,type:Film['mediaType']):{root:string;order:number}|null {
  const text=title.normalize('NFKC').trim();
  const patterns=type==='tv' ? [
    /^(.*?)\s*[·._ -]*第\s*([\d零〇一二两三四五六七八九十百]+)\s*季(?:\s*[:：].*)?$/i,
    /^(.*?)\s*[·._ -]*(?:Season\s*|S)(\d{1,4})$/i,
  ] : [
    /^(.*?)\s*第\s*([\d零〇一二两三四五六七八九十百]+)\s*部(?:\s*[:：].*)?$/,
    /^(.*?)\s*[ .·_-]*(\d{1,3}|[一二两三四五六七八九十百]+)(?:\s*[:：].*)?$/,
    /^(.*?)\s+([IVXLCDM]{1,10})(?:\s*[:：].*)?$/,
  ];
  for(const pattern of patterns) {
    const match=pattern.exec(text);if(!match)continue;
    const root=match[1].replace(/[\s·._-]+$/g,'').trim(),order=ordinal(match[2]);
    if(normal(root).length>=2 && order!==null)return {root,order};
  }
  return null;
}
export function identifySeries(entries:CollectionEntry[]):Map<string,FilmSeries> {
  const known=new Map<string,Set<string>>(),numbered=new Set<string>();
  const base=entries.map(entry=>{
    const film=entry.film,sequence=titleSequence(film.title,film.mediaType);
    const root=sequence?.root ?? film.title;
    const identity=film.mediaType==='tv' && film.metadataSource==='tmdb' && film.externalId ? parseTmdbIdentity(film.externalId,'tv') : null;
    const structured=film.series ?? (identity ? {key:`tmdb:tv:${identity.id}`,title:root.replace(/\s*·\s*特别篇$/,''),order:identity.season ?? -1}:null);
    const rootKey=`${film.mediaType}:${normal(root)}`;

    if(structured && !structured.customOrder && !structured.key.startsWith('manual:')) {const keys=known.get(rootKey) ?? new Set<string>();keys.add(structured.key);known.set(rootKey,keys);}
    return {entry,sequence,structured,root,rootKey};
  });
  const roots=new Map<string,number>();
  for(const item of base)if(!item.structured?.customOrder && !item.structured?.key.startsWith('manual:'))roots.set(item.rootKey,(roots.get(item.rootKey) ?? 0)+1);
  for(const item of base)if(item.sequence && !item.structured?.customOrder && !item.structured?.key.startsWith('manual:') &&
    (item.entry.film.mediaType==='tv' || (roots.get(item.rootKey) ?? 0)>1 || known.has(item.rootKey)))numbered.add(item.rootKey);
  const names=new Map(base.filter(item=>item.structured).map(item=>[item.structured!.key,item.structured!.title]));
  const result=new Map<string,FilmSeries>();
  for(const item of base) {
    if(item.structured) {result.set(item.entry.id,{...item.structured,order:item.structured.customOrder || item.structured.key.startsWith('manual:') ? item.structured.order : item.sequence?.order ?? item.structured.order});continue;}
    if(!numbered.has(item.rootKey))continue;
    const matches=known.get(item.rootKey);
    const key=matches?.size===1 ? [...matches][0] : `title:${item.rootKey}`;
    result.set(item.entry.id,{key,title:names.get(key) ?? item.root,order:item.sequence?.order ?? 1});
  }
  return result;
}
/** Group anchors retain the selected sort; members always progress in numeric order. */
export function groupSeriesEntries(entries:CollectionEntry[], identities=identifySeries(entries)):CollectionEntry[] {
  const groups=new Map<string,CollectionEntry[]>();
  for(const entry of entries) {const key=identities.get(entry.id)?.key ?? `entry:${entry.id}`;const group=groups.get(key) ?? [];group.push(entry);groups.set(key,group);}
  return [...groups.values()].flatMap(group=>group.sort((a,b)=>{
    const aa=identities.get(a.id)?.order ?? Infinity,bb=identities.get(b.id)?.order ?? Infinity;
    return (aa===bb?0:aa-bb) || (a.film.year ?? Infinity)-(b.film.year ?? Infinity) || a.film.title.localeCompare(b.film.title,'zh-CN',{numeric:true});
  }));
}
