import { randomUUID } from 'node:crypto';
import type {
  AppSettings,
  CollectionEntry,
  Film,
  FilmCollection,
  FilmDetail,
  FilmPatch,
  HomePayload,
  ImportResult,
  LibraryQuery,
  LibraryStats,
  MediaResource,
  MetadataCandidate,
  ResourceInput,
  SettingsState,
  EntryPatch,
} from '../../../src/shared/types';
import {
  isAvailabilityStatus,
  isMediaType,
  isWatchStatus,
  validateAccessCode,
  validateCollectionName,
  validateHttpUrl,
  validateOptionalText,
  validateRating,
  validateTitle,
  validateYear,
} from '../../../src/shared/validation';
import { AppError } from '../errors';
import type { LibraryRepository } from '../data/repository';
import type { ImageCache } from './imageCache';

const now = () => new Date().toISOString();

const MAX_FAVORITE_REASON = 2000;
const MAX_REVIEW = 5000;
const MAX_LABEL = 40;
const MAX_NOTES = 1000;

export interface LibraryServiceOptions {
  repo: LibraryRepository;
  images: ImageCache;
  onSecret?: (secret: string | null | undefined) => void;
}

export class LibraryService {
  private readonly repo: LibraryRepository;
  private readonly images: ImageCache;
  private readonly onSecret: (secret: string | null | undefined) => void;

  constructor(options: LibraryServiceOptions) {
    this.repo = options.repo;
    this.images = options.images;
    this.onSecret = options.onSecret ?? (() => {});
  }

  /* ---------------------------------------------------------------- */
  /* Reads                                                             */
  /* ---------------------------------------------------------------- */

  getHome(): HomePayload {
    const entries = this.repo.listEntries({ sort: 'collected_desc' });
    const featured =
      entries.find((entry) => entry.film.backdropPath) ??
      entries.find((entry) => entry.film.posterPath) ??
      entries[0] ??
      null;

    const recent = entries.slice(0, 12);
    const collections = this.repo.listCollections();
    const stats = this.getStats();
    return {
      featured,
      recent,
      wantEntries: entries.filter((entry) => entry.watchStatus === 'want').slice(0, 6),
      collections,
      wantCount: stats.wantFilms,
      stats,
    };
  }

  getStats(): LibraryStats {
    const statusCounts = this.repo.countByStatus();
    const collections = this.repo.listCollections();
    return {
      totalFilms: statusCounts.total,
      watchedFilms: statusCounts.watched ?? 0,
      watchingFilms: statusCounts.watching ?? 0,
      wantFilms: statusCounts.want ?? 0,
      collectionCount: collections.length,
      resourceCount: this.repo.countResources(),
    };
  }

  listEntries(query: LibraryQuery): CollectionEntry[] {
    return this.repo.listEntries(query);
  }

  listYears(): number[] {
    return this.repo.listFilmYears();
  }

  getFilmDetail(filmId: string): FilmDetail {
    const entry = this.repo.getEntryByFilmId(filmId);
    if (!entry) throw new AppError('NOT_FOUND', '这部作品不在收藏库中。');
    const film = entry.film;
    return {
      film,
      entry,
      collections: this.repo
        .listCollections()
        .filter((collection) => entry.collectionIds.includes(collection.id)),
      resources: this.repo.listResources(film.id),
    };
  }

  listCollections(): FilmCollection[] {
    return this.repo.listCollections();
  }

  getCollectionWithEntries(collectionId: string): {
    collection: FilmCollection;
    entries: CollectionEntry[];
  } {
    const collection = this.repo.getCollection(collectionId);
    if (!collection) throw new AppError('NOT_FOUND', '专题不存在或已被删除。');
    return { collection, entries: this.repo.listEntriesInCollection(collectionId) };
  }

  listResources(filmId: string): MediaResource[] {
    return this.repo.listResources(filmId);
  }

  getSettings(schemaVersion: number, appVersion: string, dataDirectory: string): SettingsState {
    return {
      settings: this.repo.getSettings(),
      hasMetadataApiKey: false,
      metadataCredentialState: 'missing',
      dataDirectory,
      appVersion,
      schemaVersion,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Writes: films & entries                                           */
  /* ---------------------------------------------------------------- */

  createManualFilm(input: {
    title: string;
    originalTitle?: string | null;
    year?: number | null;
    overview?: string | null;
    mediaType?: string;
    runtime?: number | null;
    genres?: string[];
    entry?: EntryPatch;
  }): FilmDetail {
    const title = validateTitle(input.title);
    if (!title.ok) throw new AppError('VALIDATION', title.message);
    const year = validateYear(input.year ?? null);
    if (!year.ok) throw new AppError('VALIDATION', year.message);
    const overview = validateOptionalText(input.overview, MAX_REVIEW, '简介');
    if (!overview.ok) throw new AppError('VALIDATION', overview.message);
    const mediaType = input.mediaType ?? 'movie';
    if (!isMediaType(mediaType)) throw new AppError('VALIDATION', '作品类型无效。');

    const timestamp = now();
    const film: Film = {
      id: randomUUID(),
      title: title.value,
      originalTitle: input.originalTitle?.trim() || null,
      year: year.value,
      overview: overview.value,
      tagline: null,
      posterPath: null,
      backdropPath: null,
      mediaType,
      runtime: null,
      genres: Array.isArray(input.genres) ? input.genres.slice(0, 12) : [],
      originalLanguage: null,
      metadataSource: 'manual',
      externalId: null,
      metadataUpdatedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const entry = this.buildEntry(film.id, input.entry);
    this.repo.inTransaction(() => {
      this.repo.insertFilm(film);
      this.repo.insertEntry(entry);
    });
    return this.getFilmDetail(film.id);
  }

  /**
   * Imports a confirmed metadata candidate. Repeated imports of the same TMDB id
   * never create a second entry: the existing one is returned instead.
   */
  async importCandidate(
    candidate: MetadataCandidate,
    entryPatch: EntryPatch = {},
  ): Promise<ImportResult> {
    if (!candidate.externalId || !/^\d+$/.test(candidate.externalId)) {
      throw new AppError('VALIDATION', '影视资料标识无效。');
    }
    if (!isMediaType(candidate.mediaType)) {
      throw new AppError('VALIDATION', '作品类型无效。');
    }
    const title = validateTitle(candidate.title);
    if (!title.ok) throw new AppError('VALIDATION', title.message);

    const existing = this.repo.getFilmByExternal('tmdb', candidate.externalId);
    if (existing) {
      const entry = this.repo.getEntryByFilmId(existing.id);
      if (entry) {
        return { film: existing, entry, duplicate: true, imageWarning: null };
      }
      const created: CollectionEntry = this.buildEntry(existing.id, entryPatch);
      this.repo.insertEntry(created);
      return {
        film: existing,
        entry: this.repo.getEntry(created.id) ?? created,
        duplicate: true,
        imageWarning: null,
      };
    }

    let posterPath: string | null = null;
    let backdropPath: string | null = null;
    let imageWarning: string | null = null;

    if (candidate.posterUrl) {
      try {
        posterPath = await this.images.store(candidate.posterUrl, 'poster');
      } catch (error) {
        imageWarning = `海报未能缓存：${error instanceof Error ? error.message : String(error)}`;
      }
    }
    if (candidate.backdropUrl) {
      try {
        backdropPath = await this.images.store(candidate.backdropUrl, 'backdrop');
      } catch (error) {
        const message = `背景图未能缓存：${error instanceof Error ? error.message : String(error)}`;
        imageWarning = imageWarning ? `${imageWarning}；${message}` : message;
      }
    }

    const timestamp = now();
    const film: Film = {
      id: randomUUID(),
      title: title.value,
      originalTitle: candidate.originalTitle?.trim() || null,
      year: candidate.year ?? null,
      overview: candidate.overview?.trim() || null,
      tagline: candidate.tagline?.trim() || null,
      posterPath,
      backdropPath,
      mediaType: candidate.mediaType,
      runtime: candidate.runtime ?? null,
      genres: Array.isArray(candidate.genres) ? candidate.genres.filter(Boolean).slice(0, 12) : [],
      originalLanguage: candidate.originalLanguage ?? null,
      metadataSource: 'tmdb',
      externalId: candidate.externalId,
      metadataUpdatedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const entry = this.buildEntry(film.id, entryPatch);
    this.repo.inTransaction(() => {
      this.repo.insertFilm(film);
      this.repo.insertEntry(entry);
    });
    const storedEntry = this.repo.getEntry(entry.id) ?? entry;
    return { film, entry: storedEntry, duplicate: false, imageWarning };
  }

  updateFilm(filmId: string, patch: FilmPatch): Film {
    const allowed: FilmPatch = {};
    if (patch.title !== undefined) {
      const value = validateTitle(patch.title);
      if (!value.ok) throw new AppError('VALIDATION', value.message);
      allowed.title = value.value;
    }
    if (patch.originalTitle !== undefined) {
      const value = validateOptionalText(patch.originalTitle, 300, '原始标题');
      if (!value.ok) throw new AppError('VALIDATION', value.message);
      allowed.originalTitle = value.value;
    }
    if (patch.year !== undefined) {
      const value = validateYear(patch.year);
      if (!value.ok) throw new AppError('VALIDATION', value.message);
      allowed.year = value.value;
    }
    if (patch.overview !== undefined) {
      const value = validateOptionalText(patch.overview, MAX_REVIEW, '简介');
      if (!value.ok) throw new AppError('VALIDATION', value.message);
      allowed.overview = value.value;
    }
    if (patch.tagline !== undefined) {
      const value = validateOptionalText(patch.tagline, 300, '宣传语');
      if (!value.ok) throw new AppError('VALIDATION', value.message);
      allowed.tagline = value.value;
    }
    if (patch.mediaType !== undefined) {
      if (!isMediaType(patch.mediaType)) throw new AppError('VALIDATION', '作品类型无效。');
      allowed.mediaType = patch.mediaType;
    }
    if (patch.runtime !== undefined) {
      if (
        patch.runtime != null &&
        (!Number.isInteger(patch.runtime) || patch.runtime <= 0 || patch.runtime > 3000)
      ) {
        throw new AppError('VALIDATION', '片长无效。');
      }
      allowed.runtime = patch.runtime;
    }
    if (patch.genres !== undefined) {
      allowed.genres = patch.genres
        .filter((genre) => typeof genre === 'string' && genre.trim())
        .slice(0, 12);
    }
    if (patch.originalLanguage !== undefined) {
      const value = validateOptionalText(patch.originalLanguage, 12, '原始语言');
      if (!value.ok) throw new AppError('VALIDATION', value.message);
      allowed.originalLanguage = value.value;
    }
    // Poster/backdrop are managed by the image cache; user edits never touch them.
    return this.repo.updateFilm(filmId, allowed);
  }

  /** Applies refreshed external metadata while leaving every personal field untouched. */
  async applyExternalMetadata(filmId: string, candidate: MetadataCandidate): Promise<Film> {
    const film = this.repo.getFilm(filmId);
    if (!film) throw new AppError('NOT_FOUND', '作品不存在。');

    let posterPath = film.posterPath;
    let backdropPath = film.backdropPath;
    if (candidate.posterUrl) {
      try {
        posterPath = await this.images.store(candidate.posterUrl, 'poster');
      } catch {
        // Keep the existing cached poster when the refresh download fails.
      }
    }
    if (candidate.backdropUrl) {
      try {
        backdropPath = await this.images.store(candidate.backdropUrl, 'backdrop');
      } catch {
        // Same for the backdrop.
      }
    }

    return this.repo.updateFilm(filmId, {
      title: candidate.title,
      originalTitle: candidate.originalTitle,
      year: candidate.year,
      overview: candidate.overview,
      tagline: candidate.tagline,
      runtime: candidate.runtime,
      genres: candidate.genres,
      originalLanguage: candidate.originalLanguage,
      posterPath,
      backdropPath,
      metadataUpdatedAt: now(),
    });
  }

  updateEntry(entryId: string, patch: EntryPatch): CollectionEntry {
    const entry = this.repo.getEntry(entryId);
    if (!entry) throw new AppError('NOT_FOUND', '收藏记录不存在。');

    const allowed: EntryPatch = {};

    if (patch.personalRating !== undefined) {
      const value = validateRating(patch.personalRating);
      if (!value.ok) throw new AppError('VALIDATION', value.message);
      allowed.personalRating = value.value;
    }
    if (patch.watchStatus !== undefined) {
      if (!isWatchStatus(patch.watchStatus)) throw new AppError('VALIDATION', '观看状态无效。');
      allowed.watchStatus = patch.watchStatus;
      if (patch.watchStatus === 'watched' && patch.watchedAt === undefined) {
        allowed.watchedAt = entry.watchedAt ?? now();
      }
    }
    if (patch.watchedAt !== undefined) {
      if (patch.watchedAt !== null && Number.isNaN(Date.parse(patch.watchedAt))) {
        throw new AppError('VALIDATION', '观看时间格式无效。');
      }
      allowed.watchedAt = patch.watchedAt;
    }
    if (patch.collectedAt !== undefined) {
      if (Number.isNaN(Date.parse(patch.collectedAt))) {
        throw new AppError('VALIDATION', '收藏时间格式无效。');
      }
      allowed.collectedAt = patch.collectedAt;
    }
    if (patch.favoriteReason !== undefined) {
      const value = validateOptionalText(patch.favoriteReason, MAX_FAVORITE_REASON, '收藏理由');
      if (!value.ok) throw new AppError('VALIDATION', value.message);
      allowed.favoriteReason = value.value;
    }
    if (patch.personalReview !== undefined) {
      const value = validateOptionalText(patch.personalReview, MAX_REVIEW, '个人短评');
      if (!value.ok) throw new AppError('VALIDATION', value.message);
      allowed.personalReview = value.value;
    }

    return this.repo.updateEntry(entryId, allowed);
  }

  /**
   * Removes a title from the collection. Its Quark resource records and topic
   * memberships belong to that title and are removed with it; topics themselves
   * are never deleted here.
   */
  removeFilm(filmId: string): { removedResources: number } {
    const film = this.repo.getFilm(filmId);
    if (!film) throw new AppError('NOT_FOUND', '作品不存在。');
    const removedResources = this.repo.listResources(filmId).length;
    this.repo.deleteFilm(filmId);
    return { removedResources };
  }

  /* ---------------------------------------------------------------- */
  /* Writes: collections                                               */
  /* ---------------------------------------------------------------- */

  createCollection(input: { name: string; description?: string | null }): FilmCollection {
    const name = validateCollectionName(input.name);
    if (!name.ok) throw new AppError('VALIDATION', name.message);
    const description = validateOptionalText(input.description, 500, '专题描述');
    if (!description.ok) throw new AppError('VALIDATION', description.message);
    if (this.repo.getCollectionByName(name.value)) {
      throw new AppError('DUPLICATE', '已经存在同名专题。');
    }
    return this.repo.createCollection({
      id: randomUUID(),
      name: name.value,
      description: description.value,
      coverPath: null,
    });
  }

  updateCollection(
    id: string,
    patch: { name?: string; description?: string | null },
  ): FilmCollection {
    const existing = this.repo.getCollection(id);
    if (!existing) throw new AppError('NOT_FOUND', '专题不存在。');
    const next: { name?: string; description?: string | null } = {};
    if (patch.name !== undefined) {
      const name = validateCollectionName(patch.name);
      if (!name.ok) throw new AppError('VALIDATION', name.message);
      const clash = this.repo.getCollectionByName(name.value);
      if (clash && clash.id !== id) throw new AppError('DUPLICATE', '已经存在同名专题。');
      next.name = name.value;
    }
    if (patch.description !== undefined) {
      const description = validateOptionalText(patch.description, 500, '专题描述');
      if (!description.ok) throw new AppError('VALIDATION', description.message);
      next.description = description.value;
    }
    return this.repo.updateCollection(id, next);
  }

  deleteCollection(id: string): void {
    const existing = this.repo.getCollection(id);
    if (!existing) throw new AppError('NOT_FOUND', '专题不存在。');
    this.repo.deleteCollection(id);
  }

  addFilmToCollection(collectionId: string, entryId: string): FilmCollection {
    const collection = this.repo.getCollection(collectionId);
    if (!collection) throw new AppError('NOT_FOUND', '专题不存在。');
    const entry = this.repo.getEntry(entryId);
    if (!entry) throw new AppError('NOT_FOUND', '收藏记录不存在。');
    this.repo.addFilmToCollection(collectionId, entryId);
    const updated = this.repo.getCollection(collectionId);
    if (!updated) throw new AppError('NOT_FOUND', '专题不存在。');
    return updated;
  }

  removeFilmFromCollection(collectionId: string, entryId: string): FilmCollection {
    const collection = this.repo.getCollection(collectionId);
    if (!collection) throw new AppError('NOT_FOUND', '专题不存在。');
    this.repo.removeFilmFromCollection(collectionId, entryId);
    const updated = this.repo.getCollection(collectionId);
    if (!updated) throw new AppError('NOT_FOUND', '专题不存在。');
    return updated;
  }

  reorderCollections(orderedIds: string[]): FilmCollection[] {
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      throw new AppError('VALIDATION', '排序列表为空。');
    }
    const known = new Set(this.repo.listCollections().map((collection) => collection.id));
    for (const id of orderedIds) {
      if (!known.has(id)) throw new AppError('VALIDATION', '排序列表包含未知专题。');
    }
    this.repo.reorderCollections(orderedIds);
    return this.repo.listCollections();
  }

  /* ---------------------------------------------------------------- */
  /* Writes: Quark resources                                           */
  /* ---------------------------------------------------------------- */

  createResource(input: ResourceInput): MediaResource {
    const film = this.repo.getFilm(input.filmId);
    if (!film) throw new AppError('NOT_FOUND', '作品不存在。');

    const name = validateTitle(input.resourceName);
    if (!name.ok) throw new AppError('VALIDATION', name.message);
    const url = validateHttpUrl(input.shareUrl);
    if (!url.ok) throw new AppError('VALIDATION', url.message);
    const accessCode = validateAccessCode(input.accessCode);
    if (!accessCode.ok) throw new AppError('VALIDATION', accessCode.message);
    const quality = validateOptionalText(input.qualityLabel, MAX_LABEL, '清晰度');
    if (!quality.ok) throw new AppError('VALIDATION', quality.message);
    const version = validateOptionalText(input.versionLabel, MAX_LABEL, '版本');
    if (!version.ok) throw new AppError('VALIDATION', version.message);
    const subtitle = validateOptionalText(input.subtitleLabel, MAX_LABEL, '字幕');
    if (!subtitle.ok) throw new AppError('VALIDATION', subtitle.message);
    const audio = validateOptionalText(input.audioLabel, MAX_LABEL, '音轨');
    if (!audio.ok) throw new AppError('VALIDATION', audio.message);
    const notes = validateOptionalText(input.notes, MAX_NOTES, '备注');
    if (!notes.ok) throw new AppError('VALIDATION', notes.message);
    const availability = input.availabilityStatus ?? 'unchecked';
    if (!isAvailabilityStatus(availability)) {
      throw new AppError('VALIDATION', '资源状态无效。');
    }

    this.onSecret(accessCode.value);
    return this.repo.createResource(randomUUID(), {
      filmId: film.id,
      resourceName: name.value,
      shareUrl: url.value.toString(),
      accessCode: accessCode.value,
      qualityLabel: quality.value,
      versionLabel: version.value,
      subtitleLabel: subtitle.value,
      audioLabel: audio.value,
      notes: notes.value,
      availabilityStatus: availability,
    });
  }

  updateResource(id: string, patch: Partial<ResourceInput>): MediaResource {
    const existing = this.repo.getResource(id);
    if (!existing) throw new AppError('NOT_FOUND', '资源记录不存在。');

    const next: Partial<ResourceInput> = {};
    if (patch.resourceName !== undefined) {
      const name = validateTitle(patch.resourceName);
      if (!name.ok) throw new AppError('VALIDATION', name.message);
      next.resourceName = name.value;
    }
    if (patch.shareUrl !== undefined) {
      const url = validateHttpUrl(patch.shareUrl);
      if (!url.ok) throw new AppError('VALIDATION', url.message);
      next.shareUrl = url.value.toString();
    }
    if (patch.accessCode !== undefined) {
      const accessCode = validateAccessCode(patch.accessCode);
      if (!accessCode.ok) throw new AppError('VALIDATION', accessCode.message);
      next.accessCode = accessCode.value;
      this.onSecret(accessCode.value);
    }
    for (const [key, label] of [
      ['qualityLabel', '清晰度'],
      ['versionLabel', '版本'],
      ['subtitleLabel', '字幕'],
      ['audioLabel', '音轨'],
    ] as const) {
      const value = patch[key];
      if (value !== undefined) {
        const validated = validateOptionalText(value, MAX_LABEL, label);
        if (!validated.ok) throw new AppError('VALIDATION', validated.message);
        next[key] = validated.value;
      }
    }
    if (patch.notes !== undefined) {
      const notes = validateOptionalText(patch.notes, MAX_NOTES, '备注');
      if (!notes.ok) throw new AppError('VALIDATION', notes.message);
      next.notes = notes.value;
    }
    if (patch.availabilityStatus !== undefined) {
      if (!isAvailabilityStatus(patch.availabilityStatus)) {
        throw new AppError('VALIDATION', '资源状态无效。');
      }
      next.availabilityStatus = patch.availabilityStatus;
    }
    if (patch.filmId !== undefined && patch.filmId !== existing.filmId) {
      throw new AppError('VALIDATION', '不能把资源移动到另一部作品。');
    }

    return this.repo.updateResource(id, next);
  }

  deleteResource(id: string): void {
    const existing = this.repo.getResource(id);
    if (!existing) throw new AppError('NOT_FOUND', '资源记录不存在。');
    this.repo.deleteResource(id);
  }

  /* ---------------------------------------------------------------- */
  /* Settings                                                          */
  /* ---------------------------------------------------------------- */

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    if (patch.metadataLanguage !== undefined) {
      if (patch.metadataLanguage !== 'zh-CN' && patch.metadataLanguage !== 'en-US') {
        throw new AppError('VALIDATION', '元数据语言无效。');
      }
      this.repo.setSetting('metadataLanguage', patch.metadataLanguage);
    }
    if (patch.defaultSort !== undefined) {
      const allowed = [
        'collected_desc',
        'collected_asc',
        'title_asc',
        'title_desc',
        'year_desc',
        'year_asc',
        'rating_desc',
      ];
      if (!allowed.includes(patch.defaultSort)) {
        throw new AppError('VALIDATION', '排序方式无效。');
      }
      this.repo.setSetting('defaultSort', patch.defaultSort);
    }
    if (patch.posterDensity !== undefined) {
      if (patch.posterDensity !== 'comfortable' && patch.posterDensity !== 'compact') {
        throw new AppError('VALIDATION', '海报密度无效。');
      }
      this.repo.setSetting('posterDensity', patch.posterDensity);
    }
    if (patch.motionPreference !== undefined) {
      if (!['system', 'reduce', 'full'].includes(patch.motionPreference)) {
        throw new AppError('VALIDATION', '动效偏好无效。');
      }
      this.repo.setSetting('motionPreference', patch.motionPreference);
    }
    return this.repo.getSettings();
  }

  /* ---------------------------------------------------------------- */
  /* Internals                                                         */
  /* ---------------------------------------------------------------- */

  private buildEntry(filmId: string, patch: EntryPatch = {}): CollectionEntry {
    const timestamp = now();
    const rating = validateRating(patch.personalRating ?? null);
    if (!rating.ok) throw new AppError('VALIDATION', rating.message);
    const status = patch.watchStatus ?? 'want';
    if (!isWatchStatus(status)) throw new AppError('VALIDATION', '观看状态无效。');
    const reason = validateOptionalText(patch.favoriteReason, MAX_FAVORITE_REASON, '收藏理由');
    if (!reason.ok) throw new AppError('VALIDATION', reason.message);
    const review = validateOptionalText(patch.personalReview, MAX_REVIEW, '个人短评');
    if (!review.ok) throw new AppError('VALIDATION', review.message);

    const collectedAt = patch.collectedAt ?? timestamp;
    if (Number.isNaN(Date.parse(collectedAt))) {
      throw new AppError('VALIDATION', '收藏时间格式无效。');
    }

    let watchedAt = patch.watchedAt ?? null;
    if (watchedAt === undefined || watchedAt === null) {
      watchedAt = status === 'watched' ? timestamp : null;
    }

    return {
      id: randomUUID(),
      filmId,
      film: null as unknown as Film,
      personalRating: rating.value,
      watchStatus: status,
      collectedAt,
      watchedAt,
      favoriteReason: reason.value,
      personalReview: review.value,
      sortOrder: this.repo.nextEntrySortOrder(),
      createdAt: timestamp,
      updatedAt: timestamp,
      collectionIds: [],
    };
  }
}

export { now as libraryNow };
