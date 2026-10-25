import { app, BrowserWindow, session, type Session } from 'electron';
import { AppError } from '../../errors';
import type { QuarkWebStatus } from '../../../../src/shared/quarkWeb';
import { CheckError, directoryUrl, parsePage, readDirectory, trustedLoginUrl } from './webProtocol';

/** Dedicated Chromium partition; no CLI or access to another browser's profile. */
export class QuarkWebSession {
  private store: Session;
  private windows = new Set<BrowserWindow>();
  private login: BrowserWindow | null = null;
  private state: QuarkWebStatus['state'] = 'not_checked';
  private error: string | null = null;
  private busy = false;
  private known = new Set(['0']);
  constructor() {
    this.store = session.fromPartition('persist:mycinema-quark-web');
    this.store.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    this.store.setPermissionCheckHandler(() => false);
    let quitting = false;
    app.on('before-quit', event => {
      if (quitting) return; event.preventDefault(); quitting = true;
      this.store.cookies.flushStore().finally(() => { this.store.flushStorageData(); app.quit(); }).catch(() => {});
    });
  }
  status(): QuarkWebStatus { return { state: this.state, error: this.error, loginOpen: Boolean(this.login && !this.login.isDestroyed()) }; }
  private async run<T>(action: () => Promise<T>): Promise<T> {
    if (this.busy) throw new AppError('VALIDATION', '请等待当前夸克操作完成。');
    this.busy = true;
    try { return await action(); }
    catch (error) {
      this.error = error instanceof CheckError ? error.message : '夸克连接操作失败，请重试。';
      if (error instanceof CheckError && error.kind === 'login') { this.state = 'login_required'; this.known = new Set(['0']); }
      throw new AppError('NETWORK', this.error);
    } finally { this.busy = false; }
  }
  private async request(url: string) {
    try {
      const response = await this.store.fetch(url, { method: 'GET', credentials: 'include', redirect: 'error', headers: { Referer: 'https://pan.quark.cn/' }, signal: AbortSignal.timeout(15_000) });
      const text = await response.text();
      if (text.length > 4 * 1024 * 1024) throw new CheckError('protocol', '目录响应过大。');
      let body: unknown; try { body = JSON.parse(text); } catch { body = null; }
      return { status: response.status, body };
    } catch (error) {
      if (error instanceof CheckError) throw error;
      throw new CheckError('network', '夸克请求失败或超时，请检查网络和系统证书。');
    }
  }
  async check(): Promise<QuarkWebStatus> {
    return this.run(async () => {
      try {
        const result = await this.request(directoryUrl('0', 1, 1)); parsePage(result.status, result.body);
        await this.store.cookies.flushStore(); this.state = 'verified'; this.error = null;
      } catch (error) {
        this.state = error instanceof CheckError && error.kind === 'login' ? 'login_required' : 'unavailable';
        this.error = error instanceof CheckError ? error.message : '无法确认连接状态。';
        if (this.state === 'login_required') this.known = new Set(['0']);
      }
      return this.status();
    });
  }
  async list(id: string) {
    return this.run(async () => {
      if (!this.known.has(id)) throw new CheckError('protocol', '请从文件夹列表中选择目录。');
      const items = await readDirectory(id, url => this.request(url));
      await this.store.cookies.flushStore();
      for (const item of items) if (item.directory) this.known.add(item.id);
      this.state = 'verified'; this.error = null;
      return { items, total: items.length };
    });
  }
  private protect(win: BrowserWindow) {
    this.windows.add(win); win.on('closed', () => this.windows.delete(win));
    win.webContents.on('will-navigate', (event, url) => { if (!trustedLoginUrl(url)) event.preventDefault(); });
    win.webContents.on('will-redirect', (event, url) => { if (!trustedLoginUrl(url)) event.preventDefault(); });
    win.webContents.on('will-attach-webview', event => event.preventDefault());
    win.webContents.setWindowOpenHandler(({ url }) => trustedLoginUrl(url) ? { action: 'allow', overrideBrowserWindowOptions: {
      autoHideMenuBar: true, webPreferences: { partition: 'persist:mycinema-quark-web', sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false },
    } } : { action: 'deny' });
    win.webContents.on('did-create-window', child => this.protect(child));
  }
  async connect() {
    return this.run(async () => {
      this.known = new Set(['0']); this.state = 'not_checked'; this.error = null;
      if (this.login && !this.login.isDestroyed()) { this.login.show(); this.login.focus(); return this.status(); }
      const win = new BrowserWindow({ width: 1100, height: 800, title: '关联夸克账号 · 官方网页登录', autoHideMenuBar: true,
        webPreferences: { partition: 'persist:mycinema-quark-web', sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false } });
      this.login = win; this.protect(win); win.on('closed', () => { this.login = null; });
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return; settled = true; clearTimeout(timer);
          win.removeListener('closed', closed); win.webContents.removeListener('dom-ready', ready); win.webContents.removeListener('did-fail-load', failed);
          if (error) { if (!win.isDestroyed()) win.close(); reject(error); } else resolve();
        };
        const ready = () => { if (trustedLoginUrl(win.webContents.getURL())) finish(); };
        const closed = () => finish(new CheckError('network', '登录窗口已关闭，可以重新打开。'));
        const failed = (_event: unknown, code: number, _description: string, _url: string, main: boolean) => { if (main && code !== -3) finish(new CheckError('network', `官方登录页加载失败（${code}）。`)); };
        const timer = setTimeout(() => finish(new CheckError('network', '登录页暂未就绪，请在本机网络重试。')), 25_000);
        win.once('closed', closed); win.webContents.on('dom-ready', ready); win.webContents.on('did-fail-load', failed);
        void win.loadURL('https://pan.quark.cn/list').catch(() => {});
      });
      return this.status();
    });
  }
  async disconnect() {
    return this.run(async () => {
      for (const win of this.windows) if (!win.isDestroyed()) win.close();
      await this.store.clearStorageData(); await this.store.cookies.flushStore();
      this.known = new Set(['0']); this.state = 'login_required'; this.error = null;
      return this.status();
    });
  }
}
