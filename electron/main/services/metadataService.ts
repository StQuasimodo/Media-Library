import { parseTmdbIdentity } from '../../../src/shared/tmdbIdentity';
import type { Film, MediaType, MetadataCandidate, MetadataSearchOptions, MetadataSearchResult } from '../../../src/shared/types';
import { AppError } from '../errors';
import type { LibraryRepository } from '../data/repository';
import type { LibraryService } from './library';
import type { TmdbProvider } from './metadata/tmdb';
import {chooseRelatedTv,relatedTvCandidate,relationWritable,titleEvidence,tvTargets,hasContinuationHint,validRelationshipHints} from '../../../src/shared/relatedTv';
import {franchise} from '../../../src/shared/franchises';

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
  private relatedAttempts=new Set<string>();private relationsPaused=false;private relationTargetsSignature='';
  private rerunSeries=false;
  private seriesJob: Promise<{updated:number;failed:number}> | null=null;
  dispose() { this.disposed=true; }
  resolveSeries(): Promise<{updated:number;failed:number}> {
    if(this.seriesJob){this.rerunSeries=true;return this.seriesJob;}
    if(this.disposed || this.seriesPaused || !this.hasApiKey)return Promise.resolve({updated:0,failed:0});
    const work=async()=>{
      const films=this.repo.listAllFilms().filter(film=>film.mediaType==='movie' && film.metadataSource==='tmdb' && film.externalId && film.series===undefined && !this.attempted.has(film.id));
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
      await Promise.all([worker(),worker()]);
      const relations=this.seriesPaused?{updated:0,failed:0}:await this.resolveRelatedTv();return {updated:updated+relations.updated,failed:failed+relations.failed};
    };
    const run=async()=>{const total={updated:0,failed:0};do{this.rerunSeries=false;const pass=await work();total.updated+=pass.updated;total.failed+=pass.failed;}while(this.rerunSeries&&!this.disposed&&!this.seriesPaused);return total;};
    this.seriesJob=run().finally(()=>{this.seriesJob=null;});return this.seriesJob;
  }

  private async resolveRelatedTv():Promise<{updated:number;failed:number}>{
    if(this.disposed||this.relationsPaused)return {updated:0,failed:0};
    const all=this.repo.listAllFilms(),targets=tvTargets(all);let updated=0,failed=0,index=0;
    const version=(films:Film[])=>JSON.stringify(films.filter(f=>f.mediaType==='tv').map(f=>[f.id,f.externalId,f.title,f.originalTitle,f.metadataUpdatedAt]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
    const snapshot=version(all),signature=JSON.stringify([targets,snapshot]),movies=all.filter(relationWritable);if(signature!==this.relationTargetsSignature||this.relatedAttempts.size>4096){this.relatedAttempts.clear();this.relationTargetsSignature=signature;}
    const worker=async()=>{while(index<movies.length&&!this.disposed&&!this.relationsPaused){const movie=movies[index++];
      if(franchise({...movie,series:movie.series?{...movie.series,relatedTv:undefined}:movie.series}))continue;
      const stored=validRelationshipHints(movie.series?.relationshipHints)?movie.series.relationshipHints:null;
      const namedTargets=targets.filter(tv=>titleEvidence(movie,tv).matches>0),candidates=namedTargets.length?namedTargets:stored&&hasContinuationHint(stored)?targets:[],key=JSON.stringify([movie.id,movie.title,movie.originalTitle,movie.metadataUpdatedAt]);
      if(this.relatedAttempts.has(key))continue;
      try{
        let related=null;
        if(candidates.length){const hints=stored??await this.provider.relationshipHints(movie.externalId!,'movie');const matches=[];
          if(hints.cast.length)for(const tv of candidates){if(this.disposed||this.relationsPaused)break;const match=relatedTvCandidate(movie,tv,hints,tv.hints??await this.provider.relationshipHints(tv.id,'tv'));if(match)matches.push(match);}related=chooseRelatedTv(matches);
        }
        if(this.disposed)return;const current=this.repo.getFilm(movie.id);if(!current||!relationWritable(current)||current.externalId!==movie.externalId||current.title!==movie.title||current.originalTitle!==movie.originalTitle||current.metadataUpdatedAt!==movie.metadataUpdatedAt)continue;
        const fresh=this.repo.listAllFilms();if(version(fresh)!==snapshot)continue;if(related&&!tvTargets(fresh).some(tv=>tv.id===related!.tvId))continue;
        this.relatedAttempts.add(key);if(JSON.stringify(current.series?.relatedTv??null)===JSON.stringify(related))continue;
        const series={...(current.series??{key:'work:'+current.id,title:current.title,order:null})};if(related)series.relatedTv=related;else delete series.relatedTv;
        this.repo.updateFilm(current.id,{series:!related&&series.key.startsWith('work:')&&series.franchise===undefined?null:series});updated++;
      }catch{failed++;this.relationsPaused=true;}
    }};await Promise.all([worker(),worker()]);return {updated,failed};
  }

  get hasApiKey(): boolean {
    return this.provider.configured;
  }

  async verifyApiKey(key: string): Promise<void> {
    const trimmed = key.trim();
    if (!trimmed) throw new AppError('VALIDATION', 'API Key 不能为空。');
    await this.provider.verifyKey(trimmed);
    this.seriesPaused=false;this.attempted.clear();this.relationsPaused=false;this.relatedAttempts.clear();this.provider.clearRelationshipHints?.();
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

  async artwork(filmId:string) {
    const film=this.repo.getFilm(filmId);
    if(!film || film.metadataSource!=='tmdb' || !film.externalId) throw new AppError('VALIDATION','此作品没有TMDB图片库。');
    return this.provider.artwork(film.externalId,film.mediaType);
  }
  async selectArtwork(filmId:string,kind:'poster'|'backdrop',path:string|null) {
    if(kind!=='poster'&&kind!=='backdrop')throw new AppError('VALIDATION','图片类型无效。');
    const film=this.repo.getFilm(filmId);if(!film?.externalId)throw new AppError('NOT_FOUND','作品不存在。');
    let url:string|null,scope:'season'|'series'|undefined;
    if(path===null) {
      const candidate=await this.provider.getCandidate(film.externalId,film.mediaType);
      if(candidate[`${kind}Selection`]==='unavailable')throw new AppError('NETWORK','图片库暂不可用，原选图保留。');
      url=candidate[`${kind}Url`];
      scope=candidate.backdropScope;
    } else {
      const choice=(await this.artwork(filmId)).find(item=>item.kind===kind&&item.path===path);
      if(!choice)throw new AppError('VALIDATION','请选择当前作品图片库中的图片。');
      url=`https://image.tmdb.org/t/p/${kind==='poster'?'w780':'w1280'}${choice.path}`;
    }
    return this.library.selectArtwork(filmId,kind,url,path!==null,scope);
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
    this.relationsPaused=false;this.relatedAttempts.clear();this.provider.clearRelationshipHints?.();
    assertActive();
    return this.library.applyExternalMetadata(filmId, candidate, assertActive, onImageWarning);
  }
}
