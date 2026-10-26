import { parseTmdbIdentity } from '../../../src/shared/tmdbIdentity';
import type { Film, MediaType, MetadataCandidate, MetadataSearchOptions, MetadataSearchResult } from '../../../src/shared/types';
import { AppError } from '../errors';
import type { LibraryRepository } from '../data/repository';
import type { LibraryService } from './library';
import type { TmdbProvider } from './metadata/tmdb';

/**
 * Coordinates metadata lookups. Search results are only ever returned to the
 * user for confirmation: nothing is written to the library from here.
 */
export class MetadataService {
  constructor(
    private readonly provider: TmdbProvider,
    private readonly repo: LibraryRepository,
    private readonly library: LibraryService,
  ) {}

  get hasApiKey(): boolean {
    return this.provider.configured;
  }

  async verifyApiKey(key: string): Promise<void> {
    const trimmed = key.trim();
    if (!trimmed) throw new AppError('VALIDATION', 'API Key 不能为空。');
    await this.provider.verifyKey(trimmed);
  }

  async search(options: MetadataSearchOptions): Promise<MetadataSearchResult[]> {
    const query = options.query?.trim() ?? '';
    if (query.length < 1) throw new AppError('VALIDATION', '请输入要搜索的作品名称。');
    if (query.length > 200) throw new AppError('VALIDATION', '搜索关键词过长。');
    const mediaType: MediaType | 'all' =
      options.mediaType === 'movie' || options.mediaType === 'tv' ? options.mediaType : 'all';
    const results = await this.provider.search({
      query,
      mediaType,
      year: options.year ?? null,
    });
    if (results.length === 0) {
      throw new AppError('NO_RESULTS', `没有找到与「${query}」匹配的影视资料。`);
    }
    return results;
  }

  async getCandidate(externalId: string, mediaType: MediaType): Promise<MetadataCandidate> {
    if (!parseTmdbIdentity(externalId, mediaType)) throw new AppError('VALIDATION', '影视资料标识无效。');
    if (mediaType !== 'movie' && mediaType !== 'tv') {
      throw new AppError('VALIDATION', '作品类型无效。');
    }
    return this.provider.getCandidate(externalId, mediaType);
  }

  /** Re-fetches external metadata for a stored film; personal fields stay untouched. */
  async refreshFilm(filmId: string): Promise<Film> {
    const film = this.repo.getFilm(filmId);
    if (!film) throw new AppError('NOT_FOUND', '作品不存在。');
    if (film.metadataSource !== 'tmdb' || !film.externalId) {
      throw new AppError('VALIDATION', '这部作品是手动添加的，没有可刷新的外部资料。');
    }
    const candidate = await this.provider.getCandidate(film.externalId, film.mediaType);
    return this.library.applyExternalMetadata(filmId, candidate);
  }
}
