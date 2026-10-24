// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeroBackdrop } from '../src/renderer/components/HeroBackdrop';
import { PosterImage } from '../src/renderer/components/PosterImage';

class PendingImage {
  static all: PendingImage[] = [];
  src = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  decode = vi.fn(async () => {});
  constructor() { PendingImage.all.push(this); }
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('Image', PendingImage);
  document.documentElement.dataset.motion = 'full';
  PendingImage.all = [];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete document.documentElement.dataset.motion;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function hero(src: string | null, posterSrc: string | null = null) {
  await act(async () => root.render(createElement(HeroBackdrop, { src, posterSrc })));
}
async function loaded(image = PendingImage.all.at(-1)!) {
  await act(async () => image.onload?.());
}
async function advance(ms: number) {
  await act(async () => vi.advanceTimersByTime(ms));
}
const layers = () => container.querySelectorAll<HTMLElement>('.hero-layer');
const newest = () => layers()[layers().length - 1];

describe('主视觉切换', () => {
  it('解码完成前保留当前画面，完成后才显示新背景', async () => {
    await hero('a.jpg');
    await loaded();
    await advance(460);
    await hero('b.jpg');
    const image = PendingImage.all.at(-1)!;
    let finish!: () => void;
    image.decode.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    await loaded(image);
    expect(newest().style.backgroundImage).toContain('a.jpg');
    await act(async () => finish());
    expect(newest().style.backgroundImage).toContain('b.jpg');
  });

  it('连续切换时旧定时器不会截断新一轮淡入', async () => {
    await hero('a.jpg');
    await loaded();
    await advance(460);
    await hero('b.jpg');
    await loaded();
    await advance(200);
    await hero('c.jpg');
    await loaded();
    await advance(260); // B's old deadline; C still needs 200ms.
    expect(layers()).toHaveLength(2);
    expect(newest().style.backgroundImage).toContain('c.jpg');
    await advance(200);
    expect(layers()).toHaveLength(1);
  });

  it('过期图片加载完成不会覆盖当前选择', async () => {
    await hero('slow.jpg');
    const staleLoad = PendingImage.all.at(-1)!.onload;
    await hero('current.jpg');
    await loaded();
    await act(async () => staleLoad?.());
    expect(newest().style.backgroundImage).toContain('current.jpg');
  });

  it('背景失败后尝试海报；全部失败后显示空背景', async () => {
    await hero('missing.jpg', 'poster.jpg');
    await act(async () => PendingImage.all.at(-1)!.onerror?.());
    expect(PendingImage.all.at(-1)!.src).toBe('poster.jpg');
    await loaded();
    expect(newest().style.backgroundImage).toContain('poster.jpg');
    await hero('missing2.jpg', 'missing-poster.jpg');
    await act(async () => PendingImage.all.at(-1)!.onerror?.());
    await act(async () => PendingImage.all.at(-1)!.onerror?.());
    expect(newest().dataset.empty).toBe('true');
    expect(newest().style.backgroundImage).toBe('');
  });

  it('没有背景时，切换不同海报仍会加载并过渡', async () => {
    await hero(null, 'poster-a.jpg');
    await loaded();
    await hero(null, 'poster-b.jpg');
    await loaded();
    expect(newest().style.backgroundImage).toContain('poster-b.jpg');
  });

  it('减少动效时直接替换画面，卸载后不遗留定时器', async () => {
    document.documentElement.dataset.motion = 'reduce';
    await hero('a.jpg');
    await loaded();
    await hero('b.jpg');
    await loaded();
    expect(layers()).toHaveLength(1);
    expect(newest().style.backgroundImage).toContain('b.jpg');
    await act(async () => root.render(null));
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('海报缓存失败回退', () => {
  it('路径存在但加载失败时显示作品信息；路径更新后重新尝试', async () => {
    const film = { title: '收藏作品', year: 2000, posterPath: 'poster/aa/old.png' };
    await act(async () => root.render(createElement(PosterImage, { film })));
    await act(async () => container.querySelector('img')!.dispatchEvent(new Event('error')));
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('收藏作品');
    expect(container.textContent).toContain('2000');
    await act(async () => root.render(createElement(PosterImage, {
      film: { ...film, posterPath: 'poster/bb/new.png' },
    })));
    expect(container.querySelector('img')?.src).toContain('new.png');
    await act(async () => container.querySelector('img')!.dispatchEvent(new Event('load')));
    expect(container.querySelector('img')?.classList.contains('is-loaded')).toBe(true);
  });
});
