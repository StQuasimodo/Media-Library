import { expect,it } from 'vitest';
import { inferResourceInfo } from '../electron/main/services/quark/resourceInfo';
import { resourceInfoLabels } from '../src/shared/quarkResource';
it('识别UHD原盘重封装、HEVC、双HDR标记及无损全景声音轨',()=>{
  expect(inferResourceInfo('The.Matrix.1999.UHD.BluRay.2160p.HEVC.REMUX.TrueHD.Atmos.7.1.DV.HDR10.mkv')).toMatchObject({
    resolution:'2160p',source:'UHD Blu-ray',videoCodec:'H.265 / HEVC',encoder:null,hdr:['Dolby Vision','HDR10'],
    audioCodecs:['TrueHD','Atmos'],audioChannels:['7.1'],editions:['REMUX'],container:'MKV',
  });
});
it('识别AV1、HDR10+、位深、帧率、显式码率和AAC声道',()=>{
  expect(inferResourceInfo('Movie.1080p.WEB-DL.AV1.HDR10+.10bit.60fps.12Mbps.AAC2.0.mp4')).toMatchObject({
    resolution:'1080p',source:'WEB-DL',videoCodec:'AV1',bitDepth:10,hdr:['HDR10+'],
    frameRate:'60 fps',bitRate:'12 Mbps',audioCodecs:['AAC'],audioChannels:['2.0'],container:'MP4',
  });
});
it('识别尺寸、交错扫描、附带帧率和DTS-HD MA，避免重复泛化为DTS',()=>{
  expect(inferResourceInfo('Movie.1920x1080.MPEG2.DTS-HD.MA.5.1.mkv')).toMatchObject({resolution:'1920×1080',videoCodec:'MPEG-2',audioCodecs:['DTS-HD MA'],audioChannels:['5.1']});
  expect(inferResourceInfo('Movie.1080p60.H264.mp4')).toMatchObject({resolution:'1080p',frameRate:'60 fps',videoCodec:'H.264 / AVC'});
  expect(inferResourceInfo('Movie.1080i.HDTV.VC-1.ts')).toMatchObject({resolution:'1080i',source:'HDTV',videoCodec:'VC-1'});
});
it('文件标记优先于目录，不把SDR/8-bit/x264覆盖为DV/10-bit/x265',()=>{
  expect(inferResourceInfo('Movie.1080p.WEB-DL.x264.8bit.SDR.DDP2.0.mkv',['4K.BluRay.x265.10bit.DV.TrueHD.Atmos.7.1'])).toMatchObject({
    resolution:'1080p',source:'WEB-DL',videoCodec:'H.264 / AVC',encoder:'x264',bitDepth:8,hdr:['SDR'],audioCodecs:['E-AC-3'],audioChannels:['2.0'],
  });
  expect(inferResourceInfo('Movie.HEVC.mkv',['1080p.x264'])).toMatchObject({resolution:'1080p',videoCodec:'H.265 / HEVC',encoder:null});
});
it('逐字段继承最近的目录信息，容器始终取自视频自身扩展名',()=>{
  expect(inferResourceInfo('S01E01.mkv',['4K.BluRay.HEVC','Dark.2017.1080p.WEB-DL.x265.10bit.DDP5.1','Season 1'])).toMatchObject({
    resolution:'1080p',source:'WEB-DL',encoder:'x265',bitDepth:10,audioCodecs:['E-AC-3'],audioChannels:['5.1'],container:'MKV',
  });
});
it('区分语言与字幕标记，不把中英双字当作双语音轨',()=>{
  expect(inferResourceInfo('Movie.国粤双语.简繁中字.mkv')).toMatchObject({audioLanguages:['国语','粤语'],subtitles:['简体字幕','繁体字幕']});
  expect(inferResourceInfo('Movie.中英双字.内封字幕.mkv')).toMatchObject({audioLanguages:[],subtitles:['中英字幕','内封字幕']});
  expect(inferResourceInfo('Movie.国英双语.ENGSUB.mkv')).toMatchObject({audioLanguages:['国语','英语'],subtitles:['英文字幕']});
  expect(inferResourceInfo('Movie.No.Subs.mkv',['中字'])).toMatchObject({subtitles:['无字幕标记']});
});
it('识别剪辑版本、IMAX与编码器，不从版本号误判音频声道',()=>{
  expect(inferResourceInfo("Movie.Director's.Cut.IMAX.x265.Extended.UNRATED.mkv")).toMatchObject({editions:['IMAX','导演剪辑版','加长版','未分级版'],encoder:'x265'});
  expect(inferResourceInfo('Movie.v2.0.mkv').audioChannels).toEqual([]);
});
it('无标记时保留未知，不猜测画质、码率和编码',()=>{
  const info=inferResourceInfo('未知电影.2024.mkv');
  expect(info).toMatchObject({resolution:null,videoCodec:null,bitDepth:null,bitRate:null,audioCodecs:[],hdr:[],subtitles:[]});
  expect(resourceInfoLabels(info)).toEqual(['MKV']);
});

it('不把带年份片名中的语言或剪辑词误当资源标记',()=>{
  expect(inferResourceInfo('The.English.Patient.1996.1080p.mkv').audioLanguages).toEqual([]);
  expect(inferResourceInfo('The.English.Patient.1996.English.DTS.mkv').audioLanguages).toEqual(['英语']);
});
