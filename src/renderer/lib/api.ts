import type { CinemaApi } from '@shared/api';

declare global {
  interface Window {
    cinema: CinemaApi;
  }
}

function getApi(): CinemaApi {
  if (!window.cinema) {
    throw new Error('桌面接口不可用：请通过 My Cinema 应用启动，而不是浏览器。');
  }
  return window.cinema;
}

export const api = getApi();

/** Turns any thrown value into a readable, user-facing message. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'NO_API_KEY') {
      return '尚未配置 TMDB API Key，请到「设置」填写。';
    }
    return error.message;
  }
  return '发生了未知错误。';
}

export function errorCode(error: unknown): string {
  return error instanceof Error ? error.name : 'INTERNAL';
}
