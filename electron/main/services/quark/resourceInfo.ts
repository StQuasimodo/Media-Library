import type { QuarkResourceInfo } from '../../../../src/shared/quarkResource';

function parse(name: string): QuarkResourceInfo {
  const resolution=/\b(4320|2160|1440|1080|720|576|480)([pi])(?=\b|(?:24|25|30|50|60|120)\b)/i.exec(name);
  const dimensions=/\b(7680|4096|3840|2560|2048|1920|1280|720)[x×](4320|2160|1440|1080|720|576|480)\b/i.exec(name);
  const encoder=/\bx[ ._-]?(264|265)\b/i.exec(name);
  const hdr: string[]=[];
  if(/\bSDR\b/i.test(name)) hdr.push('SDR');
  if(/\b(?:DV|DoVi|Dolby[ ._-]*Vision)\b|杜比视界/i.test(name)) hdr.push('Dolby Vision');
  if(/\bHDR[ ._-]?10\+/i.test(name)) hdr.push('HDR10+');
  else if(/\bHDR[ ._-]?10\b/i.test(name)) hdr.push('HDR10');
  else if(/\bHDR\b/i.test(name)) hdr.push('HDR');
  if(/\bHLG\b/i.test(name)) hdr.push('HLG');
  const audio: string[]=[];
  if(/\bTrue[ ._-]*HD\b/i.test(name))audio.push('TrueHD');
  if(/\bAtmos\b|杜比全景声/i.test(name))audio.push('Atmos');
  if(/\bDTS[ ._-]*HD[ ._-]*MA\b/i.test(name))audio.push('DTS-HD MA');
  else if(/\bDTS[ ._-]*HD[ ._-]*HRA\b/i.test(name))audio.push('DTS-HD HRA');
  else if(/\bDTS[ ._-]*HD\b/i.test(name))audio.push('DTS-HD');
  else if(/\bDTS[ ._:-]*X\b/i.test(name))audio.push('DTS:X');
  else if(/\bDTS(?=\b|\d)/i.test(name))audio.push('DTS');
  if(/\b(?:DDP|E[ ._-]?AC[ ._-]?3)(?=\b|\d)|\bDD\+|\bDolby[ ._-]*Digital[ ._-]*Plus\b/i.test(name))audio.push('E-AC-3');
  else if(/\b(?:AC[ ._-]?3|DD)(?=\b|\d)|\bDolby[ ._-]*Digital\b/i.test(name))audio.push('AC-3');
  if(/\bAAC(?=\b|\d)/i.test(name))audio.push('AAC');
  if(/\bFLAC\b/i.test(name))audio.push('FLAC');
  if(/\bLPCM\b/i.test(name))audio.push('LPCM');
  else if(/\bPCM\b/i.test(name))audio.push('PCM');
  const channels=[...name.matchAll(/(?<![\dv])([257]\.[01](?:\.[24])?)(?!\d)/gi)].map(match=>match[1]);
  if(/\bStereo\b/i.test(name))channels.push('2.0');
  // Do not read words in a dated movie title (e.g. The English Patient) as track labels.
  const years=[...name.matchAll(/(?:^|[^\d])((?:19|20)\d{2})(?=$|[^\d])/g)];
  const lastYear=years.at(-1);
  const yearIndex=lastYear ? lastYear.index! + lastYear[0].indexOf(lastYear[1]) : -1;
  const metadataName=lastYear && yearIndex>0
    ? name.slice(yearIndex+lastYear[1].length) + ' ' + (name.slice(0,yearIndex).match(/\[[^\]]*\]/g) ?? []).join(' ')
    : name;
  const languages: string[]=[];
  if(/国语|普通话|\bMandarin\b|国英双语|国粤双语|国粤英|中英双语/i.test(metadataName))languages.push('国语');
  if(/粤语|\bCantonese\b|国粤双语|国粤英/i.test(metadataName))languages.push('粤语');
  if(/英语|\bEnglish\b|国英双语|国粤英|中英双语/i.test(metadataName))languages.push('英语');
  if(/日语|\bJapanese\b/i.test(metadataName))languages.push('日语');
  if(/韩语|\bKorean\b/i.test(metadataName))languages.push('韩语');
  const subtitles: string[]=[];
  if(/无(?:中文字幕|字幕|中字)|\bNo[ ._-]*Subs?\b/i.test(metadataName)) subtitles.push('无字幕标记');
  else {
    if(/\bCHS\b|简中|简体(?:中文)?|简繁/i.test(metadataName))subtitles.push('简体字幕');
    if(/\bCHT\b|繁中|繁体(?:中文)?|简繁/i.test(metadataName))subtitles.push('繁体字幕');
    if(/中英(?:字幕|双字)|\bCH[ST][ ._&+-]*ENG\b/i.test(metadataName))subtitles.push('中英字幕');
    else if(/中字|中文字幕/.test(metadataName) && !subtitles.length)subtitles.push('中文字幕');
    if(/\b(?:ENG[ ._-]*SUB|EN[ ._-]*SUB)\b|英文字幕/i.test(metadataName))subtitles.push('英文字幕');
    if(/内封字幕|内封中字/.test(metadataName))subtitles.push('内封字幕');
    if(/外挂字幕/.test(metadataName))subtitles.push('外挂字幕');
  }
  const editions: string[]=[];
  if(/\bREMUX\b/i.test(metadataName))editions.push('REMUX');
  if(/\bIMAX\b/i.test(metadataName))editions.push('IMAX');
  if(/\bDirector[ ._'’-]*s?[ ._-]*Cut\b|导演剪辑/i.test(metadataName))editions.push('导演剪辑版');
  if(/\bExtended\b|加长版/i.test(metadataName))editions.push('加长版');
  if(/\bUnrated\b|未分级/i.test(metadataName))editions.push('未分级版');
  if(/\bTheatrical\b|院线版/i.test(metadataName))editions.push('院线版');
  const bit=/\b(8|10|12)[ ._-]*(?:bit|bits)\b/i.exec(name);
  const frame=/\b(23[.]976|24|25|29[.]97|30|50|59[.]94|60|120)[ ._-]*fps\b/i.exec(name);
  const attachedFrame=/\b(?:4320|2160|1440|1080|720)[pi](24|25|30|50|60|120)\b/i.exec(name);
  const rate=/\b(\d+(?:\.\d+)?)[ ]*([Mm]bps|[Kk]bps|[Mm]b\/s|[Kk]b\/s)\b/.exec(name);
  const source=/\b(?:UHD[ ._-]*Blu[ ._-]?Ray|Blu[ ._-]?Ray[ ._-]*UHD)\b/i.test(name)?'UHD Blu-ray':
    /\bBlu[ ._-]?Ray\b|蓝光原盘|蓝光/i.test(name)?'Blu-ray':/\bWEB[ ._-]*DL\b/i.test(name)?'WEB-DL':
    /\bWEB[ ._-]*Rip\b/i.test(name)?'WEBRip':/\bHDTV\b/i.test(name)?'HDTV':
    /\bBD[ ._-]*Rip\b/i.test(name)?'BDRip':/\bDVD(?:Rip)?\b/i.test(name)?'DVD':null;
  return {
    resolution:resolution?`${resolution[1]}${resolution[2].toLowerCase()}`:dimensions?`${dimensions[1]}×${dimensions[2]}`:/\b8K\b/i.test(name)?'4320p':/\b4K\b/i.test(name)?'2160p':/\b2K\b/i.test(name)?'2K':null,
    source,
    videoCodec:/\b(?:HEVC|H[ ._-]?265|x[ ._-]?265)\b/i.test(name)?'H.265 / HEVC':
      /\b(?:AVC|H[ ._-]?264|x[ ._-]?264|Hi10P)\b/i.test(name)?'H.264 / AVC':/\bAV1\b/i.test(name)?'AV1':
      /\bVP9\b/i.test(name)?'VP9':/\bVC[ ._-]?1\b/i.test(name)?'VC-1':/\bMPEG[ ._-]?2\b/i.test(name)?'MPEG-2':null,
    encoder:encoder?`x${encoder[1]}`:null,bitDepth:bit?Number(bit[1]):/\bHi10P\b/i.test(name)?10:null,hdr,
    audioCodecs:audio,audioChannels:[...new Set(channels)],audioLanguages:languages,subtitles,editions,
    frameRate:frame?`${frame[1]} fps`:attachedFrame?`${attachedFrame[1]} fps`:null,
    bitRate:rate?`${rate[1]} ${/^[Mm]/.test(rate[2])?'Mbps':'kbps'}`:null,container:null,
  };
}

/** Per-field precedence: filename, nearest parent, then outer parent. No video download/probing. */
export function inferResourceInfo(filename: string, parents: string[]=[]): QuarkResourceInfo {
  const result=parse(filename);
  for (const parent of [...parents].reverse()) {
    const inherited=parse(parent);
    for (const key of Object.keys(result) as Array<keyof QuarkResourceInfo>) {
      const current=result[key];
      if (current===null || (Array.isArray(current) && !current.length)) {
        // Both records use the same field types; never mix or infer incompatible fields.
        Object.assign(result,{[key]:inherited[key]});
      }
    }
  }
  result.container=/\.(mkv|mp4|avi|mov|m4v|ts|m2ts|webm|wmv|flv|iso)$/i.exec(filename)?.[1].toUpperCase() ?? null;
  if ((result.encoder==='x265' && result.videoCodec!=='H.265 / HEVC') || (result.encoder==='x264' && result.videoCodec!=='H.264 / AVC')) result.encoder=null;
  return result;
}
