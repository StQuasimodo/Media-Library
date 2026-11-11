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
