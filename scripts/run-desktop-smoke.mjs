import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
mkdirSync(join(root, '.harness'), { recursive: true });
const outfile = join(root, '.harness', 'desktop-smoke.cjs');
await build({
  entryPoints: [join(root, 'scripts', 'desktop-smoke.ts')], outfile,
  bundle: true, platform: 'node', target: 'node22', format: 'cjs',
  external: ['electron', 'better-sqlite3'],
});
const require = createRequire(import.meta.url);
const flags = process.argv.includes('--headless') ? ['--ozone-platform=headless', '--disable-gpu'] : [];
if (process.argv.includes('--no-sandbox')) flags.push('--no-sandbox');
if (process.argv.includes('--quark-sync-fixture') && process.platform==='linux') flags.push('--password-store=basic');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [...flags, outfile, ...process.argv.slice(2)], {
  cwd: root, stdio: 'inherit', env,
});
child.on('error', (error) => { console.error(error); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
