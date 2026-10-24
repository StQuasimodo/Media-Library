import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { context } from 'esbuild';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const electronBinary = require('electron');
const root = process.cwd();
const outDir = join(root, 'dist-electron');

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  logLevel: 'warning',
  external: ['electron', 'better-sqlite3'],
  sourcemap: false,
};

let child = null;
let stopping = false;

async function stopElectron() {
  if (child) {
    const previous = child;
    child = null;
    previous.removeAllListeners('exit');
    if (previous.exitCode === null && previous.signalCode === null) {
      const exited = once(previous, 'exit');
      previous.kill();
      await exited;
    }
  }
}

async function startElectron(devServerUrl) {
  // Wait for the old single-instance lock to be released before relaunching.
  await stopElectron();
  if (stopping) return;
  const env = { ...process.env, VITE_DEV_SERVER_URL: devServerUrl };
  // Some shells export this; it would run Electron as plain Node.
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(electronBinary, ['.'], {
    cwd: root,
    stdio: 'inherit',
    env,
  });
  child.on('exit', (code) => {
    if (stopping) return;
    // Quitting the app window ends the dev session.
    void shutdown(code ?? 0);
  });
  child.on('error', (error) => {
    console.error('[dev] Electron 启动失败', error);
    void shutdown(1);
  });
}

const existingSigtermListeners = new Set(process.listeners('SIGTERM'));
const server = await createServer({ root, configFile: join(root, 'vite.config.ts'), mode: 'development' });
// Vite's standalone SIGTERM handler exits the process before Electron is stopped.
// This wrapper owns shutdown; preserve handlers that existed before Vite.
for (const listener of process.listeners('SIGTERM')) {
  if (!existingSigtermListeners.has(listener)) process.off('SIGTERM', listener);
}
await server.listen();
const devServerUrl = server.resolvedUrls?.local?.[0] ?? 'http://localhost:5273/';
server.printUrls();

// Initial build and rebuilds must write the exact files Electron loads.
const watcher = await context({
  ...shared,
  entryPoints: {
    main: join(root, 'electron/main/index.ts'),
    preload: join(root, 'electron/preload/index.ts'),
  },
  outdir: outDir,
  outExtension: { '.js': '.cjs' },
  plugins: [
    {
      name: 'restart-electron',
      setup(pluginBuild) {
        pluginBuild.onEnd(async (result) => {
          if (result.errors.length > 0 || stopping) return;
          console.log('[dev] 主进程已重新构建，正在重启应用…');
          await startElectron(devServerUrl);
        });
      },
    },
  ],
});
await watcher.watch();

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  try {
    await watcher.dispose();
    await server.close();
  } catch {
    // ignore
  }
  await stopElectron();
  process.exit(code);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
