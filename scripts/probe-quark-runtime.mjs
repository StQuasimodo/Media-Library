/** No-login compatibility probe; never reads an existing account configuration. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

if (!process.argv[2]) throw new Error('Usage: node scripts/probe-quark-runtime.mjs <official quark-drive.cjs>');
mkdirSync('.harness', { recursive: true });
const output = mkdtempSync(resolve('.harness/quark-probe-'));
const runtime = join(output, 'runtime');
const home = join(runtime, 'home');
mkdirSync(join(runtime, 'scripts'), { recursive: true });
mkdirSync(home);
const cli = join(runtime, 'scripts', 'quark-drive.cjs');
copyFileSync(resolve(process.argv[2]), cli);
// Do not inherit Codex/DSH/other Agent markers or a user's home/config paths.
const env = {};
for (const [key, value] of Object.entries(process.env)) {
  if (/^(path|pathext|systemroot|windir|comspec|systemdrive)$/i.test(key)) env[key] = value;
}
Object.assign(env, { HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, TEMP: home, TMP: home, NO_COLOR: '1' });
const checks = [];
try {
  for (const args of [['--version'], ['--help'], ['resolve-agent']]) {
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: runtime, env, encoding: 'utf8', timeout: 20_000, maxBuffer: 1024 * 1024, windowsHide: true,
    });
    const parsed = (result.stdout ?? '').split(/\r?\n/).flatMap(line => {
      try { const value = JSON.parse(line); return value.type === 'result' ? [value] : []; }
      catch { return []; }
    }).at(-1);
    // Allowlist report fields; raw stdout/stderr/configs are never published.
    checks.push({ command: args[0], exitCode: result.status, signal: result.signal,
      processError: result.error?.code ?? null,
      resultCode: typeof parsed?.code === 'number' ? parsed.code : null,
      message: typeof parsed?.msg === 'string' ? parsed.msg.slice(0, 500) : null,
      version: args[0] === '--version' && /^\d+\.\d+\.\d+[-\w.]*\s*$/.test(result.stdout ?? '') ? result.stdout.trim() : null,
    });
  }
  const report = {
    platform: process.platform, arch: process.arch, node: process.version,
    runtimeSHA256: createHash('sha256').update(readFileSync(cli)).digest('hex'),
    isolatedHome: true, inheritedAgentEnvironment: false, loginAttempted: false, checks,
    outcome: !checks.slice(0, 2).every(check => check.exitCode === 0) ? 'preflight_failed_or_inconclusive'
      : checks.some(check => check.resultCode === -104) ? 'agent_environment_rejected'
      : checks.every(check => check.exitCode === 0) ? 'preflight_passed_account_unverified' : 'preflight_failed_or_inconclusive',
  };
  const file = join(output, 'report.json');
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ report: file, ...report }, null, 2));
  if (report.outcome === 'preflight_failed_or_inconclusive') process.exitCode = 1;
} finally {
  // Only remove the isolated runtime created by this invocation.
  rmSync(runtime, { recursive: true, force: true });
}
