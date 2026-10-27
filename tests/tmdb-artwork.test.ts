import { describe, expect, it } from 'vitest';
import { selectBackdrop, selectPoster, type TmdbImage } from '../electron/main/services/metadata/artwork';

const poster = (path: string, language: string | null): TmdbImage =>
  ({ file_path: path, iso_639_1: language, width: 1000, height: 1500, vote_average: 7, vote_count: 30 });
const background = (path: string, language: string | null = null): TmdbImage =>
  ({ file_path: path, iso_639_1: language, width: 1920, height: 1080, vote_average: 7, vote_count: 30 });

describe('影视图片筛选', () => {
  it('接受英文海报，拒绝简繁未区分的zh、繁体标签和无语言图片', () => {
    expect(selectPoster([poster('/zh.jpg', 'zh'), poster('/tw.jpg', 'zh-TW'), poster('/none.jpg', null), poster('/en.jpg', 'en')])).toBe('/en.jpg');
    expect(selectPoster([poster('/zh.jpg', 'zh'), poster('/tw.jpg', 'zh-Hant')])).toBeNull();
  });
  it('只有明确简体/大陆地区信息的中文海报才优先于英文', () => {
    expect(selectPoster([poster('/en.jpg','en'), {...poster('/cn.jpg','zh'),iso_3166_1:'CN'},
      {...poster('/tw.jpg','zh'),iso_3166_1:'TW'}, {...poster('/hk.jpg','zh'),iso_3166_1:'HK'}])).toBe('/cn.jpg');
    expect(selectPoster([poster('/hans.jpg','zh-Hans'),poster('/en.jpg','en')])).toBe('/hans.jpg');
  });
  it('排除低清、横版及无效URL海报，不因评分高而放行', () => {
    expect(selectPoster([{ ...poster('/tiny.jpg', 'en'), width: 200, height: 300 }, background('/wide.jpg', 'en'), poster('//elsewhere.jpg', 'en')])).toBeNull();
  });
  it('背景优先无字横版，排除低清、竖图、极宽裁切和低分候选', () => {
    expect(selectBackdrop([background('/english.jpg', 'en'), background('/textless.jpg')])).toBe('/textless.jpg');
    expect(selectBackdrop([{ ...background('/tiny.jpg'), width: 640, height: 360 }, poster('/portrait.jpg', 'en'),
      { ...background('/ultrawide.jpg'), width: 3000 }, { ...background('/poor.jpg'), vote_average: 2 }])).toBeNull();
  });
  it('在相近品质的横版图中稳定分配各季；单图/无图不硬凑剧照', () => {
    const gallery = [background('/b.jpg'), background('/a.jpg'), background('/a.jpg')];
    expect(selectBackdrop(gallery, 1)).toBe('/a.jpg');
    expect(selectBackdrop([...gallery].reverse(), 2)).toBe('/b.jpg');
    expect(selectBackdrop([background('/a.jpg')], 2)).toBe('/a.jpg');
    expect(selectBackdrop([], 3)).toBeNull();
  });
  it('不为区分季选明显较差的图，也不让一个10分投票压过稳定好评', () => {
    const good = { ...background('/good.jpg'), vote_average: 8, vote_count: 100 };
    const unproven = { ...background('/one-vote.jpg'), vote_average: 10, vote_count: 1 };
    expect(selectBackdrop([unproven, good], 2)).toBe('/good.jpg');
  });
  it('缺少明确背景语言及畸形数据不进入候选', () => {
    expect(selectBackdrop([{ ...background('/unknown.jpg'), iso_639_1: undefined }, background('/zh.jpg', 'zh')])).toBeNull();
    expect(selectBackdrop([null, { file_path: '/bad.jpg', width: Infinity, height: 720 }] as unknown as TmdbImage[])).toBeNull();
  });
});
