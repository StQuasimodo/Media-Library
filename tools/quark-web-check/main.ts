import { app, BrowserWindow, dialog, ipcMain, session, type Session } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CheckError, directoryUrl, parsePage, readDirectory, trustedLoginUrl } from './protocol';

app.setName('My Cinema Quark Check');
const stage = process.argv.find(arg => arg.startsWith('--self-test='))?.split('=')[1];
if (stage) {
  const profile = resolve('.harness/quark-web-check-profile'); mkdirSync(profile, { recursive: true }); app.setPath('userData', profile);
}
let controller: BrowserWindow;
let login: BrowserWindow | null = null;
let store: Session;
let busy = false;
let state = 'not_checked';
let lastError: string | null = null;
let reads = 0;
let completeLists = 0;
const known = new Set(['0']);
const ui = pathToFileURL(join(__dirname, 'index.html')).href;
const snapshot = () => ({ state, error: lastError, reads, completeLists, loginOpen: Boolean(login && !login.isDestroyed()) });

async function request(url: string) {
  try {
    const response = await store.fetch(url, { method: 'GET', credentials: 'include', redirect: 'error', headers: { Referer: 'https://pan.quark.cn/' }, signal: AbortSignal.timeout(15_000) });
    const text = await response.text();
    if (text.length > 4 * 1024 * 1024) throw new CheckError('protocol', '目录响应过大。');
    let body: unknown; try { body = JSON.parse(text); } catch { body = null; }
    reads++; return { status: response.status, body };
  } catch (error) {
    if (error instanceof CheckError) throw error;
    throw new CheckError('network', '请求失败或超时。请检查网络和系统证书；本工具不会跳过HTTPS验证。');
  }
}
async function check() {
  try {
    const response = await request(directoryUrl('0', 1, 1)); parsePage(response.status, response.body);
    await store.cookies.flushStore(); store.flushStorageData();
    state = 'directory_access_verified'; lastError = null;
  } catch (error) {
    state = error instanceof CheckError && error.kind === 'login' ? 'login_required' : 'unavailable';
    lastError = error instanceof CheckError ? error.message : '检查失败。';
  }
  return snapshot();
}
function protect(win: BrowserWindow) {
  win.webContents.on('will-navigate', (event, url) => { if (!trustedLoginUrl(url)) event.preventDefault(); });
  win.webContents.on('will-redirect', (event, url) => { if (!trustedLoginUrl(url)) event.preventDefault(); });
  win.webContents.setWindowOpenHandler(({ url }) => trustedLoginUrl(url) ? {
    action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { partition: 'persist:quark-web-check', sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false } },
  } : { action: 'deny' });
  win.webContents.on('did-create-window', child => protect(child));
  win.webContents.on('will-attach-webview', event => event.preventDefault());
}
async function openLogin() {
  if (login && !login.isDestroyed()) { login.show(); login.focus(); return; }
  login = new BrowserWindow({ title: '夸克官方网页登录 · 独立验证会话', width: 1100, height: 800, show: !stage,
    autoHideMenuBar: true, webPreferences: { partition: 'persist:quark-web-check', sandbox: true, nodeIntegration: false, contextIsolation: true, devTools: false } });
  const win = login; protect(win);
  win.on('closed', () => { login = null; });
  await win.loadURL('https://pan.quark.cn/list');
}
async function selfTest() {
  const marker = { url: 'https://mycinema-session-check.invalid', name: 'persistence-probe', value: 'synthetic-not-authentication', secure: true, expirationDate: Math.floor(Date.now() / 1000) + 3600 };
  if (stage === 'write') { await store.cookies.set(marker); await store.cookies.flushStore(); store.flushStorageData(); }
  const persisted = (await store.cookies.get({ url: marker.url })).some(cookie => cookie.name === marker.name && cookie.value === marker.value);
  if (!persisted) throw new Error('Isolated cookie persistence check failed');
  const status = await check();
  if (status.state !== 'login_required') throw new Error(`Anonymous directory check was inconclusive: ${status.state}`);
  await openLogin();
  if (!login || !trustedLoginUrl(login.webContents.getURL())) throw new Error('Official login page did not load at a trusted origin');
  let loginControlsVisible = false;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    loginControlsVisible = await login.webContents.executeJavaScript("/登录|sign in|log in/i.test(document.body.innerText)");
    if (loginControlsVisible) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!loginControlsVisible) throw new Error('Official page loaded without recognizable login controls');
  if (login.webContents.session !== store || store === session.defaultSession) throw new Error('Remote login session isolation failed');
  if (await login.webContents.executeJavaScript("typeof window.quarkCheck !== 'undefined' || typeof require !== 'undefined' || typeof window.cinema !== 'undefined'")) throw new Error('Remote page has an unexpected local bridge');
  const report = { platform: process.platform, stage, officialPageLoaded: true, loginControlsVisible, remotePageIsolated: true, anonymousDirectoryRequiresLogin: true, syntheticCookieSurvived: persisted, actualAccountVerified: false, actualAccountRestartVerified: false, productionDataTouched: false };
  mkdirSync('.harness', { recursive: true }); writeFileSync(resolve(`.harness/quark-web-${stage}.json`), JSON.stringify(report, null, 2));
  console.log('[quark-web-check]', JSON.stringify(report)); app.quit();
}
app.whenReady().then(async () => {
  store = session.fromPartition('persist:quark-web-check');
  store.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  store.setPermissionCheckHandler(() => false);
  if (stage) { await selfTest(); return; }
  controller = new BrowserWindow({ title: 'My Cinema · 夸克连接验证', width: 1000, height: 760,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  controller.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  controller.webContents.on('will-navigate', (event, target) => { if (target !== ui) event.preventDefault(); });
  ipcMain.handle('quark-check:action', async (event, action: unknown, id: unknown) => {
    if (event.sender !== controller.webContents || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== ui) throw new Error('Untrusted page');
    if (busy) return { ok: false, error: '请等待当前检查完成。' };
    busy = true;
    try {
      if (action === 'status') return { ok: true, data: snapshot() };
      if (action === 'login') { await openLogin(); return { ok: true, data: snapshot() }; }
      if (action === 'check') return { ok: true, data: await check() };
      if (action === 'list') {
        if (typeof id !== 'string' || !known.has(id)) throw new CheckError('protocol', '请从列表中选择目录。');
        const items = await readDirectory(id, request);
        for (const item of items) if (item.directory) known.add(item.id);
        completeLists++; state = 'directory_access_verified'; lastError = null; await store.cookies.flushStore();
        return { ok: true, data: { ...snapshot(), items, total: items.length } };
      }
      if (action === 'export') {
        const file = await dialog.showSaveDialog(controller, { defaultPath: 'my-cinema-quark-check.json', filters: [{ name: '诊断报告', extensions: ['json'] }] });
        if (!file.canceled && file.filePath) writeFileSync(file.filePath, JSON.stringify({ state, directoryRequests: reads, completeLists, exportedAt: new Date().toISOString(), containsCredentials: false, containsFileNames: false, accountIdentityCollected: false }, null, 2));
        return { ok: true, data: snapshot() };
      }
      throw new CheckError('protocol', '不支持的操作。');
    } catch (error) {
      const message = error instanceof CheckError ? error.message : '操作失败，请重试。';
      lastError = message;
      if (error instanceof CheckError && error.kind === 'login') state = 'login_required';
      return { ok: false, error: message, data: snapshot() };
    } finally { busy = false; }
  });
  await controller.loadURL(ui);
}).catch(error => { console.error('[quark-web-check] Failed.', stage && error instanceof Error ? error.message : 'No raw network responses or credentials are logged.'); app.exit(1); });
let quitting = false;
app.on('before-quit', event => {
  if (quitting || !store) return; event.preventDefault(); quitting = true;
  store.cookies.flushStore().finally(() => { store.flushStorageData(); app.quit(); });
});
app.on('window-all-closed', () => app.quit());
if (stage) setTimeout(() => { console.error('[quark-web-check] Timed out'); app.exit(1); }, 55_000).unref();
