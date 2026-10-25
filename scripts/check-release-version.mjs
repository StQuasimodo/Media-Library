/** Refuse reused versions before spending time building a distributable. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function parse(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.([1-9]\d*))?$/.exec(version);
  if (!match) return null;
  const values = [Number(match[1]), Number(match[2]), Number(match[3]), ['alpha', 'beta', 'rc', undefined].indexOf(match[4]), Number(match[5] ?? 0)];
  return values.every(Number.isSafeInteger) ? values : null;
}
function compare(left, right) {
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const candidate = parse(version);
assert.ok(candidate, 'Version must be X.Y.Z or X.Y.Z-alpha.N / beta.N / rc.N (N starts at 1).');
if (process.argv.includes('--preview')) assert.ok(version.includes('-'), 'Preview distribution requires a new alpha.N / beta.N / rc.N version.');
const gh = args => execFileSync('gh', args, { encoding: 'utf8' }).trim();
const repo = process.env.GITHUB_REPOSITORY || gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
const tag = `v${version}`;
const refs = JSON.parse(gh(['api', `repos/${repo}/git/matching-refs/tags/${tag}`]));
assert.ok(!refs.some(ref => ref.ref === `refs/tags/${tag}`), `Tag ${tag} already exists; use a new version.`);
const releases = [];
for (let page = 1; ; page++) {
  const batch = JSON.parse(gh(['api', `repos/${repo}/releases?per_page=100&page=${page}`]));
  releases.push(...batch);
  if (batch.length < 100) break;
}
assert.ok(!releases.some(release => release.tag_name === tag), `Release ${tag} already exists; do not replace published assets.`);
for (const release of releases) {
  const previous = parse(release.tag_name.replace(/^v/, ''));
  if (!release.draft && previous) assert.ok(compare(candidate, previous) > 0, `${version} must be newer than published ${release.tag_name}.`);
}
console.log(`[release] New version ${version}; tag ${tag} is available.`);
