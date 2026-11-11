import {describe,it,expect,vi,beforeAll} from 'vitest';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DesktopUpdates,verifyUpdateEnvelope} from '../electron/main/services/updates';
import {compareVersions,mirrorUrl,validateMirror,type UpdateManifest} from '../src/shared/updates';
let privateKey:string,publicKey:string;
beforeAll(()=>{const pair=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});privateKey=pair.privateKey;publicKey=pair.publicKey;});
const binary=Buffer.from('synthetic verified installer, never executed');
function manifest():UpdateManifest{return {format:1,platform:'windows',channel:'stable',version:'1.3.0',versionCode:0,minSdk:0,publishedAt:'2026-11-10T00:00:00Z',releaseUrl:'https://github.com/StQuasimodo/Media-Library/releases/tag/v1.3.0',asset:{name:'My-Cinema-1.3.0-Setup.exe',url:'https://github.com/StQuasimodo/Media-Library/releases/download/v1.3.0/My-Cinema-1.3.0-Setup.exe',bytes:binary.length,sha256:createHash('sha256').update(binary).digest('hex')}};}
function envelope(value=manifest()){const bytes=Buffer.from(JSON.stringify(value));return JSON.stringify({payload:bytes.toString('base64'),signature:sign('sha256',Buffer.concat([Buffer.from('MY_CINEMA_UPDATE_V1\n'),bytes]),privateKey).toString('base64')});}
async function settled(updates:DesktopUpdates){for(let i=0;i<100&&updates.status().phase==='downloading';i++)await new Promise(resolve=>setTimeout(resolve,10));return updates.status();}
describe('Authenticated application updates',()=>{
 it('compares numeric prereleases and stable promotion without downgrading',()=>{expect(compareVersions('1.3.0-beta.10','1.3.0-beta.2')).toBeGreaterThan(0);expect(compareVersions('1.3.0','1.3.0-rc.9')).toBeGreaterThan(0);expect(compareVersions('1.2.0','1.3.0-alpha.1')).toBeLessThan(0);expect(()=>compareVersions('bad','1.2.0')).toThrow();});
 it('validates all actual signed bootstrap feeds against the bundled public certificate',()=>{for(const [platform,channel] of [['windows','stable'],['windows','preview'],['tv','preview']] as const){const data=readFileSync(join(process.cwd(),`updates/${platform}-${channel}.json`),'utf8');expect(verifyUpdateEnvelope(data,platform,channel).platform).toBe(platform);}});
 it('rejects tampered contents, wrong signing keys and wrong channels',()=>{const valid=JSON.parse(envelope());valid.payload=Buffer.from(JSON.stringify({...manifest(),version:'9.9.9'})).toString('base64');expect(()=>verifyUpdateEnvelope(JSON.stringify(valid),'windows','stable',publicKey)).toThrow(/签名/);expect(()=>verifyUpdateEnvelope(envelope(),'windows','preview',publicKey)).toThrow(/渠道/);expect(()=>verifyUpdateEnvelope(envelope(),'windows','stable')).toThrow(/签名/);});
 it('rejects even correctly signed assets outside the release repository',()=>{const value=manifest();value.asset.url='https://untrusted.invalid/installer.exe';expect(()=>verifyUpdateEnvelope(envelope(value),'windows','stable',publicKey)).toThrow(/来源/);});
 it('supports prefixes and templates while rejecting credentials and insecure mirrors',()=>{expect(mirrorUrl('https://github.com/a','https://mirror.test/')).toBe('https://mirror.test/https://github.com/a');expect(mirrorUrl('https://github.com/a','https://mirror.test/?url={url}')).toContain('https%3A%2F%2Fgithub.com%2Fa');for(const value of ['http://mirror.test','https://user:pass@mirror.test/','file:///tmp/'])expect(()=>validateMirror(value)).toThrow();});
 it('falls back for both manifest and installer, carries no account headers, and revalidates before launch',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'mycinema-updates-'));const requests:Array<{url:string;options?:RequestInit}>=[];
  const fetcher=vi.fn(async(input:RequestInfo|URL,options?:RequestInit)=>{const url=String(input);requests.push({url,options});if(!url.startsWith('https://mirror.test/'))throw new TypeError('controlled origin failure');return new Response(url.includes('windows-stable.json')?envelope():binary);});
  const updates=new DesktopUpdates('1.2.0',folder,fetcher as typeof fetch,publicKey);
  try{updates.configure({mirror:'https://mirror.test/'});expect((await updates.check()).phase).toBe('available');updates.download();expect((await settled(updates)).phase).toBe('ready');const path=await updates.verifiedInstaller();expect(readFileSync(path)).toEqual(binary);expect(requests.length).toBe(4);for(const request of requests){expect(request.options?.credentials).toBe('omit');expect(request.options?.headers).toBeUndefined();}writeFileSync(path,'tampered');await expect(updates.verifiedInstaller()).rejects.toThrow(/变化/);}finally{updates.close();rmSync(folder,{recursive:true,force:true});}
 });
 it('removes incomplete or mismatched downloads and never makes them installable',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'mycinema-bad-update-'));const fetcher=vi.fn(async(input:RequestInfo|URL)=>new Response(String(input).includes('.json')?envelope():Buffer.alloc(binary.length,0)));
  const updates=new DesktopUpdates('1.2.0',folder,fetcher as typeof fetch,publicKey);
  try{await updates.check();updates.download();expect((await settled(updates)).phase).toBe('error');expect(existsSync(join(folder,'updates',manifest().asset.name+'.part'))).toBe(false);await expect(updates.verifiedInstaller()).rejects.toThrow();}finally{updates.close();rmSync(folder,{recursive:true,force:true});}
 });
 it('does not offer replayed older signed versions',async()=>{const folder=mkdtempSync(join(tmpdir(),'mycinema-replay-'));const updates=new DesktopUpdates('2.0.0',folder,(async()=>new Response(envelope())) as typeof fetch,publicKey);try{expect((await updates.check()).manifest).toBeNull();expect(updates.download().phase).toBe('idle');}finally{updates.close();rmSync(folder,{recursive:true,force:true});}});
});

describe('Built-in update mirrors',()=>{
 it('contains only explicit HTTPS presets and builds origin-first fallbacks',async()=>{const {UPDATE_MIRRORS,updateSources}=await import('../src/shared/updates');expect(UPDATE_MIRRORS.map(m=>m.url)).toEqual(['https://gh-proxy.com/','https://ghfast.top/','https://ghproxy.net/']);const original='https://raw.githubusercontent.com/StQuasimodo/Media-Library/main/updates/windows-preview.json';expect(updateSources(original,'auto')).toEqual([original,...UPDATE_MIRRORS.map(m=>m.url+original)]);expect(updateSources(original,'')).toEqual([original]);expect(updateSources(original,UPDATE_MIRRORS[1].url)).toEqual([original,UPDATE_MIRRORS[1].url+original]);});
 it('tries the next preset after origin failure or forged manifest and preserves explicit opt-out',async()=>{const folder=mkdtempSync(join(tmpdir(),'mycinema-presets-'));const calls:string[]=[];const updates=new DesktopUpdates('1.2.0',folder,(async(input:RequestInfo|URL)=>{const url=String(input);calls.push(url);if(url.startsWith('https://raw.'))throw new TypeError('origin unavailable');if(url.startsWith('https://gh-proxy.com/'))return new Response('{"payload":"Zm9yZ2Vk","signature":"YmFk"}');return new Response(envelope());}) as typeof fetch,publicKey);try{expect(updates.status().preferences.mirror).toBe('auto');expect((await updates.check()).phase).toBe('available');expect(calls).toHaveLength(3);expect(calls[2]).toMatch(/^https:\/\/ghfast.top\//);updates.configure({mirror:''});updates.close();const restored=new DesktopUpdates('1.2.0',folder,fetch,publicKey);expect(restored.status().preferences.mirror).toBe('');restored.close();}finally{updates.close();rmSync(folder,{recursive:true,force:true});}});
});

describe('Saving mirrors during update checks',()=>{
 it('saves locally without requests and clears a previous timeout even for the same source',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'mycinema-timeout-'));
  const fetcher=vi.fn(async()=>{throw new DOMException('The operation was aborted due to timeout','TimeoutError');});
  const updates=new DesktopUpdates('1.2.0',folder,fetcher as typeof fetch,publicKey);
  try{
   updates.configure({mirror:'https://mirror.test/'});expect(fetcher).not.toHaveBeenCalled();
   const failed=await updates.check();expect(failed.phase).toBe('error');expect(failed.error).toContain('检查更新连接超时');expect(failed.error).not.toContain('The operation was aborted');
   expect(fetcher).toHaveBeenCalledTimes(2);
   const saved=updates.configure({mirror:'https://mirror.test/'});
   expect(saved.phase).toBe('idle');expect(saved.error).toBeNull();expect(saved.lastChecked).toBeNull();expect(fetcher).toHaveBeenCalledTimes(2);
   const restored=new DesktopUpdates('1.2.0',folder,fetcher as typeof fetch,publicKey);
   try{expect(restored.status().preferences.mirror).toBe('https://mirror.test/');}finally{restored.close();}
  }finally{updates.close();rmSync(folder,{recursive:true,force:true});}
 });
 it.each(['success','timeout'] as const)('cancels the old check and ignores its late %s after a new check completes',async(outcome)=>{
  const folder=mkdtempSync(join(tmpdir(),'mycinema-check-race-'));
  let finish!:(response:Response)=>void,fail!:(error:Error)=>void,oldSignal:AbortSignal|undefined;
  const fetcher=vi.fn((_input:RequestInfo|URL,options?:RequestInit)=>{
   if(!oldSignal){oldSignal=options?.signal??undefined;return new Promise<Response>((resolve,reject)=>{finish=resolve;fail=reject;});}
   return Promise.resolve(new Response(envelope()));
  });
  const updates=new DesktopUpdates('1.2.0',folder,fetcher as typeof fetch,publicKey);
  try{
   const previous=updates.check();expect(oldSignal?.aborted).toBe(false);
   const saved=updates.configure({mirror:'https://ghfast.top/'});expect(saved.phase).toBe('idle');expect(oldSignal?.aborted).toBe(true);
   const next=await updates.check();expect(next.phase).toBe('available');
   if(outcome==='timeout')fail(new DOMException('The operation was aborted due to timeout','TimeoutError'));
   else finish(new Response(envelope({...manifest(),version:'9.0.0'})));
   await previous;expect(updates.status()).toEqual(next);expect(fetcher).toHaveBeenCalledTimes(2);
  }finally{updates.close();rmSync(folder,{recursive:true,force:true});}
 });
 it('cancels a previous channel check before it can offer an update from the wrong channel',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'mycinema-channel-race-'));let finish!:(response:Response)=>void;
  const updates=new DesktopUpdates('1.2.0',folder,(()=>new Promise<Response>(resolve=>{finish=resolve;})) as typeof fetch,publicKey);
  try{const previous=updates.check();updates.configure({preview:true});finish(new Response(envelope()));await previous;expect(updates.status()).toMatchObject({phase:'idle',manifest:null,error:null,preferences:{preview:true}});}
  finally{updates.close();rmSync(folder,{recursive:true,force:true});}
 });
});
