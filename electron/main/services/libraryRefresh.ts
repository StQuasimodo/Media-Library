import type { LibraryRefreshStatus } from '../../../src/shared/libraryRefresh';
import type { LibraryRepository } from '../data/repository';
import { AppError, toSerializedError } from '../errors';
import type { MetadataService } from './metadataService';
import type { QuarkLibrary } from './quark/library';
import type { QuarkSync } from './quark/sync';

interface Context { repo: LibraryRepository; metadata: MetadataService }
type Sync = Pick<QuarkSync, 'status' | 'scan' | 'cancel' | 'assertIdle'>;
type Legacy = Pick<QuarkLibrary, 'status' | 'scan' | 'cancel'>;

/** One process-owned job survives route changes; all writes retain the original context. */
export class LibraryRefresh {
  private state: LibraryRefreshStatus = {
    id: 0, busy: false, phase: 'idle', cancelRequested: false, cancelled: false,
    startedAt: null, finishedAt: null, total: 0, completed: 0, updated: 0, failed: 0, skipped: 0,
    currentTitle: null, message: null, quark: { state: 'pending', message: null }, errors: [], imageWarnings: 0, imageWarningDetails: [],
  };
  private controller: AbortController | null = null;
  private running: Promise<void> | null = null;

  constructor(private readonly context: () => Context, private readonly sync: Sync, private readonly legacy: Legacy) {}
  get busy() { return this.state.busy; }
  assertIdle() {
    if (this.busy) throw new AppError('VALIDATION', '全部刷新正在进行，请先等待完成或停止刷新。');
  }
  status(): LibraryRefreshStatus {
    const value = structuredClone(this.state);
    if (value.busy && value.phase === 'quark' && !value.cancelRequested) {
      try { value.currentTitle = this.sync.status().progress || null; } catch { /* The job owns its saved result. */ }
    }
    return value;
  }
  start(): LibraryRefreshStatus {
    if (this.busy) return this.status();
    this.sync.assertIdle();
    if (this.legacy.status().busy) throw new AppError('VALIDATION', '夸克正在读取，请等待当前任务完成。');
    const context = this.context();
    this.controller = new AbortController();
    this.state = {
      id: this.state.id + 1, busy: true, phase: 'quark', cancelRequested: false, cancelled: false,
      startedAt: new Date().toISOString(), finishedAt: null, total: 0, completed: 0, updated: 0, failed: 0, skipped: 0,
      currentTitle: null, message: null, quark: { state: 'pending', message: null }, errors: [], imageWarnings: 0, imageWarningDetails: [],
    };
    const signal = this.controller.signal;
    this.running = this.run(context, signal);
    return this.status();
  }
  cancel(): LibraryRefreshStatus {
    if (this.busy) {
      this.state.cancelRequested = true;
      this.controller?.abort();
      this.sync.cancel();
      this.legacy.cancel();
    }
    return this.status();
  }
  async wait(): Promise<LibraryRefreshStatus> { await this.running; return this.status(); }

  private async run(context: Context, signal: AbortSignal): Promise<void> {
    const active = () => {
      if (signal.aborted || this.context().repo !== context.repo) throw new AppError('VALIDATION', '刷新已停止。');
    };
    try {
      const sources: Array<() => Promise<string | null>> = [];
      if (this.sync.status().source.folder) sources.push(async () => (await this.sync.scan()).error);
      if (this.legacy.status().folder) sources.push(async () => (await this.legacy.scan()).error);
      if (!sources.length) this.state.quark = { state: 'skipped', message: '未选择夸克影视目录，已跳过；可到设置连接并选择目录。' };
      else {
        this.state.quark.state = 'running';
        const warnings: string[] = [];
        let successful = 0;
        for (const scan of sources) {
          active();
          try {
            const warning = await scan(); active();
            successful++;
            if (warning) warnings.push(warning);
          } catch (error) {
            active(); warnings.push(toSerializedError(error).message);
          }
        }
        this.state.quark = {
          state: warnings.length ? successful ? 'partial' : 'failed' : 'updated',
          message: warnings.length ? warnings.join('；') : '已更新已选夸克目录、文件规格及增量关联；待确认的匹配可到设置查看。',
        };
      }
      active();
      this.state.phase = 'metadata';
      const films = context.repo.listAllFilms();
      this.state.total = films.length;
      if (!context.metadata.hasApiKey) {
        this.state.skipped = this.state.completed = films.length;
        this.state.message = '未配置或无法读取 TMDB 凭据，影视资料已跳过；原有收藏保留。';
        return;
      }
      for (const film of films) {
        active(); this.state.currentTitle = film.title;
        if (film.metadataSource !== 'tmdb' || !film.externalId || !context.repo.getFilm(film.id)) {
          this.state.skipped++; this.state.completed++; continue;
        }
        try {
          await context.metadata.refreshFilm(film.id, active, message => {
            this.state.imageWarnings++;
            if (this.state.imageWarningDetails.length < 50) this.state.imageWarningDetails.push({filmId:film.id,title:film.title,message});
          });
          active(); this.state.updated++;
        } catch (error) {
          active();
          if (!context.repo.getFilm(film.id)) this.state.skipped++;
          else {
            const detail = toSerializedError(error);
            this.state.failed++;
            if (this.state.errors.length < 50) this.state.errors.push({ filmId: film.id, title: film.title, message: detail.message });
            if (['NO_API_KEY', 'INVALID_API_KEY', 'RATE_LIMITED', 'NETWORK', 'TIMEOUT'].includes(detail.code) ||
                detail.code === 'BAD_RESPONSE' && /HTTP 5\d\d/.test(detail.message)) {
              this.state.message = `${detail.message} 已暂停后续资料请求，其余作品本次跳过，可稍后再次全部刷新。`;
              this.state.completed++;
              this.state.skipped += films.length - this.state.completed;
              this.state.completed = films.length;
              break;
            }
          }
        }
        this.state.completed++;
      }
    } catch (error) {
      if (signal.aborted) {
        this.state.cancelled = true;
        this.state.message = '刷新已停止；已完成的更新保留，其余作品未改动。';
        if (this.state.quark.state === 'running') this.state.quark = { state: 'partial', message: '夸克读取已停止，保留上次完整清单及已完成的关联。' };
      } else this.state.message = toSerializedError(error).message;
    } finally {
      this.state.busy = false; this.state.phase = 'idle'; this.state.currentTitle = null;
      this.state.finishedAt = new Date().toISOString(); this.controller = null;
    }
  }
}
