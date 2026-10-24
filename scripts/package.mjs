#!/usr/bin/env node
/**
 * Packaging wrapper.
 *
 * Two things on this class of machine break `electron-builder` when run by hand:
 *   1. NSIS needs a writable %TEMP% — a redirected/unwritable temp makes the
 *      installer stub fail with "Error writing temporary file".
 *   2. electron-builder shells out to `pnpm` to read the dependency tree, and
 *      `pnpm` may not be on PATH.
 * This script fixes both locally (no system change), then optionally produces a
 * portable ZIP so the app can be used even when the NSIS installer cannot run.
 *
 * Usage: node scripts/package.mjs [--dir] [--no-zip]
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const root = process.cwd();
const passthrough = process.argv.slice(2);
const dirOnly = passthrough.includes('--dir');
const skipZip = passthrough.includes('--no-zip');

const tempDir = join(root, '.tmp');
mkdirSync(tempDir, { recursive: true });

const env = {
  ...process.env,
  TMP: tempDir,
  TEMP: tempDir,
  ELECTRON_BUILDER_CACHE: process.env.ELECTRON_BUILDER_CACHE ?? join(root, '.eb-cache'),
};

// Prefer the workspace builder cache and mirror; both are optional overrides.
if (!env.ELECTRON_MIRROR && existsSync(join(root, '.electron-cache'))) {
  env.ELECTRON_MIRROR = 'https://registry.npmmirror.com/-/binary/electron/';
  env.ELECTRON_CUSTOM_DIR = '{{ version }}';
}

// electron-builder resolves `pnpm` from PATH; provide the local shim when needed.
// Windows env keys are case-insensitive but JavaScript objects are not: writing
// `PATH` next to an existing `Path` silently replaces the whole search path and
// makes later spawns (powershell.exe) fail with ENOENT.
const shimDir = join(root, '.tools');
if (existsSync(join(shimDir, 'pnpm.cmd'))) {
  const pathKey =
    Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'Path';
  const existing = env[pathKey] ?? '';
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'PATH' && key !== pathKey) delete env[key];
  }
  env[pathKey] = existing ? `${shimDir};${existing}` : shimDir;
}
delete env.ELECTRON_RUN_AS_NODE;

const args = ['--win', '--config', 'electron-builder.yml', ...(dirOnly ? ['--dir'] : [])];

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd: root, stdio: 'inherit', env, ...options });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

const builderCli = require.resolve('electron-builder/cli.js');
console.log(`[package] temp=${tempDir}`);
console.log(`[package] running electron-builder ${args.join(' ')}`);
await run(process.execPath, [builderCli, ...args]);

if (!dirOnly && !skipZip) {
  const version = require(join(root, 'package.json')).version;
  const source = join(root, 'release', 'win-unpacked');
  const zip = join(root, 'release', `My-Cinema-${version}-portable-win64.zip`);
  rmSync(zip, { force: true });
  console.log('[package] building portable zip (works without an NSIS installer)');
  await run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Compress-Archive -Path '${source}\\*' -DestinationPath '${zip}' -Force`,
  ]);
  console.log(`[package] portable build: ${zip}`);
}

// Double-clickable entry points that pin TEMP before touching NSIS.
await import('./make-launchers.mjs');

console.log('[package] done');
