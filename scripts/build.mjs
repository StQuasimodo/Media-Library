import { build as esbuildBuild } from 'esbuild';
import { build as viteBuild } from 'vite';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const root = process.cwd();

function runTypecheck() {
  const tsc = require.resolve('typescript/bin/tsc');
  const result = spawnSync(process.execPath, [tsc, '--noEmit'], {
    stdio: 'inherit',
    cwd: root,
  });
  if (result.status !== 0) {
    console.error('\n[build] TypeScript 类型检查失败，已中止构建。');
    process.exit(result.status ?? 1);
  }
}

/** Main process + preload bundle to CommonJS, as Electron expects. */
async function buildElectron() {
  const outDir = join(root, 'dist-electron');
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const shared = {
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    logLevel: 'info',
    // Native + Electron modules stay external and are resolved at runtime.
    external: ['electron', 'better-sqlite3'],
    legalComments: 'none',
  };

  await esbuildBuild({
    ...shared,
    entryPoints: [join(root, 'electron/main/index.ts')],
    outfile: join(outDir, 'main.cjs'),
  });
  await esbuildBuild({
    ...shared,
    entryPoints: [join(root, 'electron/preload/index.ts')],
    outfile: join(outDir, 'preload.cjs'),
  });
}

async function buildRenderer() {
  await viteBuild({
    root,
    configFile: join(root, 'vite.config.ts'),
    mode: 'production',
    logLevel: 'info',
  });
}

const skipTypecheck = process.argv.includes('--no-typecheck');

console.log('[build] 1/3 类型检查');
if (!skipTypecheck) runTypecheck();
else console.log('[build] 已跳过类型检查');

console.log('[build] 2/3 打包主进程与 preload');
await buildElectron();

console.log('[build] 3/3 构建渲染进程');
await buildRenderer();

console.log('[build] 完成：dist-electron/ + dist/');
