import assert from 'node:assert/strict';

/** Keep historical changelogs in the repository, not in every release body. */
export function releaseNotesForVersion(notes, version) {
  const heading = `# My Cinema v${version}`;
  const section = notes.split(/(?=^# My Cinema v)/m)
    .find(part => part.split(/\r?\n/, 1)[0].trim() === heading);
  assert.ok(section, `Missing release notes for ${version}.`);
  return section.trim().replace(/\n---\s*$/, '').trimEnd() + '\n';
}
