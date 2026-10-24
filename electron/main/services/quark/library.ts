import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, isAbsolute, join } from 'node:path';
import type { QuarkFolder, QuarkInventory, QuarkStatus } from '../../../../src/shared/quark';
import { AppError } from '../../errors';
import { QuarkProvider, validFolderId, fileIdentity } from './provider';
import { inferVideoName, isVideoName } from './filename';

interface Config { toolPath: string | null; folder: QuarkFolder | null; recursive: boolean; autoRead: boolean }
const rootFolder = { id: '0', name: '夸克网盘', path: '夸克网盘' };

/** Read-only, rebuildable inventory, deliberately separate from personal collections. */
export class QuarkLibrary {
  private config: Config = { toolPath: null, folder: null, recursive: true, autoRead: true };
  private inventory: QuarkInventory | null = null;
  private busy = false;
  private error: string | null = null;
  private notices: string[] = [];
  private controller: AbortController | null = null;
  private knownFolders = new Map<string, QuarkFolder>([['0', rootFolder]]);
  private readonly configFile: string;
  private readonly inventoryFile: string;

  constructor(private readonly directory: string, private readonly provider = new QuarkProvider()) {
    this.configFile = join(directory, 'quark-source.json');
    this.inventoryFile = join(directory, 'quark-inventory.json');
    try {
      if (existsSync(this.configFile)) {
        const saved = JSON.parse(readFileSync(this.configFile, 'utf8'));
        if (saved.version !== 1 || (saved.toolPath !== null && (typeof saved.toolPath !== 'string' || !isAbsolute(saved.toolPath) || basename(saved.toolPath) !== 'quark-drive.cjs')) ||
          (saved.folder !== null && (!validFolderId(saved.folder?.id) || typeof saved.folder?.path !== 'string' || typeof saved.folder?.name !== 'string')) ||
          typeof saved.recursive !== 'boolean' || typeof saved.autoRead !== 'boolean') throw new Error();
        this.config = { toolPath: saved.toolPath, folder: saved.folder, recursive: saved.recursive, autoRead: saved.autoRead };
      }
      if (existsSync(this.inventoryFile)) {
        const saved = JSON.parse(readFileSync(this.inventoryFile, 'utf8')) as QuarkInventory;
        if (saved.folder?.id === this.config.folder?.id && saved.recursive === this.config.recursive && Array.isArray(saved.videos)) this.inventory = saved;
      }
    } catch { this.error = '本地夸克读取配置不可用，请重新选择工具和文件夹。'; }
  }

  status(): QuarkStatus {
    return { ...this.config, busy: this.busy, error: this.error, notices: [...new Set(this.notices)], inventory: this.inventory };
  }
  private write(file: string, value: unknown) {
    mkdirSync(this.directory, { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(value), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      renameSync(temporary, file);
    } finally { rmSync(temporary, { force: true }); }
  }
  setTool(path: string): QuarkStatus {
    if (this.busy) throw new AppError('VALIDATION', '请等待当前读取完成。');
    if (!isAbsolute(path) || basename(path) !== 'quark-drive.cjs' || !existsSync(path)) throw new AppError('VALIDATION', '请选择已安装的夸克官方工具 quark-drive.cjs。');
    const next = { ...this.config, toolPath: path, folder: null };
    this.write(this.configFile, { version: 1, ...next });
    this.config = next;
    this.inventory = null;
    this.knownFolders = new Map([['0', rootFolder]]);
    this.error = null;
    return this.status();
  }
  selectFolder(id: string, recursive: boolean, autoRead: boolean): QuarkStatus {
    if (this.busy) throw new AppError('VALIDATION', '请等待当前读取完成。');
    const folder = this.knownFolders.get(id);
    if (!folder || typeof recursive !== 'boolean' || typeof autoRead !== 'boolean') throw new AppError('VALIDATION', '请从文件夹列表中选择读取范围。');
    const next = { ...this.config, folder, recursive, autoRead };
    this.write(this.configFile, { version: 1, ...next });
    if (this.config.folder?.id !== folder.id || this.config.recursive !== recursive) this.inventory = null;
    this.config = next;
    this.error = null;
    return this.status();
  }
  private tool(): string {
    if (!this.config.toolPath || !existsSync(this.config.toolPath)) throw new AppError('VALIDATION', '请先安装并授权夸克官方工具，然后在这里选择工具。');
    return this.config.toolPath;
  }
  private async withJob<T>(work: (cwd: string, signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.busy) throw new AppError('VALIDATION', '夸克正在读取，请稍后重试。');
    try { this.tool(); }
    catch (error) {
      this.error = (error as Error).message;
      throw error;
    }
    this.busy = true;
    this.error = null;
    this.notices = [];
    this.controller = new AbortController();
    mkdirSync(this.directory, { recursive: true });
    let cwd: string | undefined;
    try {
      cwd = await mkdtemp(join(this.directory, 'quark-read-'));
      return await work(cwd, this.controller.signal);
    } catch (error) {
      this.error = error instanceof AppError ? error.message : '读取失败，保留了上次成功的清单。';
      const notices = (error as { notices?: unknown }).notices;
      if (Array.isArray(notices)) this.notices.push(...notices.filter((v): v is string => typeof v === 'string'));
      throw new AppError(error instanceof AppError ? error.code : 'INTERNAL', this.error);
    } finally {
      this.busy = false;
      this.controller = null;
      if (cwd) await rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  }
  async browse(id: string) {
    const parent = this.knownFolders.get(id);
    if (!parent) throw new AppError('VALIDATION', '请从已列出的文件夹逐层选择。');
    return this.withJob(async (cwd, signal) => {
      const result = await this.provider.browse(this.tool(), id, cwd, signal);
      this.notices.push(...result.notices);
      const folders = result.items.filter((item) => item.directory).map((item) => ({ id: item.id, name: item.name, path: `${parent.path}/${item.name}` }));
      for (const folder of folders) this.knownFolders.set(folder.id, folder);
      return { folders, notices: [...this.notices] };
    });
  }
  async scan(): Promise<QuarkStatus> {
    const selected = this.config.folder;
    if (!selected) throw new AppError('VALIDATION', '请先选择要读取的云端文件夹。');
    return this.withJob(async (cwd, signal) => {
      const inventory: QuarkInventory = { folder: selected, recursive: this.config.recursive, scannedAt: new Date().toISOString(), directories: 0, videos: [] };
      const queue = [{ folder: selected, parents: [selected.name] }];
      const visited = new Set<string>();
      const seenFiles = new Set<string>();
      let totalEntries = 0;
      while (queue.length) {
        if (signal.aborted) throw new AppError('VALIDATION', '已取消读取。');
        const current = queue.shift()!;
        const identity = fileIdentity(current.folder.id);
        if (visited.has(identity)) continue;
        visited.add(identity);
        if (visited.size > 200 || current.parents.length > 32) throw new AppError('VALIDATION', '目录范围过大，请选择更具体的影视文件夹。');
        const result = await this.provider.browse(this.tool(), current.folder.id, cwd, signal);
        this.notices.push(...result.notices);
        inventory.directories++;
        totalEntries += result.items.length;
        if (totalEntries > 20_000) throw new AppError('VALIDATION', '条目过多，请选择更具体的影视文件夹。');
        for (const item of result.items) {
          const path = `${current.folder.path}/${item.name}`;
          if (path.length > 4096) throw new AppError('VALIDATION', '目录层级或文件名过长，请选择更具体的目录。');
          if (item.directory) {
            if (this.config.recursive) queue.push({ folder: { id: item.id, name: item.name, path }, parents: [...current.parents, item.name] });
          } else if (item.video || isVideoName(item.name)) {
            const key = fileIdentity(item.id);
            if (seenFiles.has(key)) continue;
            seenFiles.add(key);
            inventory.videos.push({ id: item.id, name: item.name, path, size: item.size, checkUrl: item.checkUrl, hint: inferVideoName(item.name, current.parents) });
          }
        }
      }
      if (signal.aborted) throw new AppError('VALIDATION', '已取消读取。');
      this.write(this.inventoryFile, inventory);
      this.inventory = inventory;
      return this.status();
    }).then(() => this.status());
  }
  cancel() { this.controller?.abort(); }
  async readOnStartup() {
    if (this.config.autoRead && this.config.folder && this.config.toolPath) {
      try { await this.scan(); } catch { /* status retains error and previous successful inventory */ }
    }
  }
}
