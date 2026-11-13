if(process.env.RELEASE_REVISION) { await import('./publish-release-revision.mjs'); process.exit(0); }
/** Publish verified artifacts with an argument array, independent of shell quoting. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const argument = name => {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  assert.ok(process.argv[index + 1] && !process.argv[index + 1].startsWith('--'), `Missing ${name} value.`);
  return process.argv[index + 1];
};
const gh = args => execFileSync('gh', args, { encoding: 'utf8' }).trim();
const source = argument('--source') || process.env.RELEASE_SOURCE_SHA || process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.match(source, /^[a-f0-9]{40}$/);
const manifest = JSON.parse(execFileSync('git', ['show', `${source}:package.json`], { encoding: 'utf8' }));
const { version } = manifest;
assert.match(version, /^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.[1-9]\d*)?$/);
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
let retainedRun = null;
if (process.env.RELEASE_BUILD_RUN_ID) {
  const runId = process.env.RELEASE_BUILD_RUN_ID;
  assert.match(runId, /^\d+$/);
  const run = JSON.parse(gh(['api', `repos/${repo}/actions/runs/${runId}`]));
  assert.equal(run.head_sha, source, 'Retained build must match the requested source commit.');
  const { jobs } = JSON.parse(gh(['api', `repos/${repo}/actions/runs/${runId}/jobs`]));
  assert.equal(run.status, 'completed', 'Retained build must be complete.');
  const workflow = run.path.split('@')[0];
  const integrated = workflow === '.github/workflows/integrated-preview.yml';
  assert.ok(integrated || workflow === '.github/workflows/release.yml', 'Unexpected source workflow.');
  const artifact = integrated ? 'My-Cinema-Integrated-Quark-Preview' : 'my-cinema-windows';
  assert.equal(process.env.RELEASE_BUILD_ARTIFACT || 'my-cinema-windows', artifact, 'Artifact and original workflow must match.');
  if (integrated) assert.equal(run.conclusion, 'success', 'Integrated preview must have passed its entire workflow.');
  const required = integrated ? [
    'Test and build integrated application', 'Check actual application and integrated Quark login',
    'Check controlled Quark scan, matching, resource details and incremental updates',
    'Preserve real Windows credentials through an application upgrade',
    'Package preview installer and portable version', 'Verify actual installer shortcut choices',
  ] : ['Run tests', 'Build production application', 'Check real Electron, preload and SQLite on Windows',
    'Check controlled Quark scan, matching, resource details and incremental updates',
    'Verify real Windows credential compatibility with v1.0.0',
    'Verify packaged files and write SHA-256 checksums', 'Verify actual installer shortcut choices'];
  assert.ok(jobs.some(job => required.every(name => job.steps.some(step => step.name === name && step.conclusion === 'success'))), 'Original test, package and installer verification must all pass.');
  retainedRun = run;
}
if (process.argv.includes('--verify-only')) {
  console.log(`[release] Verified ${version}, retained build identity and four artifact checksums; no publication performed.`);
  process.exit(0);
}
const temporary = mkdtempSync(join(tmpdir(), 'mycinema-release-'));
try {
  // Pin and verify the tag before release creation. Passing --target for an
  // already-built historical commit can require permissions beyond the runner token.
  const tag = `v${version}`;
  const refs = JSON.parse(gh(['api', `repos/${repo}/git/matching-refs/tags/${tag}`]));
  if (!refs.some(ref => ref.ref === `refs/tags/${tag}`)) execFileSync('git', ['push', 'origin', `${source}:refs/tags/${tag}`], { stdio: 'inherit' });
  const ref = JSON.parse(gh(['api', `repos/${repo}/git/ref/tags/${tag}`]));
  assert.equal(ref.object.type, 'commit');
  assert.equal(ref.object.sha, source, 'Release tag must point to the original build.');
  const notes = join(temporary, 'notes.md');
  const notesFile = argument('--notes-file');
  writeFileSync(notes, notesFile ? readFileSync(resolve(notesFile)) : execFileSync('git', ['show', `${source}:docs/RELEASE-NOTES.md`]));
  const buildFile = join(directory, 'BUILD.json');
  if (!existsSync(buildFile)) writeFileSync(buildFile, JSON.stringify({ version, source,
    buildRun: retainedRun ? String(retainedRun.id) : process.env.GITHUB_RUN_ID || null,
    buildUrl: retainedRun?.html_url || null,
    assets: assets.map(name => { const data=readFileSync(join(directory,name)); return {name,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')}; }),
  }, null, 2) + '\n');
  const build = JSON.parse(readFileSync(buildFile, 'utf8'));
  assert.equal(build.version, version); assert.equal(build.source, source);
  const delivery = [...assets, 'SHA256SUMS.txt', 'BUILD.json'];
  const releases = JSON.parse(gh(['api', `repos/${repo}/releases?per_page=100`, '--paginate', '--slurp'])).flat();
  let release = releases.find(row => row.tag_name === tag);
  if (!release) {
    gh(['release', 'create', tag, '--repo', repo, '--verify-tag', '--draft',
      '--title', `My Cinema v${version}`, '--notes-file', notes,
      ...(version.includes('-') ? ['--prerelease'] : []), '--latest=false']);
    release = JSON.parse(gh(['api', `repos/${repo}/releases?per_page=100`])).find(row => row.tag_name === tag);
  }
  assert.ok(release?.draft, 'Only an unpublished draft can be resumed; never replace a public release.');
  const identity = name => { const data=readFileSync(join(directory,name)); return {digest:'sha256:'+createHash('sha256').update(data).digest('hex'),size:data.length}; };
  for (const asset of release.assets) {
    assert.ok(delivery.includes(asset.name), 'Unexpected asset in draft.');
    const expected=identity(asset.name);assert.equal(asset.digest,expected.digest,'Existing draft asset differs; refusing overwrite.');assert.equal(asset.size,expected.size);
  }
  const missing=delivery.filter(name=>!release.assets.some(asset=>asset.name===name));
  if(missing.length) gh(['release','upload',tag,'--repo',repo,...missing.map(name=>join(directory,name))]);
  const uploaded=JSON.parse(gh(['api',`repos/${repo}/releases/${release.id}`]));
  assert.equal(uploaded.assets.length,delivery.length);
  for(const name of delivery){const asset=uploaded.assets.find(asset=>asset.name===name),expected=identity(name);assert.ok(asset);assert.equal(asset.digest,expected.digest);assert.equal(asset.size,expected.size);}
  gh(['release','edit',tag,'--repo',repo,'--title',`My Cinema v${version}`,'--notes-file',notes,
    '--draft=false',...(version.includes('-')?['--prerelease']:[]),'--latest=false']);
  console.log(uploaded.html_url);
  if (!version.includes('-')) {
    const release = JSON.parse(gh(['api', `repos/${repo}/releases/tags/v${version}`]));
    execFileSync('gh', ['api', '--method', 'PATCH', `repos/${repo}/releases/${release.id}`, '--input', '-'], {
      input: JSON.stringify({ make_latest: 'true' }), stdio: ['pipe', 'pipe', 'inherit'],
    });
  }
  console.log(`[release] Published v${version} from ${source}; all four artifact checksums verified.`);
} finally { rmSync(temporary, { recursive: true, force: true }); }
