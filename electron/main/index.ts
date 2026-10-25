import { app, BrowserWindow, dialog, Menu, protocol, screen, shell } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { registerIpc } from './ipc';
import { buildMenu } from './menu';
import { resolveAppPaths } from './paths';
import { AppRuntime } from './runtime';
import { loadWindowState, saveWindowState } from './windowState';
import { isSafeExternalUrl } from '../../src/shared/validation';
import type { SecretBox } from './services/credentials';
import { safeStorage } from 'electron';

const IMAGE_SCHEME = 'mycinema';
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

/**
 * Chromium writes caches, crash reports and page snapshots into `%TEMP%`.
 * A machine with a redirected or unwritable TEMP would fail in ways the user
 * cannot fix from inside the app, so the app carries its own temp directory
 * under userData instead. Must run before the app is ready.
 */
export function prepareTempDirectory(userData: string): string | null {
  const dir = join(userData, 'tmp');
  try {
    mkdirSync(dir, { recursive: true });
    app.setPath('temp', dir);
    return dir;
  } catch {
    // Fall back to the system temp; the diagnostic script explains what to fix.
    return null;
  }
}

prepareTempDirectory(app.getPath('userData'));

protocol.registerSchemesAsPrivileged([
  {
    scheme: IMAGE_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

const secretBox: SecretBox = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plain) => safeStorage.encryptString(plain),
  decrypt: (payload) => safeStorage.decryptString(payload),
};

let mainWindow: BrowserWindow | null = null;
let runtime: AppRuntime | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(bootstrap).catch(handleFatal);
}

async function bootstrap(): Promise<void> {
  app.setAppUserModelId('com.mycinema.desktop');

  const paths = resolveAppPaths(app.getPath('userData'));
  runtime = new AppRuntime(paths, {
    secretBox,
    appVersion: app.getVersion(),
    loggerConsole: isDev,
  });
  runtime.start();

  if (runtime.failure) {
    const failure = runtime.failure;
    const result = await dialog.showMessageBox({
      type: 'error',
      title: 'My Cinema 无法启动',
      message: failure.message,
      detail:
        `${failure.detail ? `${failure.detail}\n\n` : ''}` +
        `数据目录：${paths.userData}\n\n` +
        '你的数据库文件没有被删除或覆盖。请先备份该目录，再排查或从备份恢复。',
      buttons: ['打开数据目录', '退出'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (result.response === 0) await shell.openPath(paths.userData);
    app.quit();
    return;
  }

  registerImageProtocol();
  registerIpc(runtime);
  Menu.setApplicationMenu(isDev ? buildMenu({ isDev }) : null);
  createWindow();

  app.on('window-all-closed', () => {
    runtime?.shutdown();
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

function registerImageProtocol(): void {
  protocol.handle(IMAGE_SCHEME, (request) => {
    try {
      const url = new URL(request.url);
      const relative = decodeURIComponent(url.pathname.replace(/^\//, ''));
      if (url.hostname !== 'image') {
        return new Response('Not found', { status: 404 });
      }
      const file = runtime?.images.read(relative);
      if (!file) {
        // A missing cache file is expected after the cache is cleared; the UI
        // falls back to a typographic placeholder.
        return new Response('Not found', { status: 404 });
      }
      return new Response(file.data as unknown as BodyInit, {
        status: 200,
        headers: {
          'content-type': file.mime,
          'cache-control': 'public, max-age=31536000, immutable',
        },
      });
    } catch {
      return new Response('Bad request', { status: 400 });
    }
  });
}

function createWindow(): void {
  if (!runtime) return;
  const workAreas = screen.getAllDisplays().map((display) => display.workArea);
  const state = loadWindowState(runtime.paths.windowStateFile, workAreas);

  const iconPath = join(__dirname, '..', 'build', process.platform==='win32' ? 'icon.ico' : 'icon.png');

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#101216',
    title: 'My Cinema',
    icon: existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: !isDev,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: true,
    },
  });
  if (!isDev) mainWindow.setMenuBarVisibility(false);

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return;
    if (state.maximized) mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.on('close', () => {
    if (mainWindow && runtime) saveWindowState(runtime.paths.windowStateFile, mainWindow);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // External links never navigate the app shell.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow?.webContents.getURL();
    if (current && url !== current) {
      event.preventDefault();
      if (isSafeExternalUrl(url)) void shell.openExternal(url);
    }
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    runtime?.logger.error(`Renderer gone: ${details.reason}`);
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(join(__dirname, '..', 'dist', 'index.html'));
  }
}

function handleFatal(error: unknown): void {
  runtime?.logger.error('Fatal startup error', error);
  dialog.showErrorBox(
    'My Cinema 启动失败',
    error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  );
  app.quit();
}

process.on('uncaughtException', (error) => {
  runtime?.logger.error('Uncaught exception in main process', error);
});

process.on('unhandledRejection', (reason) => {
  runtime?.logger.error('Unhandled rejection in main process', reason);
});
