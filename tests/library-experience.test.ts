import {afterEach,describe,expect,it} from 'vitest';
import {rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {TestApp,candidate,pngFetch} from './helpers';
import {seriesFolders,franchise} from '../src/shared/franchises';
import {backdropUrl,backdropLabel} from '../src/renderer/lib/format';
import {MetadataService} from '../electron/main/services/metadataService';
import type {TmdbProvider} from '../electron/main/services/metadata/tmdb';
import {transientImage} from '../electron/main/services/transientImages';
let app:TestApp|undefined;afterEach(()=>app?.dispose());
describe('universe folders and artwork preservation',()=>{
 it('groups known related shows and spin-off films, preserving canonical order and manual overrides across restart',async()=>{
  app=new TestApp({fetchImpl:pngFetch()});const a=await app.library.importCandidate(candidate({externalId:'1396:season:2',mediaType:'tv',title:'绝命毒师 第二季',series:{key:'tmdb:tv:1396',title:'绝命毒师',order:2}}));
  const b=await app.library.importCandidate(candidate({externalId:'1396:season:1',mediaType:'tv',title:'绝命毒师 第一季',series:{key:'tmdb:tv:1396',title:'绝命毒师',order:1}}));
  const c=await app.library.importCandidate(candidate({externalId:'60059:season:1',mediaType:'tv',title:'风骚律师 第一季',series:{key:'tmdb:tv:60059',title:'风骚律师',order:1}}));
  const d=await app.library.importCandidate(candidate({externalId:'559969',title:'续命之徒'}));
  let entries=app.repo.listEntries();let folders=seriesFolders(entries);expect(folders).toHaveLength(1);expect(folders[0].entries.filter(e=>e.film.externalId?.startsWith('1396')).map(e=>e.film.series?.order)).toEqual([1,2]);
  const ids=entries.map(e=>e.filmId);app.library.assignFranchise(ids,'我的影视宇宙');app.restart();entries=app.repo.listEntries();expect(seriesFolders(entries)).toHaveLength(1);expect(seriesFolders(entries)[0].title).toBe('我的影视宇宙');expect(entries.find(e=>e.filmId===a.film.id)!.film.series?.key).toBe('tmdb:tv:1396');
  app.library.assignFranchise([a.film.id],null);folders=seriesFolders(app.repo.listEntries());expect(folders).toHaveLength(2);expect(app.repo.getFilm(a.film.id)?.series?.franchise).toBeNull();expect([b,c,d]).toHaveLength(3);
 });
 it('only displays season-scoped or manually confirmed backgrounds; re-fetches a locked image after cache loss',async()=>{
  const calls:string[]=[];app=new TestApp({fetchImpl:pngFetch(calls)});const entry=await app.library.importCandidate(candidate({externalId:'1396:season:2',mediaType:'tv',title:'第二季'}));const film=app.repo.getFilm(entry.film.id)!;
  expect(film.backdropPath).toMatch(/^backdrop\/season\/1396-2\//);expect(backdropUrl(film)).toContain('/1396-2/');expect(backdropUrl({...film,backdropPath:'backdrop/old.jpg'})).toBeNull();expect(backdropUrl({...film,backdropPath:film.backdropPath!.replace('1396-2','1396-1')})).toBeNull();
  await app.library.selectArtwork(film.id,'backdrop','https://image.tmdb.org/t/p/w1280/chosen.jpg',true);const chosen=app.repo.getFilm(film.id)!.backdropPath!;expect(chosen).toContain('/manual/');expect(backdropUrl(app.repo.getFilm(film.id)!)).toContain('/manual/');
  rmSync(join(app.dir,'images',chosen));const before=calls.length;await app.library.applyExternalMetadata(film.id,candidate({externalId:'1396:season:2',mediaType:'tv',backdropUrl:'https://image.tmdb.org/t/p/w1280/automatic.jpg'}));
  expect(app.repo.getFilm(film.id)!.backdropPath).toBe(chosen);expect(calls.slice(before)).toContain('https://image.tmdb.org/t/p/w1280/chosen.jpg');expect(existsSync(join(app.dir,'images',chosen))).toBe(true);
 });
 it('streams stills with no-store, no forwarded credentials and strict image-only URL boundaries',async()=>{
  let init:RequestInit|undefined;let address='';const fetcher=(async(input:string|URL|Request,options?:RequestInit)=>{init=options;address=String(input);return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/jpeg'}});}) as typeof fetch;
  const response=await transientImage(new Request('mycinema://transient/still.jpg',{headers:{cookie:'private',authorization:'secret'}}),fetcher);expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');expect(init?.cache).toBe('no-store');expect(init?.redirect).toBe('error');expect(new Headers(init?.headers).get('cookie')).toBeNull();expect(new Headers(init?.headers).get('authorization')).toBeNull();expect(address).toBe('https://image.tmdb.org/t/p/w780/still.jpg');
  expect((await transientImage(new Request('mycinema://transient/../../credentials.bin'),fetcher)).status).toBe(400);expect((await transientImage(new Request('mycinema://transient/still.jpg?target=https://example.com'),fetcher)).status).toBe(400);
 });
 it('shares a correctly scoped series fallback across seasons and restores automatic art after a manual lock',async()=>{
  app=new TestApp({fetchImpl:pngFetch()});const fallback=candidate({externalId:'1396:season:1',mediaType:'tv',backdropScope:'series',backdropSelection:'resolved'});
  const first=await app.library.importCandidate(fallback),second=await app.library.importCandidate({...fallback,externalId:'1396:season:2'});
  const path=first.film.backdropPath!;expect(path).toMatch(/^backdrop\/series\/1396\//);expect(second.film.backdropPath).toBe(path);expect(app.images.read(path)).not.toBeNull();
  expect(backdropLabel(first.film)).toContain('季份未标注');expect(backdropUrl({...first.film,externalId:'60059:season:1'})).toBeNull();expect(backdropUrl({...first.film,backdropPath:first.film.posterPath})).toBeNull();
  await app.library.selectArtwork(first.film.id,'backdrop','https://image.tmdb.org/t/p/w1280/chosen.jpg',true);
  const metadata=new MetadataService({getCandidate:async()=>fallback} as unknown as TmdbProvider,app.repo,app.library);
  const restored=await metadata.selectArtwork(first.film.id,'backdrop',null);expect(restored?.backdropPath).toBe(path);expect(backdropUrl(restored!)).not.toBeNull();
  await app.library.applyExternalMetadata(first.film.id,{...fallback,backdropUrl:null,backdropSelection:'unavailable'});expect(app.repo.getFilm(first.film.id)?.backdropPath).toBe(path);
  app.restart();expect(backdropLabel(app.repo.getFilm(first.film.id)!)).toContain('按季分配');
 });
 it('joins confirmed original/spin-off collection IDs without title guessing and preserves a manual exclusion',async()=>{
  app=new TestApp({fetchImpl:pngFetch()});
  const a=await app.library.importCandidate(candidate({externalId:'20352',title:'神偷奶爸',series:{key:'tmdb:collection:86066',title:'神偷奶爸系列',order:1}}));
  const b=await app.library.importCandidate(candidate({externalId:'211672',title:'小黄人大眼萌',series:{key:'tmdb:collection:544669',title:'小黄人系列',order:1}}));
  const unrelated=await app.library.importCandidate(candidate({externalId:'999999',title:'神偷奶爸2',series:null}));
  const before=seriesFolders(app.repo.listEntries());expect(before.find(f=>f.key==='universe:despicable-me')?.entries.map(e=>e.filmId).sort()).toEqual([a.film.id,b.film.id].sort());
  expect(franchise(unrelated.film)).toBeNull();expect(before.find(f=>f.entries.some(e=>e.filmId===unrelated.film.id))?.standalone).toBe(true);
  app.library.assignFranchise([b.film.id],null);app.restart();expect(franchise(app.repo.getFilm(b.film.id)!)).toBeNull();expect(app.repo.getFilm(b.film.id)?.series?.key).toBe('tmdb:collection:544669');
  const malformed={...a.film,mediaType:'tv' as const};expect(franchise(malformed)).toBeNull();
 });
});
