/** Inspect the actual Windows package before publishing it. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('electron-builder'));
const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib'));
const asar = appBuilderRequire('@electron/asar');
const { version } = require('../package.json');
const output = join(process.cwd(), 'release');
const unpacked = join(output, 'win-unpacked');
const archive = join(unpacked, 'resources', 'app.asar');

function checkWindowsX64(path) {
  const bytes = readFileSync(path);
  assert.equal(bytes.toString('ascii', 0, 2), 'MZ', `${path}: missing PE header`);
  const header = bytes.readUInt32LE(0x3c);
  assert.equal(bytes.toString('ascii', header, header + 4), 'PE\0\0', `${path}: invalid PE signature`);
  assert.equal(bytes.readUInt16LE(header + 4), 0x8664, `${path}: expected x64 executable`);
}

checkWindowsX64(join(unpacked, 'My Cinema.exe'));
checkWindowsX64(join(unpacked, 'resources', 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'prebuilds', 'win32-x64.node'));
const packedManifest = JSON.parse(asar.extractFile(archive, 'package.json').toString());
assert.equal(packedManifest.version, version);
assert.equal(packedManifest.main, 'dist-electron/main.cjs');
for (const path of ['dist/index.html', 'dist-electron/main.cjs', 'dist-electron/preload.cjs']) {
  assert.deepEqual(asar.extractFile(archive, path), readFileSync(path), `${path}: packaged content differs from this build`);
}
// Check every Vite asset referenced by the packaged entry, not just index.html.
const html = readFileSync('dist/index.html', 'utf8');
const assets = [...html.matchAll(/(?:src|href)="\.\/(assets\/[^"?#]+)"/g)].map(match => match[1]);
assert.ok(assets.length >= 2, 'Expected production JS and CSS assets');
for (const asset of assets) assert.deepEqual(asar.extractFile(archive, `dist/${asset}`), readFileSync(join('dist', asset)));

const installer = `My-Cinema-${version}-Setup.exe`;
const portable = `My-Cinema-${version}-portable-win64.zip`;
assert.equal(readFileSync(join(output, installer)).toString('ascii', 0, 2), 'MZ');
assert.ok(statSync(join(output, installer)).size > 1_000_000, 'Installer is unexpectedly small');
assert.equal(readFileSync(join(output, portable)).readUInt32LE(0), 0x04034b50, 'Invalid portable ZIP header');
const files = [installer, portable, 'INSTALL.cmd', 'RUN-PORTABLE.cmd'];
const checksums = files.map(name => `${createHash('sha256').update(readFileSync(join(output, name))).digest('hex')}  ${name}`);
writeFileSync(join(output, 'SHA256SUMS.txt'), checksums.join('\n') + '\n');
console.log(`[release] Verified version ${version}, Windows x64 Electron/SQLite, production bundles and ${assets.length} Vite assets.`);
console.log(checksums.join('\n'));
