export interface UpdatePreferences {automatic:boolean;mirror:string;preview:boolean}
export interface UpdateManifest {format:1;platform:'windows'|'tv';channel:'stable'|'preview';version:string;versionCode:number;minSdk:number;releaseUrl:string;publishedAt:string;asset:{name:string;url:string;sha256:string;bytes:number}}
export interface UpdateStatus {phase:'idle'|'checking'|'available'|'downloading'|'ready'|'error';currentVersion:string;manifest:UpdateManifest|null;downloadedBytes:number;error:string|null;lastChecked:string|null;preferences:UpdatePreferences}
export function compareVersions(a:string,b:string):number {
  const parse=(s:string)=>{if(s.length>80)throw new Error('版本号无效。');const m=/^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/.exec(s);if(!m)throw new Error('版本号无效。');const parts=[Number(m[1]),Number(m[2]),Number(m[3]),m[4]?{alpha:0,beta:1,rc:2}[m[4] as 'alpha'|'beta'|'rc']:3,Number(m[5]??0)];if(parts.some(n=>!Number.isSafeInteger(n)))throw new Error('版本号无效。');return parts;};
  const aa=parse(a),bb=parse(b);for(let i=0;i<aa.length;i++)if(aa[i]!==bb[i])return aa[i]<bb[i]?-1:1;return 0;
}
export function validateMirror(value:string):string {
  const text=value.trim();if(!text)return '';const url=new URL(text.replace('{url}','placeholder'));
  if(text.length>2048||url.protocol!=='https:'||url.username||url.password||url.hash||(text.match(/\{url\}/g)?.length??0)>1)throw new Error('镜像须为不含账号的HTTPS地址，可使用{url}占位符。');
  return text.includes('{url}')?text:text.replace(/\/*$/,'/');
}
export function mirrorUrl(original:string,mirror:string):string {const base=validateMirror(mirror);return base.includes('{url}')?base.replace('{url}',encodeURIComponent(original)):base+original;}
