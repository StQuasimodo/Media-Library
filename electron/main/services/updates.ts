import {createHash,createPublicKey,verify} from 'node:crypto';
import {createReadStream,createWriteStream,existsSync,mkdirSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {once} from 'node:events';
import signing from '../../../src/shared/data/update-signing.json';
import {compareVersions,validateMirror,updateSources,type UpdateManifest,type UpdatePreferences,type UpdateStatus} from '../../../src/shared/updates';

const DOMAIN=Buffer.from('MY_CINEMA_UPDATE_V1\n');
export function verifyUpdateEnvelope(body:string,platform:'windows'|'tv',channel:'stable'|'preview',certificate=signing.certificatePem):UpdateManifest {
  if(body.length>65536)throw new Error('更新说明过大。');const envelope=JSON.parse(body);
  if(typeof envelope.payload!=='string'||typeof envelope.signature!=='string'||envelope.payload.length>49152||envelope.signature.length>8192)throw new Error('更新说明无效。');
  const bytes=Buffer.from(envelope.payload,'base64');
  if(!verify('sha256',Buffer.concat([DOMAIN,bytes]),createPublicKey(certificate),Buffer.from(envelope.signature,'base64')))throw new Error('更新签名校验失败，已拒绝更新。');
  const m=JSON.parse(bytes.toString('utf8')) as UpdateManifest;
  if(m.format!==1||m.platform!==platform||m.channel!==channel||typeof m.version!=='string')throw new Error('更新渠道不匹配。');compareVersions(m.version,m.version);
  const a=m.asset;if(!a||!/^[a-f0-9]{64}$/.test(a.sha256)||!Number.isSafeInteger(a.bytes)||a.bytes<=0||a.bytes>2*1024*1024*1024||!Number.isInteger(m.versionCode)||m.versionCode<0)throw new Error('更新文件信息无效。');
  const tag=(platform==='tv'?'tv-v':'v')+m.version,base=`https://github.com/StQuasimodo/Media-Library/releases/download/${tag}/`;
  if(a.url!==base+encodeURIComponent(a.name)||!/^My-Cinema-(?:TV-)?[a-zA-Z0-9.-]+\.(exe|apk)$/.test(a.name)||!(platform==='tv'?a.name.endsWith('.apk'):a.name.endsWith('-Setup.exe'))||m.releaseUrl!==`https://github.com/StQuasimodo/Media-Library/releases/tag/${tag}`)throw new Error('更新文件来源无效。');
  return m;
}
export class DesktopUpdates {
  private state:UpdateStatus;private prefsFile:string;private directory:string;private file:string|null=null;private timer:ReturnType<typeof setTimeout>|null=null;private closed=false;private activeCheck:AbortController|null=null;
  constructor(version:string,root:string,private readonly fetcher:typeof fetch=fetch,private readonly certificate=signing.certificatePem){
    this.prefsFile=join(root,'update-preferences.json');this.directory=join(root,'updates');let prefs:Partial<UpdatePreferences>={};
    try{prefs=JSON.parse(readFileSync(this.prefsFile,'utf8'));}catch{/* First launch. */}
    let mirror='';try{mirror=validateMirror(typeof prefs.mirror==='string'?prefs.mirror:'auto');}catch{/* Invalid stored config cannot start requests. */}
    this.state={phase:'idle',currentVersion:version,manifest:null,downloadedBytes:0,error:null,lastChecked:null,preferences:{automatic:prefs.automatic!==false,mirror,preview:typeof prefs.preview==='boolean'?prefs.preview:version.includes('-')}};
  }
  status():UpdateStatus{return structuredClone(this.state);}
  configure(patch:Partial<UpdatePreferences>){
    if(this.state.phase==='downloading')throw new Error('下载期间请稍后修改更新源。');
    const p=this.state.preferences,next={...p};if(patch.automatic!==undefined){if(typeof patch.automatic!=='boolean')throw new Error('更新设置无效。');next.automatic=patch.automatic;}
    if(patch.preview!==undefined){if(typeof patch.preview!=='boolean')throw new Error('更新设置无效。');next.preview=patch.preview;}
    if(patch.mirror!==undefined){if(typeof patch.mirror!=='string')throw new Error('镜像地址无效。');next.mirror=validateMirror(patch.mirror);}
    mkdirSync(this.directory,{recursive:true});writeFileSync(this.prefsFile+'.tmp',JSON.stringify(next));renameSync(this.prefsFile+'.tmp',this.prefsFile);this.state.preferences=next;
    if(next.preview!==p.preview||patch.mirror!==undefined){const previous=this.activeCheck;this.activeCheck=null;previous?.abort();this.state.manifest=null;this.state.phase='idle';this.state.error=null;this.state.lastChecked=null;this.file=null;}return this.status();
  }
  start(){if(this.closed)return;this.timer=setTimeout(()=>{if(this.state.preferences.automatic)void this.check();this.start();},12*60*60*1000);this.timer.unref();if(this.state.preferences.automatic)void this.check();}
  close(){this.closed=true;if(this.timer)clearTimeout(this.timer);const previous=this.activeCheck;this.activeCheck=null;previous?.abort();}
  private sources(url:string){return updateSources(url,this.state.preferences.mirror);}
  async check(){
    if(this.closed||['checking','downloading'].includes(this.state.phase))return this.status();const current=new AbortController();this.activeCheck=current;this.state.phase='checking';this.state.error=null;
    const channel=this.state.preferences.preview?'preview':'stable';const url=`https://raw.githubusercontent.com/StQuasimodo/Media-Library/main/updates/windows-${channel}.json`;
    let failure='更新服务暂不可用，请检查网络或配置镜像。';
    try{for(const source of this.sources(url))try{
      if(this.activeCheck!==current)return this.status();
      const response=await this.fetcher(source,{credentials:'omit',redirect:'error',signal:AbortSignal.any([current.signal,AbortSignal.timeout(12000)]),cache:'no-store'});if(!response.ok)throw new Error('更新源请求失败。');
      const reader=response.body?.getReader();if(!reader)throw new Error('更新说明为空。');let bytes=0;const chunks:Uint8Array[]=[];
      try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>65536)throw new Error('更新说明过大。');chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});}
      const manifest=verifyUpdateEnvelope(Buffer.concat(chunks).toString('utf8'),'windows',channel,this.certificate);
      if(this.activeCheck!==current)return this.status();
      this.state.lastChecked=new Date().toISOString();this.state.manifest=compareVersions(manifest.version,this.state.currentVersion)>0?manifest:null;this.state.phase=this.state.manifest?'available':'idle';return this.status();
    }catch(error){if(this.activeCheck!==current)return this.status();failure=error instanceof Error?(error.name==='TimeoutError'?'检查更新连接超时，镜像设置不受影响。请稍后重试或切换更新来源。':error instanceof TypeError?'无法连接更新来源，请检查网络或切换镜像。':error.message):failure;}
    this.state.phase='error';this.state.error=failure;return this.status();
    }finally{if(this.activeCheck===current)this.activeCheck=null;}
  }
  download(){if(!['available','error'].includes(this.state.phase)||!this.state.manifest)return this.status();this.state.phase='downloading';this.state.downloadedBytes=0;this.state.error=null;void this.fetchPackage(this.state.manifest);return this.status();}
  private async fetchPackage(manifest:UpdateManifest){
    mkdirSync(this.directory,{recursive:true});const target=join(this.directory,manifest.asset.name),temp=target+'.part';
    for(const source of this.sources(manifest.asset.url)){
      const output=createWriteStream(temp);let streamError:Error|null=null;output.on('error',error=>{streamError=error;});
      try{
        const response=await this.fetcher(source,{credentials:'omit',redirect:'follow',signal:AbortSignal.timeout(300000),cache:'no-store'});
        if(!response.ok||!response.body||new URL(response.url||source).protocol!=='https:')throw new Error('更新包下载失败。');
        const reader=response.body.getReader(),hash=createHash('sha256');let size=0;this.state.downloadedBytes=0;
        try{for(;;){const part=await reader.read();if(part.done)break;if(this.closed)throw new Error('已停止下载。');size+=part.value.length;if(size>manifest.asset.bytes)throw new Error('更新包大小不符。');hash.update(part.value);if(streamError)throw streamError;if(!output.write(part.value))await once(output,'drain');this.state.downloadedBytes=size;}}finally{await reader.cancel().catch(()=>{});}
        if(size!==manifest.asset.bytes||hash.digest('hex')!==manifest.asset.sha256)throw new Error('更新包校验失败，已拒绝安装。');
        if(streamError)throw streamError;output.end();if(!output.closed)await once(output,'close');if(streamError)throw streamError;renameSync(temp,target);this.file=target;this.state.phase='ready';return;
      }catch{output.destroy();await new Promise<void>(resolve=>output.closed?resolve():output.once('close',()=>resolve()));rmSync(temp,{force:true});}
    }
    this.state.phase='error';this.state.error='更新包下载或签名清单校验失败，请检查镜像和网络。';
  }
  async verifiedInstaller():Promise<string>{
    if(this.state.phase!=='ready'||!this.file||!this.state.manifest||!existsSync(this.file))throw new Error('请先下载并验证更新包。');
    const hash=createHash('sha256');for await(const bytes of createReadStream(this.file))hash.update(bytes);
    if(hash.digest('hex')!==this.state.manifest.asset.sha256)throw new Error('下载文件已变化，已拒绝安装。');return this.file;
  }
}
