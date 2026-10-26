import type {
  MediaType,
  MetadataCandidate,
  MetadataLanguage,
  MetadataSearchOptions,
  MetadataSearchResult,
  MetadataSeasonList,
  FilmSeries,
} from '../../../../src/shared/types';
import { AppError } from '../../errors';
import { parseTmdbIdentity } from '../../../../src/shared/tmdbIdentity';
import type { Logger } from '../logger';

const POSTER_BASE = 'https://image.tmdb.org/t/p/w500';
const BACKDROP_BASE = 'https://image.tmdb.org/t/p/w1280';

/**
 * TMDB answers on both hostnames; some networks resolve one of them to a black
 * hole, so the next host is tried when a connection fails outright.
 */
const DEFAULT_HOSTS = ['https://api.tmdb.org/3', 'https://api.themoviedb.org/3'];

export interface TmdbConfig {
  apiKey: string;
  language: MetadataLanguage;
}

export interface TmdbProviderOptions {
  getConfig: () => TmdbConfig | null;
  fetchImpl?: typeof fetch;
  logger?: Logger;
  timeoutMs?: number;
  hosts?: string[];
}

interface RawSearchItem {
  id?: number;
  media_type?: string;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  poster_path?: string | null;
  popularity?: number;
}

interface RawSearchResponse {
  page?: number;
  results?: RawSearchItem[];
  total_results?: number;
  status_code?: number;
  status_message?: string;
}

interface RawDetail {
  belongs_to_collection?: { id?: number; name?: string } | null;
  seasons?: Array<{ season_number?: number; name?: string; air_date?: string; episode_count?: number; overview?: string; poster_path?: string | null }>;
  id?: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  tagline?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  runtime?: number | null;
  episode_run_time?: number[];
  genres?: Array<{ id?: number; name?: string }>;
  original_language?: string;
  popularity?: number;
  status_code?: number;
  status_message?: string;
}

function parseYear(date: string | undefined): number | null {
  if (!date) return null;
  const match = /^(\d{4})/.exec(date);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  return Number.isFinite(year) ? year : null;
}

function posterUrl(path: string | null | undefined): string | null {
  return path ? `${POSTER_BASE}${path}` : null;
}

function backdropUrl(path: string | null | undefined): string | null {
  return path ? `${BACKDROP_BASE}${path}` : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export class TmdbProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly hosts: string[];
  private preferredHost: string | null = null;
  private readonly logger?: Logger;

  constructor(private readonly options: TmdbProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 12_000;
    this.hosts = options.hosts ?? DEFAULT_HOSTS;
    this.logger = options.logger;
  }

  get configured(): boolean {
    const config = this.options.getConfig();
    return Boolean(config?.apiKey);
  }

  /** Validates the stored key with a cheap authenticated call. */
  async verifyKey(apiKey: string, language: MetadataLanguage = 'zh-CN'): Promise<void> {
    await this.request<RawSearchResponse>('/configuration', { apiKey, language });
  }

  async search(options: MetadataSearchOptions): Promise<MetadataSearchResult[]> {
    const query = options.query.trim();
    if (!query) return [];

    const config = this.requireConfig();
    const wantsAll = options.mediaType === 'all';
    const path = wantsAll ? '/search/multi' : `/search/${options.mediaType}`;
    const params: Record<string, string> = {
      query,
      language: config.language,
      include_adult: 'false',
    };
    if (options.year) {
      if (options.mediaType === 'tv') params.first_air_date_year = String(options.year);
      else params.year = String(options.year);
    }

    const payload = await this.request<RawSearchResponse>(
      path,
      { apiKey: config.apiKey, language: config.language },
      params,
    );

    const items = Array.isArray(payload.results) ? payload.results : [];
    const results: MetadataSearchResult[] = [];
    for (const item of items) {
      if (typeof item.id !== 'number') continue;
      const mediaType = wantsAll ? item.media_type : options.mediaType;
      if (mediaType !== 'movie' && mediaType !== 'tv') continue;
      const title = (mediaType === 'movie' ? item.title : item.name) ?? item.title ?? item.name;
      if (!title) continue;
      results.push({
        source: 'tmdb',
        externalId: String(item.id),
        mediaType,
        title,
        originalTitle: (mediaType === 'movie' ? item.original_title : item.original_name) ?? null,
        year: parseYear(mediaType === 'movie' ? item.release_date : item.first_air_date),
        overview: item.overview?.trim() ? item.overview.trim() : null,
        posterUrl: posterUrl(item.poster_path),
        popularity: typeof item.popularity === 'number' ? item.popularity : 0,
      });
    }

    results.sort((a, b) => b.popularity - a.popularity);
    return results;
  }

  private collections = new Map<string, Promise<Array<{id:number;release_date?:string}>>>();
  async movieSeries(id: string): Promise<FilmSeries | null> {
    if (!/^\d+$/.test(id)) throw new AppError('VALIDATION','电影标识无效。');
    const config=this.requireConfig();
    const detail=await this.request<RawDetail>(`/movie/${id}`,config);
    return this.seriesFromMovie(id,detail,config);
  }
  private async seriesFromMovie(id: string, detail: RawDetail, config: TmdbConfig): Promise<FilmSeries | null> {
    const collection=detail.belongs_to_collection;
    if (!collection || typeof collection.id!=='number' || !Number.isSafeInteger(collection.id) || collection.id<=0 || !collection.name) return null;
    const key=String(collection.id);
    let pending=this.collections.get(key);
    if (!pending) {
      pending=this.request<{parts?:Array<{id:number;release_date?:string}>}>(`/collection/${key}`,config)
        .then(payload=>(payload.parts ?? []).filter(part=>Number.isInteger(part.id))
          .sort((a,b)=>(a.release_date || '9999').localeCompare(b.release_date || '9999') || a.id-b.id));
      this.collections.set(key,pending);
    }
    try {
      const parts=await pending;const index=parts.findIndex(part=>String(part.id)===id);
      return {key:`tmdb:collection:${key}`,title:collection.name,order:index<0?null:index+1};
    } catch { this.collections.delete(key);return {key:`tmdb:collection:${key}`,title:collection.name,order:null}; }
  }

  async seasons(seriesId: string): Promise<MetadataSeasonList> {
    if (!/^\d+$/.test(seriesId)) throw new AppError('VALIDATION','剧集标识无效。');
    const payload=await this.request<RawDetail>(`/tv/${seriesId}`,this.requireConfig());
    if (!payload.name || !Array.isArray(payload.seasons)) throw new AppError('BAD_RESPONSE','TMDB 未返回有效的季列表，请重试或手动建档。');
    const seen=new Set<number>();
    const seasons=payload.seasons.flatMap(season=>{
      const number=season.season_number;
      if (typeof number !== 'number' || !Number.isInteger(number) || number < 0 || number > 9999 || seen.has(number)) return [];
      seen.add(number);
      return [{number,name:season.name?.trim() || (number===0?'特别篇':`第${number}季`),
        year:parseYear(season.air_date),episodeCount:Number.isInteger(season.episode_count) && season.episode_count!>=0 ? season.episode_count! : null,
        overview:season.overview?.trim() || null,posterUrl:posterUrl(season.poster_path)}];
    }).sort((a,b)=>a.number-b.number);
    return {seriesId,title:payload.name,seasons};
  }

  async getCandidate(externalId: string, mediaType: MediaType): Promise<MetadataCandidate> {
    const config = this.requireConfig();
    const identity = parseTmdbIdentity(externalId, mediaType);
    if (!identity) throw new AppError('VALIDATION', '影视资料标识无效。');
    if (identity.season !== null) {
      const series = await this.fetchCandidate(identity.id, 'tv', config.apiKey, config.language);
      const path = `/tv/${identity.id}/season/${identity.season}`;
      type Season = { season_number?: number; air_date?: string; overview?: string; poster_path?: string | null; episodes?: Array<{ runtime?: number; still_path?: string | null }> };
      const season = await this.request<Season>(path, config);
      if (season.season_number !== identity.season) throw new AppError('BAD_RESPONSE', 'TMDB 季资料不完整，请手动建档或重试。');
      let overview = season.overview?.trim() ?? '';
      if (!overview && config.language !== 'en-US') {
        try { overview = (await this.request<Season>(path, { ...config, language: 'en-US' })).overview?.trim() ?? ''; }
        catch (error) { this.logger?.warn(`TMDB season overview fallback failed: ${String(error)}`); }
      }
      const label = identity.season === 0 ? '特别篇' : `第${identity.season}季`;
      // TMDB seasons have posters, but no season-level backdrop. Use a still
      // from this season instead of borrowing the same whole-show artwork.
      const still = season.episodes?.find(episode => typeof episode.still_path === 'string' && episode.still_path.trim())?.still_path;
      return { ...series, externalId, title: `${series.title} · ${label}`,
        originalTitle: series.originalTitle ? `${series.originalTitle} · ${label}` : null,
        year: parseYear(season.air_date), overview: overview || null,
        posterUrl: posterUrl(season.poster_path),
        backdropUrl: backdropUrl(still),
        runtime: season.episodes?.find(episode => typeof episode.runtime === 'number' && episode.runtime > 0)?.runtime ?? series.runtime };
    }
    return this.fetchCandidate(externalId, mediaType, config.apiKey, config.language);
  }

  private async fetchCandidate(
    externalId: string,
    mediaType: MediaType,
    apiKey: string,
    language: MetadataLanguage,
  ): Promise<MetadataCandidate> {
    const payload = await this.request<RawDetail>(
      `/${mediaType}/${encodeURIComponent(externalId)}`,
      { apiKey, language },
    );

    let overview = payload.overview?.trim() ?? '';
    if (!overview && language !== 'en-US') {
      // A missing localised synopsis is common; fall back once rather than
      // showing an empty detail page for a film that does have a description.
      try {
        const fallback = await this.request<RawDetail>(
          `/${mediaType}/${encodeURIComponent(externalId)}`,
          { apiKey, language: 'en-US' },
        );
        overview = fallback.overview?.trim() ?? '';
      } catch (error) {
        this.logger?.warn(`TMDB overview fallback failed: ${String(error)}`);
      }
    }

    const title = (mediaType === 'movie' ? payload.title : payload.name) ?? null;
    if (!title) throw new AppError('BAD_RESPONSE', '影视资料返回内容不完整。');

    const runtime =
      mediaType === 'movie'
        ? typeof payload.runtime === 'number'
          ? payload.runtime
          : null
        : Array.isArray(payload.episode_run_time) && payload.episode_run_time.length > 0
          ? payload.episode_run_time[0]
          : null;

    return {
      source: 'tmdb',
      series: mediaType === 'movie' ? await this.seriesFromMovie(externalId,payload,{apiKey,language}) : undefined,
      externalId,
      mediaType,
      title,
      originalTitle:
        (mediaType === 'movie' ? payload.original_title : payload.original_name) ?? null,
      year: parseYear(mediaType === 'movie' ? payload.release_date : payload.first_air_date),
      overview: overview || null,
      posterUrl: posterUrl(payload.poster_path),
      backdropUrl: backdropUrl(payload.backdrop_path),
      tagline: payload.tagline?.trim() ? payload.tagline.trim() : null,
      runtime: runtime && runtime > 0 ? runtime : null,
      genres: Array.isArray(payload.genres)
        ? payload.genres
            .map((genre) => genre?.name)
            .filter((name): name is string => typeof name === 'string' && name.length > 0)
        : [],
      originalLanguage: payload.original_language ?? null,
      popularity: typeof payload.popularity === 'number' ? payload.popularity : 0,
    };
  }

  private requireConfig(): TmdbConfig {
    const config = this.options.getConfig();
    if (!config || !config.apiKey) {
      throw new AppError('NO_API_KEY', '尚未配置 TMDB API Key。请到「设置」填写后再搜索。');
    }
    return config;
  }

  private buildUrl(host: string, path: string, params: Record<string, string>): string {
    const search = new URLSearchParams(params);
    return `${host}${path}?${search.toString()}`;
  }

  private headersFor(apiKey: string): Record<string, string> {
    // v4 read tokens are JWTs; v3 keys go in the query string.
    if (apiKey.startsWith('eyJ')) {
      return { Authorization: `Bearer ${apiKey}`, accept: 'application/json' };
    }
    return { accept: 'application/json' };
  }

  private async request<T>(
    path: string,
    auth: { apiKey: string; language: MetadataLanguage },
    extraParams: Record<string, string> = {},
  ): Promise<T> {
    const isBearer = auth.apiKey.startsWith('eyJ');
    const params: Record<string, string> = {
      language: auth.language,
      ...extraParams,
    };
    if (!isBearer) params.api_key = auth.apiKey;

    const hosts = this.preferredHost
      ? [this.preferredHost, ...this.hosts.filter((host) => host !== this.preferredHost)]
      : this.hosts;

    let lastNetworkError: unknown = null;
    for (const host of hosts) {
      const url = this.buildUrl(host, path, params);
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          headers: this.headersFor(auth.apiKey),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        lastNetworkError = error;
        const name = error instanceof Error ? error.name : '';
        this.logger?.warn(`TMDB request failed on ${host}: ${name}`);
        continue;
      }

      this.preferredHost = host;
      return this.parseResponse<T>(response, path);
    }

    if (lastNetworkError instanceof Error && lastNetworkError.name === 'TimeoutError') {
      throw new AppError('TIMEOUT', '连接 TMDB 超时，请检查网络后重试。');
    }
    if (lastNetworkError instanceof Error && lastNetworkError.name === 'AbortError') {
      throw new AppError('TIMEOUT', '连接 TMDB 超时，请检查网络后重试。');
    }
    throw new AppError('NETWORK', '无法连接 TMDB，请检查网络连接后重试。');
  }

  private async parseResponse<T>(response: Response, path: string): Promise<T> {
    if (response.status === 401) {
      throw new AppError('INVALID_API_KEY', 'TMDB API Key 无效，请到「设置」更新。');
    }
    if (response.status === 429) {
      throw new AppError('RATE_LIMITED', 'TMDB 请求过于频繁，请稍后再试。');
    }
    if (response.status === 404) {
      throw new AppError('NOT_FOUND', '在 TMDB 上没有找到这条资料。');
    }
    if (!response.ok) {
      throw new AppError('BAD_RESPONSE', `TMDB 返回了错误（HTTP ${response.status}）。`);
    }
    try {
      const json: unknown = await response.json();
      if (isRecord(json) && typeof json.success === 'boolean' && json.success === false) {
        const message = typeof json.status_message === 'string' ? json.status_message : '请求失败';
        throw new AppError('BAD_RESPONSE', `TMDB 拒绝了请求：${message}`);
      }
      return json as T;
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger?.error(`TMDB response could not be parsed (${path})`, error);
      throw new AppError('BAD_RESPONSE', 'TMDB 返回内容无法解析。');
    }
  }
}
