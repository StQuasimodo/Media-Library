import type { QuarkNameHint } from '../../../../src/shared/quark';

const extension = /\.(mkv|mp4|avi|mov|m4v|ts|m2ts|webm|wmv|flv|iso)$/i;
export const isVideoName = (name: string) => extension.test(name);
const genericFolder = /^(?:season[ ._-]*\d+|s\d+|第[零一二三四五六七八九十两\d]+季|电影|电视剧|movies?|tv|videos?|4k|1080p|2160p)$/i;
const chineseDigits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function episodeNumber(text: string): number | null {
  if (/^\d+$/.test(text)) return Number(text);
  if (text.includes('十')) {
    const [tens, units] = text.split('十');
    const value = (tens ? chineseDigits[tens] : 1) * 10 + (units ? chineseDigits[units] : 0);
    return Number.isFinite(value) ? value : null;
  }
  return chineseDigits[text] ?? null;
}

/** Conservative extraction for display; never asserts that a TMDB match exists. */
export function inferVideoName(filename: string, parents: string[] = []): QuarkNameHint {
  let text = filename.replace(extension, '').replace(/_/g, ' ').trim();
  let season: number | null = null;
  let episode: number | null = null;
  const serial = /(?:^|[ .-])S(\d{1,2})(?:[ .-]*E(\d{1,3}))?(?=$|[ .-])/i.exec(text) ??
    /(?:^|[ .-])(\d{1,2})x(\d{1,3})(?=$|[ .-])/i.exec(text) ??
    /第([一二三四五六七八九十两\d]{1,3})季(?:[ .-]*第([一二三四五六七八九十两\d]{1,3})集)?/.exec(text);
  if (serial) {
    season = episodeNumber(serial[1]);
    episode = serial[2] ? episodeNumber(serial[2]) : null;
    text = text.slice(0, serial.index).trim();
  } else {
    const standaloneEpisode = /(?:^|[ .-])(?:EP|E)(\d{1,3})(?:$|[ .-])/i.exec(text) ??
      /第([一二三四五六七八九十两\d]{1,3})集/.exec(text);
    if (standaloneEpisode) { episode = episodeNumber(standaloneEpisode[1]); text = text.slice(0, standaloneEpisode.index).trim(); }
  }
  if (!text || genericFolder.test(text)) {
    const seasonFolder = parents.map((part) => /^(?:season[ ._-]*|s)(\d{1,2})$/i.exec(part) ?? /^第([一二三四五六七八九十两\d]{1,3})季$/.exec(part)).findLast(Boolean);
    if (season == null && seasonFolder) season = episodeNumber(seasonFolder[1]);
    text = parents.findLast((part) => !genericFolder.test(part)) ?? '';
  }
  // Taking the last year avoids misreading titles such as 2001 / 1917.
  const years = [...text.matchAll(/(?:^|[^\d])((?:19|20)\d{2})(?=$|[^\d])/g)];
  const yearMatch = years.at(-1);
  let year: number | null = null;
  if (yearMatch) {
    const index = yearMatch.index! + yearMatch[0].indexOf(yearMatch[1]);
    if (text.slice(0, index).replace(/[\s.([\]-]/g, '').length > 0) {
      year = Number(yearMatch[1]);
      text = text.slice(0, index);
    }
  }
  text = text.replace(/(?:^|[ .\[(\-])(?:2160p|1080p|720p|4k|uhd|bluray|blu-ray|bdrip|web-dl|webrip|hdtv|x26[45]|h[ .]?26[45]|hevc|avc|remux|dts|aac|ddp|truehd|hdr|dv)(?:\b|$).*$/i, '');
  const title = text.replace(/\[[^\]]*\]/g, ' ').replace(/[.]/g, ' ').replace(/^[\s([\]-]+|[\s)\]\-]+$/g, '').replace(/\s+/g, ' ').trim();
  return { title: title || filename.replace(extension, ''), year, season, episode };
}
