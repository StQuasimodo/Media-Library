import {afterEach,describe,expect,it} from 'vitest';
import cases from './fixtures/related-tv-cases.json';
import {chooseRelatedTv,relatedTvCandidate,tvTargets,validRelatedTv} from '../src/shared/relatedTv';
import {TestApp,candidate} from './helpers';
import {TmdbProvider} from '../electron/main/services/metadata/tmdb';
import {MetadataService} from '../electron/main/services/metadataService';
import {seriesFolders} from '../src/shared/franchises';
let app:TestApp|undefined;afterEach(()=>app?.dispose());
describe('cross-media TV relationships use evidence rather than a hardcoded title',()=>{
 for(const c of cases)it(c.name,()=>expect(Boolean(relatedTvCandidate(c.movie,c.tv,c.movieHints,c.tvHints))).toBe(c.expected));
 it('does not silently pick between equally plausible TV identities',()=>{const c=cases[0],a=relatedTvCandidate(c.movie,c.tv,c.movieHints,c.tvHints)!;expect(chooseRelatedTv([a,{...a,tvId:'123'}])).toBeNull();});
});
async function seed(){app=new TestApp();const tv=await app.library.importCandidate(candidate({externalId:'60574:season:1',mediaType:'tv',title:'浴血黑帮 · 第1季',originalTitle:'Peaky Blinders · 第1季',series:{key:'tmdb:tv:60574',title:'浴血黑帮',order:1},posterUrl:null,backdropUrl:null}));const movie=await app.library.importCandidate(candidate({externalId:'900001',title:cases[0].movie.title,originalTitle:cases[0].movie.originalTitle,series:null,posterUrl:null,backdropUrl:null}));return {tv,movie};}
function provider(fetcher?:typeof fetch){return new TmdbProvider({getConfig:()=>({apiKey:'fixture-not-a-key',language:'zh-CN'}),hosts:['https://api.tmdb.org/3'],fetchImpl:fetcher??(async(input)=>{const url=new URL(String(input));expect(url.searchParams.get('append_to_response')).toBe('credits,keywords');return Response.json({created_by:[{id:31}],credits:{cast:[{id:11},{id:12}],crew:[{id:31,job:'Writer'}]},keywords:{keywords:[]}});})});}
it('automatically groups independent movie with the owned TV series and preserves it across refresh/restart',async()=>{
 const {tv,movie}=await seed();const service=new MetadataService(provider(),app!.repo,app!.library);expect((await service.resolveSeries()).updated).toBe(1);
 expect(app!.repo.getFilm(movie.film.id)?.series?.relatedTv).toMatchObject({tvId:'60574',source:'tmdb-evidence-v1'});let folders=seriesFolders(app!.repo.listEntries());expect(folders).toHaveLength(1);expect(folders[0].entries).toHaveLength(2);
 await app!.library.applyExternalMetadata(movie.film.id,candidate({externalId:'900001',series:null,posterUrl:null,backdropUrl:null}));app!.restart();folders=seriesFolders(app!.repo.listEntries());expect(folders).toHaveLength(1);expect(app!.repo.getFilm(tv.film.id)?.series?.key).toBe('tmdb:tv:60574');
});
it('does not overwrite a manual folder decision made while metadata is in flight',async()=>{
 const {movie}=await seed();let finish!:(r:Response)=>void;const hints=()=>Response.json({credits:{cast:[{id:11},{id:12}],crew:[{id:31,job:'Writer'}]}});const service=new MetadataService(provider(((input)=>String(input).includes('/movie/')?new Promise<Response>(resolve=>{finish=resolve;}):Promise.resolve(hints())) as typeof fetch),app!.repo,app!.library);const job=service.resolveSeries();await Promise.resolve();await Promise.resolve();app!.library.assignFranchise([movie.film.id],'我的独立收藏');
 finish(hints());await job;expect(app!.repo.getFilm(movie.film.id)?.series?.franchise?.title).toBe('我的独立收藏');
});
it('network failure preserves a previously inferred relation and pauses retries',async()=>{
 const {movie}=await seed();await new MetadataService(provider(),app!.repo,app!.library).resolveSeries();const before=app!.repo.getFilm(movie.film.id)!.series;let calls=0;
 const service=new MetadataService(provider((async()=>{calls++;throw new TypeError('offline');}) as typeof fetch),app!.repo,app!.library);await service.resolveSeries();await service.resolveSeries();expect(calls).toBe(1);expect(app!.repo.getFilm(movie.film.id)?.series).toEqual(before);
});
it('deduplicates all seasons of a show before fetching relationship evidence',async()=>{const {tv}=await seed();const targets=tvTargets([tv.film,{...tv.film,id:'other',externalId:'60574:season:2',title:'浴血黑帮 · 第2季'}]);expect(targets).toHaveLength(1);expect(targets[0].aliases).toEqual(['浴血黑帮','Peaky Blinders']);});
it('rejects malformed persisted relation data rather than rendering an invalid folder label',()=>{expect(validRelatedTv({source:'tmdb-evidence-v1',tvId:'60574',title:{bad:'shape'},score:100})).toBe(false);});
it('incomplete credits cannot be treated as an authoritative absence of a relationship',async()=>{const p=provider((async()=>Response.json({title:'partial response'})) as typeof fetch);await expect(p.relationshipHints('900001','movie')).rejects.toMatchObject({code:'BAD_RESPONSE'});});
it('disposing an old library context prevents a late relationship write',async()=>{const {movie}=await seed();let finish!:(r:Response)=>void;const service=new MetadataService(provider((()=>new Promise<Response>(resolve=>{finish=resolve;})) as typeof fetch),app!.repo,app!.library);const job=service.resolveSeries();await Promise.resolve();await Promise.resolve();service.dispose();finish(Response.json({credits:{cast:[{id:11},{id:12}],crew:[]}}));await job;expect(app!.repo.getFilm(movie.film.id)?.series).toBeNull();});
it('uses persisted continuation evidence for a film whose name does not contain the TV title, without extra network calls',async()=>{
 app=new TestApp();const c=cases.find(row=>row.movie.originalTitle==='Serenity')!;
 await app.library.importCandidate(candidate({externalId:'1437',mediaType:'tv',title:'萤火虫',originalTitle:'Firefly',posterUrl:null,backdropUrl:null,series:{key:'tmdb:tv:1437',title:'萤火虫',order:-1,relationshipHints:c.tvHints}}));
 const movie=await app.library.importCandidate(candidate({externalId:'900002',title:c.movie.title,originalTitle:c.movie.originalTitle,posterUrl:null,backdropUrl:null,series:{key:'work:tmdb:movie:900002',title:c.movie.title,order:null,relationshipHints:c.movieHints}}));let calls=0;
 const service=new MetadataService(provider((async()=>{calls++;throw new Error('not needed');}) as typeof fetch),app.repo,app.library);await service.resolveSeries();expect(calls).toBe(0);expect(app.repo.getFilm(movie.film.id)?.series?.relatedTv?.tvId).toBe('1437');app.restart();expect(seriesFolders(app.repo.listEntries())).toHaveLength(1);
});
