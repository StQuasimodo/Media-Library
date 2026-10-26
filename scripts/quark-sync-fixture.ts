/** Test-only boundaries: real production Electron/UI/SQLite/metadata, controlled HTTP responses. */
import { session, safeStorage } from 'electron';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { CredentialStore } from '../electron/main/services/credentials';

export function installQuarkSyncFixture(profile: string) {
  if(process.platform==='linux') safeStorage.setUsePlainTextEncryption(true);
  assert.equal(safeStorage.isEncryptionAvailable(),true,'fixture needs isolated OS storage');
  new CredentialStore(join(profile,'credentials.json'),{
    isAvailable:()=>safeStorage.isEncryptionAvailable(),encrypt:value=>safeStorage.encryptString(value),decrypt:value=>safeStorage.decryptString(value),
  }).setKey('mycinema-fixture-not-a-real-tmdb-key');
  const directory=(fid:string,file_name:string)=>({fid,file_name,file:false,category:0,size:0});
  const video=(fid:string,file_name:string)=>({fid,file_name,file:true,category:1,size:2_000_000_000});
  const tree: Record<string,Array<ReturnType<typeof video>>>={
    '0':[directory('sync-media','验证影视')],
    'sync-media':[video('sync-movie','The.Matrix.1999.UHD.BluRay.2160p.HEVC.HDR10.TrueHD.Atmos.7.1.REMUX.mkv'),directory('sync-show','Dark.2017.1080p.WEB-DL.x265.10bit.DDP5.1')],
    'sync-show':[directory('sync-season','Season 1')],
    'sync-season':[video('sync-e1','S01E01.mkv'),video('sync-e2','S01E02.mkv')],
  };
  let failure=false,searches=0;
  const store=session.fromPartition('persist:mycinema-quark-web');
  Object.defineProperty(store,'fetch',{configurable:true,value:async(input: string | URL | Request)=>{
    const url=new URL(String(input));
    assert.equal(url.hostname,'drive-pc.quark.cn');assert.equal(url.pathname,'/1/clouddrive/file/sort');
    const id=url.searchParams.get('pdir_fid')!;
    if(failure && id==='sync-season')return new Response('{}',{status:500});
    const items=tree[id] ?? [];
    const size=Number(url.searchParams.get('_size')),page=Number(url.searchParams.get('_page'));
    return Response.json({status:200,code:0,data:{list:items.slice((page-1)*size,page*size)},metadata:{_total:items.length}});
  }});
  globalThis.fetch=(async(input: string | URL | Request)=>{
    const url=new URL(String(input));
    if(url.hostname==='image.tmdb.org') return new Response(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64'),{headers:{'content-type':'image/png'}});
    assert.ok(['api.tmdb.org','api.themoviedb.org'].includes(url.hostname),'fixture must not access another host');
    const movie={id:603,media_type:'movie',title:'黑客帝国',original_title:'The Matrix',release_date:'1999-03-31',overview:'受控匹配测试资料',poster_path:null,backdrop_path:null,genres:[]};
    const tv={id:603,media_type:'tv',name:'暗黑',original_name:'Dark',first_air_date:'2017-12-01',overview:'受控剧集匹配测试资料',poster_path:'/sync-fixture.png',backdrop_path:'/sync-fixture-bg.png',genres:[],episode_run_time:[50]};
    if(url.pathname.includes('/search/')) {
      searches++;const query=url.searchParams.get('query')!.toLowerCase();
      return Response.json({results:query==='the matrix'?[movie]:query==='dark'?[tv]:[]});
    }
    if(url.pathname.endsWith('/movie/603'))return Response.json(movie);
    if(url.pathname.endsWith('/tv/603/season/2'))return Response.json({season_number:2,air_date:'2019-06-21',overview:'受控第二季资料',poster_path:'/season2-fixture.png',episodes:[{runtime:55}]});
    if(url.pathname.endsWith('/tv/603/season/1'))return Response.json({season_number:1,air_date:'2017-12-01',overview:'受控第一季资料',poster_path:'/season-fixture.png',episodes:[{runtime:50}]});
    if(url.pathname.endsWith('/tv/603'))return Response.json(tv);
    throw new Error('Unexpected fixture metadata path');
  }) as typeof fetch;
  return {
    searches:()=>searches,
    addSeasons:()=>{tree['sync-show'].push(directory('sync-season2','Season 2'));tree['sync-season2']=[video('sync-e21','S02E01.mkv')];tree['sync-media'].push(directory('sync-obscure','Obscure.2024'));tree['sync-obscure']=[video('sync-o31','S03E01.mkv')];},
    incremental:()=>{tree['sync-season'][0].file_name='Dark.S01E01.1080p.mkv';tree['sync-season'].push(video('sync-e3','S01E03.mkv'));},
    removeSecond:()=>{tree['sync-season']=tree['sync-season'].filter(file=>file.fid!=='sync-e2');},
    setFailure:(value:boolean)=>{failure=value;},
  };
}
