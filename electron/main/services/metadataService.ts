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

  private disposed=false;
  private seriesPaused=false;
  private attempted=new Set<string>();
  private seriesJob: Promise<{updated:number;failed:number}> | null=null;
  dispose() { this.disposed=true; }
  resolveSeries(): Promise<{updated:number;failed:number}> {
    if(this.seriesJob)return this.seriesJob;
    if(this.disposed || this.seriesPaused || !this.hasApiKey)return Promise.resolve({updated:0,failed:0});
    const films=this.repo.listAllFilms().filter(film=>film.mediaType==='movie' && film.metadataSource==='tmdb' && film.externalId && film.series===undefined && !this.attempted.has(film.id));
    const work=async()=>{
      let updated=0,failed=0,index=0;
      const worker=async()=>{
        while(index<films.length && !this.disposed && !this.seriesPaused) {
          const film=films[index++];this.attempted.add(film.id);
          try {
            const series=await this.provider.movieSeries(film.externalId!);
            if(this.disposed)break;
            const current=this.repo.getFilm(film.id);
            if(current && current.series===undefined) {this.repo.updateFilm(film.id,{series});updated++;}
          } catch(error) {failed++;if(!(error instanceof AppError) || error.code!=='NOT_FOUND')this.seriesPaused=true;}
        }
      };
      await Promise.all([worker(),worker()]);return {updated,failed};
    };
    this.seriesJob=work().finally(()=>{this.seriesJob=null;});return this.seriesJob;
  }

  get hasApiKey(): boolean {
    return this.provider.configured;
  }

  async verifyApiKey(key: string): Promise<void> {
    const trimmed = key.trim();
    if (!trimmed) throw new AppError('VALIDATION', 'API Key 不能为空。');
    await this.provider.verifyKey(trimmed);
    this.seriesPaused=false;this.attempted.clear();
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

  async seasons(seriesId: string) {
    if (!/^\d+$/.test(seriesId)) throw new AppError('VALIDATION','剧集标识无效。');
    const list=await this.provider.seasons(seriesId);
    return {...list,seasons:list.seasons.map(season=>({...season,
      collectedFilmId:this.repo.getFilmByExternal('tmdb',`${seriesId}:season:${season.number}`,'tv')?.id ?? null}))};
  }

  /** Re-fetches external metadata for a stored film; personal fields stay untouched. */
  async refreshFilm(filmId: string, assertActive: () => void = () => {}, onImageWarning?: (message: string) => void): Promise<Film> {
    assertActive();
    const film = this.repo.getFilm(filmId);
    if (!film) throw new AppError('NOT_FOUND', '作品不存在。');
    if (film.metadataSource !== 'tmdb' || !film.externalId) {
      throw new AppError('VALIDATION', '这部作品是手动添加的，没有可刷新的外部资料。');
    }
    const candidate = await this.provider.getCandidate(film.externalId, film.mediaType);
    assertActive();
    return this.library.applyExternalMetadata(filmId, candidate, assertActive, onImageWarning);
  }
}
