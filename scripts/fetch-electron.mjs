#!/usr/bin/env node
/**
 * Robust Electron binary fetcher.
 *
 * The default `electron` postinstall downloads one huge zip over a single TLS
 * connection, which fails on flaky networks. This script resumes the archive in
 * ranges, then unpacks it into node_modules/electron/dist and writes path.txt,
 * which is all the `electron` package needs at runtime.
 */
import { createWriteStream, existsSync, mkdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const version = process.env.ELECTRON_VERSION ?? '45.0.0';
const platform = 'win32-x64';
const fileName = `electron-v${version}-${platform}.zip`;
const mirrors = [
  `https://registry.npmmirror.com/-/binary/electron/${version}/${fileName}`,
  `https://npmmirror.com/mirrors/electron/${version}/${fileName}`,
  `https://github.com/electron/electron/releases/download/v${version}/${fileName}`,
];

const root = process.cwd();
const cacheDir = join(root, '.electron-cache');
const zipPath = join(cacheDir, fileName);
const distDir = join(root, 'node_modules', 'electron', 'dist');

mkdirSync(cacheDir, { recursive: true });

async function totalSize(url) {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Range: 'bytes=0-0' },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 206) {
    const range = response.headers.get('content-range') ?? '';
    const total = Number.parseInt(range.split('/')[1] ?? '0', 10);
    await response.body?.cancel();
    return Number.isFinite(total) && total > 0 ? total : 0;
  }
  const length = Number.parseInt(response.headers.get('content-length') ?? '0', 10);
  await response.body?.cancel();
  return Number.isFinite(length) ? length : 0;
}

async function downloadChunk(url, start, end, attempt = 1) {
  try {
    const response = await fetch(url, {
      headers: { Range: `bytes=${start}-${end}` },
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok && response.status !== 206) {
      throw new Error(`HTTP ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength === 0) throw new Error('empty chunk');
    return buffer;
  } catch (error) {
    if (attempt >= 6) throw error;
    const wait = Math.min(8000, 500 * 2 ** attempt);
    console.log(`  chunk ${start}-${end} failed (${error.message}); retry ${attempt} in ${wait}ms`);
    await new Promise((resolve) => setTimeout(resolve, wait));
    return downloadChunk(url, start, end, attempt + 1);
  }
}

async function download() {
  let lastError = null;
  for (const url of mirrors) {
    console.log(`[electron] mirror: ${url}`);
    let total = 0;
    try {
      total = await totalSize(url);
    } catch (error) {
      lastError = error;
      console.log(`  size probe failed: ${error.message}`);
      continue;
    }
    if (!total) {
      lastError = new Error('unknown size');
      console.log('  unknown size, trying next mirror');
      continue;
    }
    console.log(`[electron] total ${(total / 1024 / 1024).toFixed(1)} MB`);

    const chunkSize = 4 * 1024 * 1024;
    let received = 0;
    const stream = createWriteStream(zipPath);
    try {
      for (let start = 0; start < total; start += chunkSize) {
        const end = Math.min(total - 1, start + chunkSize - 1);
        const buffer = await downloadChunk(url, start, end);
        stream.write(buffer);
        received += buffer.byteLength;
        const pct = ((received / total) * 100).toFixed(1);
        process.stdout.write(`\r[electron] ${pct}% (${(received / 1024 / 1024).toFixed(1)} MB)`);
      }
      await new Promise((resolve, reject) => {
        stream.end(() => resolve());
        stream.on('error', reject);
      });
      if (received !== total) throw new Error(`incomplete: ${received}/${total}`);
      console.log('\n[electron] download complete');
      return total;
    } catch (error) {
      lastError = error;
      stream.destroy();
      console.log(`\n  failed: ${error.message}`);
      rmSync(zipPath, { force: true });
    }
  }
  throw lastError ?? new Error('all mirrors failed');
}

function extract() {
  if (existsSync(distDir)) {
    console.log('[electron] dist already present, re-extracting');
    rmSync(distDir, { recursive: true, force: true });
  }
  mkdirSync(distDir, { recursive: true });
  console.log('[electron] extracting…');
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${distDir}' -Force`,
    ],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) throw new Error('Expand-Archive failed');
  writeFileSync(join(root, 'node_modules', 'electron', 'path.txt'), 'electron.exe', 'utf8');
  const exe = join(distDir, 'electron.exe');
  if (!existsSync(exe)) throw new Error('electron.exe missing after extraction');
  console.log(`[electron] ready: ${exe} (${(statSync(exe).size / 1024 / 1024).toFixed(1)} MB)`);
}

const ready = join(distDir, 'electron.exe');
if (existsSync(ready) && !process.argv.includes('--force')) {
  console.log('[electron] already installed, nothing to do');
  process.exit(0);
}

await download();
extract();
