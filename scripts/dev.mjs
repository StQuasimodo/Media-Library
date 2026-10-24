import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { build, context } from 'esbuild';
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
let restarting = false;

async function buildOnce() {
  await Promise.all([
    build({ ...shared, entryPoints: [join(root, 'electron/main/index.ts')], outfile: join(outDir, 'main.cjs') }),
    build({ ...shared, entryPoints: [join(root, 'electron/preload/index.ts')], outfile: join(outDir, 'preload.cjs') }),
  ]);
}

function startElectron(devServerUrl) {
  if (child) {
    child.removeAllListeners('exit');
    child.kill();
    child = null;
  }
  const env = { ...process.env, VITE_DEV_SERVER_URL: devServerUrl };
  // Some shells export this; it would run Electron as plain Node.
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(electronBinary, ['.'], {
    cwd: root,
    stdio: 'inherit',
    env,
  });
  child.on('exit', (code) => {
    if (restarting) return;
    // Quitting the app window ends the dev session.
    process.exit(code ?? 0);
  });
}

await buildOnce();

const server = await createServer({ root, configFile: join(root, 'vite.config.ts'), mode: 'development' });
await server.listen();
const devServerUrl = server.resolvedUrls?.local?.[0] ?? 'http://localhost:5273/';
server.printUrls();

startElectron(devServerUrl);

// Rebuild + relaunch the main process whenever its sources change.
const watcher = await context({
  ...shared,
  entryPoints: [join(root, 'electron/main/index.ts'), join(root, 'electron/preload/index.ts')],
  outdir: outDir,
  outbase: join(root, 'electron'),
  plugins: [
    {
      name: 'restart-electron',
      setup(pluginBuild) {
        pluginBuild.onEnd((result) => {
          if (result.errors.length > 0) return;
          restarting = true;
          console.log('[dev] 主进程已重新构建，正在重启应用…');
          startElectron(devServerUrl);
          restarting = false;
        });
      },
    },
  ],
});
await watcher.watch();

const shutdown = async () => {
  try {
    await watcher.dispose();
    await server.close();
  } catch {
    // ignore
  }
  if (child) child.kill();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
