/** Publish verified artifacts with an argument array, independent of shell quoting. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const argument = name => {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  assert.ok(process.argv[index + 1] && !process.argv[index + 1].startsWith('--'), `Missing ${name} value.`);
  return process.argv[index + 1];
};
const gh = args => execFileSync('gh', args, { encoding: 'utf8' }).trim();
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
assert.match(version, /^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.[1-9]\d*)?$/);
const source = argument('--source') || process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.match(source, /^[a-f0-9]{40}$/);
const manifest = JSON.parse(execFileSync('git', ['show', `${source}:package.json`], { encoding: 'utf8' }));
assert.equal(manifest.version, version, 'Artifact version must match the source commit.');
const directory = resolve(argument('--directory') || 'release');
const assets = [`My-Cinema-${version}-Setup.exe`, `My-Cinema-${version}-portable-win64.zip`, 'INSTALL.cmd', 'RUN-PORTABLE.cmd'];
const lines = readFileSync(join(directory, 'SHA256SUMS.txt'), 'utf8').trim().split(/\r?\n/);
assert.equal(lines.length, assets.length);
const checked = new Set();
for (const line of lines) {
  const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
  assert.ok(match && assets.includes(match[2]) && !checked.has(match[2]), 'Unexpected or duplicate checksum entry.');
  assert.equal(createHash('sha256').update(readFileSync(join(directory, match[2]))).digest('hex'), match[1], `Checksum mismatch: ${match[2]}`);
  checked.add(match[2]);
}
const repo = process.env.GITHUB_REPOSITORY || gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
const temporary = mkdtempSync(join(tmpdir(), 'mycinema-release-'));
try {
  const notes = join(temporary, 'notes.md');
  writeFileSync(notes, execFileSync('git', ['show', `${source}:docs/RELEASE-NOTES.md`]));
  const args = ['release', 'create', `v${version}`, '--repo', repo, '--target', source,
    '--title', `My Cinema v${version}`, '--notes-file', notes,
    ...(version.includes('-') ? ['--prerelease'] : []),
    ...[...assets, 'SHA256SUMS.txt'].map(name => join(directory, name))];
  console.log(gh(args));
  if (!version.includes('-')) {
    const release = JSON.parse(gh(['api', `repos/${repo}/releases/tags/v${version}`]));
    execFileSync('gh', ['api', '--method', 'PATCH', `repos/${repo}/releases/${release.id}`, '--input', '-'], {
      input: JSON.stringify({ make_latest: 'true' }), stdio: ['pipe', 'pipe', 'inherit'],
    });
  }
  console.log(`[release] Published v${version} from ${source}; all four artifact checksums verified.`);
} finally { rmSync(temporary, { recursive: true, force: true }); }
