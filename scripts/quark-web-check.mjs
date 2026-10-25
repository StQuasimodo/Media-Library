import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpSync, copyFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const output = resolve('.harness/quark-web-check-app'); mkdirSync(output, { recursive: true });
await build({ entryPoints: ['tools/quark-web-check/main.ts'], outfile: join(output, 'main.cjs'), bundle: true, platform: 'node', target: 'node22', external: ['electron'] });
await build({ entryPoints: ['tools/quark-web-check/preload.ts'], outfile: join(output, 'preload.cjs'), bundle: true, platform: 'node', target: 'node22', external: ['electron'] });
for (const file of ['index.html', 'ui.js']) copyFileSync(join('tools/quark-web-check', file), join(output, file));
writeFileSync(join(output, 'package.json'), JSON.stringify({ name: 'my-cinema-quark-check', version: '0.1.0', main: 'main.cjs' }));
const electron = require('electron');
if (process.argv.includes('--package')) {
  if (process.platform !== 'win32') throw new Error('Build the portable Windows diagnostic on Windows');
  const dest = resolve('release/quark-web-check'); mkdirSync(dest, { recursive: true });
  cpSync(dirname(electron), dest, { recursive: true });
  renameSync(join(dest, 'electron.exe'), join(dest, 'My Cinema Quark Check.exe'));
  cpSync(output, join(dest, 'resources/app'), { recursive: true });
  writeFileSync(join(dest, 'README.txt'), 'My Cinema Quark Check - experimental standalone validation tool.\r\nRun My Cinema Quark Check.exe, sign in on the official page, return and check directory access.\r\nUser data is isolated from My Cinema. No account was validated by CI.\r\nClose and reopen to check real account persistence. Do not share cookies or tokens.\r\n');
  console.log('[quark-web-check] Portable files:', dest);
} else {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const args = process.argv.slice(2);
  const flags = args.includes('--headless') ? ['--ozone-platform=headless', '--disable-gpu'] : [];
  if (args.includes('--no-sandbox')) flags.push('--no-sandbox');
  const child = spawn(electron, [...flags, output, ...args], { stdio: 'inherit', env });
  child.on('error', error => { console.error(error); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
}
