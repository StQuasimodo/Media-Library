import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, it } from 'vitest';

it('开发监听更新实际入口，重启主进程与preload，退出时关闭启动器', async () => {
  const repo = process.cwd();
  mkdirSync(join(repo, '.harness'), { recursive: true });
  const fixture = mkdtempSync(join(repo, '.harness', 'dev-test-'));
  const fakeDir = join(fixture, 'fake-electron');
  // Spawn a real Node binary as the fake launcher. On Windows this must retain
  // the .exe suffix: relying on Electron's path.txt can produce an extensionless
  // path that exists but cannot be spawned by CreateProcess (ENOENT).
  const executable = join(fakeDir, basename(process.execPath));
  mkdirSync(fakeDir, { recursive: true });
  // Node runs the fixture package entry; no desktop or Electron binary is used.
  if (process.platform === 'win32') copyFileSync(process.execPath, executable);
  else symlinkSync(process.execPath, executable);
  mkdirSync(join(fixture, 'electron/main'), { recursive: true });
  mkdirSync(join(fixture, 'electron/preload'), { recursive: true });
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ type: 'commonjs', main: 'dist-electron/main.cjs' }));
  writeFileSync(join(fixture, 'vite.config.ts'), 'export default {server:{port:0}};');
  const log = join(fixture, 'reload.jsonl');
  const quit = join(fixture, 'quit');
  const mainPath = join(fixture, 'electron/main/index.ts');
  const preloadPath = join(fixture, 'electron/preload/index.ts');
  const main = (version: number) => `
    const {appendFileSync,existsSync}=require('node:fs');
    const preloadFile='preload.cjs'; const preload=require(__dirname+'/'+preloadFile);
    appendFileSync(${JSON.stringify(log)},JSON.stringify({main:${version},preload:preload.version,pid:process.pid})+'\\n');
    setInterval(()=>{if(existsSync(${JSON.stringify(quit)}))process.exit(0);},20);
  `;
  writeFileSync(mainPath, main(1));
  writeFileSync(preloadPath, 'export const version=1;');
  let output = '';
  const child = spawn(process.execPath, [join(repo, 'scripts/dev.mjs')], {
    cwd: fixture, env: { ...process.env, MY_CINEMA_DEV_ELECTRON_BINARY: executable },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  type Event = { main: number; preload: number; pid: number };
  const events = (): Event[] => existsSync(log)
    ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  async function waitFor(match: (event: Event) => boolean) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (events().some(match)) return;
      if (child.exitCode !== null) throw new Error(output);
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(`Reload timed out: ${output}`);
  }
  try {
    await waitFor((e) => e.main === 1 && e.preload === 1);
    writeFileSync(mainPath, main(2));
    await waitFor((e) => e.main === 2 && e.preload === 1);
    writeFileSync(preloadPath, 'export const version=2;');
    await waitFor((e) => e.main === 2 && e.preload === 2);
    expect(existsSync(join(fixture, 'dist-electron/main.cjs'))).toBe(true);
    expect(existsSync(join(fixture, 'dist-electron/preload.cjs'))).toBe(true);
    const exited = once(child, 'exit');
    // Windows forcibly terminates a target on process.kill(SIGTERM), bypassing
    // its JS handlers. Test window-close shutdown there; POSIX tests SIGTERM.
    if (process.platform === 'win32') writeFileSync(quit, '');
    else child.kill('SIGTERM');
    await exited;
    // The watcher must not leave any of the launchers alive after shutdown.
    for (const event of events()) {
      expect(() => process.kill(event.pid, 0)).toThrow();
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    for (const event of events()) {
      try { process.kill(event.pid, 'SIGKILL'); } catch { /* already stopped */ }
    }
    rmSync(fixture, { recursive: true, force: true });
  }
});
