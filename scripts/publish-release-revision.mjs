/** A user-authorized revision of an existing prerelease; preserve all original assets and tags. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const gh=args=>execFileSync('gh',args,{encoding:'utf8'}).trim();
const {version}=JSON.parse(readFileSync('package.json','utf8'));
const revision=process.env.RELEASE_REVISION;
assert.match(revision,/^rev(?:[2-9]|[1-9]\d+)$/);assert.ok(version.includes('-'));
const source=process.env.GITHUB_SHA || execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.match(source,/^[a-f0-9]{40}$/);
const repo=process.env.GITHUB_REPOSITORY || gh(['repo','view','--json','nameWithOwner','--jq','.nameWithOwner']);
const tag=`v${version}`;
const release=JSON.parse(gh(['api',`repos/${repo}/releases/tags/${tag}`]));
assert.ok(release.prerelease && !release.draft);
const originalTag=JSON.parse(gh(['api',`repos/${repo}/git/ref/tags/${tag}`])).object.sha;
const original=resolve('release'),output=join(original,revision);mkdirSync(output,{recursive:true});
for(const line of readFileSync(join(original,'SHA256SUMS.txt'),'utf8').trim().split(/\r?\n/)) {
  const match=/^([a-f0-9]{64})  (.+)$/.exec(line);assert.ok(match);
  assert.equal(createHash('sha256').update(readFileSync(join(original,match[2]))).digest('hex'),match[1]);
}
const setup=`My-Cinema-${version}-Setup.exe`,zip=`My-Cinema-${version}-portable-win64.zip`;
const renamedSetup=setup.replace('-Setup.exe',`-${revision}-Setup.exe`);
const renamedZip=zip.replace('-portable-',`-${revision}-portable-`);
copyFileSync(join(original,setup),join(output,renamedSetup));copyFileSync(join(original,zip),join(output,renamedZip));
for(const [oldName,newName] of [['INSTALL.cmd',`INSTALL-${revision}.cmd`],['RUN-PORTABLE.cmd',`RUN-PORTABLE-${revision}.cmd`]]) {
  const content=readFileSync(join(original,oldName),'utf8').replaceAll(setup,renamedSetup).replaceAll(zip,renamedZip)
    .replaceAll('RUN-PORTABLE.cmd',`RUN-PORTABLE-${revision}.cmd`).replaceAll('%~dp0portable',`%~dp0portable-${revision}`);
  writeFileSync(join(output,newName),content);
}
const payload=[renamedSetup,renamedZip,`INSTALL-${revision}.cmd`,`RUN-PORTABLE-${revision}.cmd`];
const digest=name=>createHash('sha256').update(readFileSync(join(output,name))).digest('hex');
const provenance={version,revision,buildSource:source,originalTagSource:originalTag,
  run:`https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`,assets:payload.map(name=>({name,sha256:digest(name)}))};
writeFileSync(join(output,`BUILD-${revision}.json`),JSON.stringify(provenance,null,2)+'\n');
const checked=[...payload,`BUILD-${revision}.json`];
const sums=`SHA256SUMS-${revision}.txt`;
writeFileSync(join(output,sums),checked.map(name=>`${digest(name)}  ${name}`).join('\n')+'\n');
const names=[...checked,sums];
assert.ok(names.every(name=>!release.assets.some(asset=>asset.name===name)),'Do not replace existing release assets.');
gh(['release','upload',tag,'--repo',repo,...names.map(name=>join(output,name))]);
const notes=join(output,'revision-notes.md');
const highlights=readFileSync('docs/RELEASE-NOTES.md','utf8').split(/^## /m)[1]?.trim() || '详见仓库发布说明。';
writeFileSync(notes,`## ${version} ${revision} 修订包（应用版本号保持不变）\n\n${highlights}\n\n请下载 **${renamedSetup}** 或 **${renamedZip}**。配套命令和校验文件均带 ${revision} 后缀。构建源码：${source}；原Tag和旧文件保留。\n\n---\n\n${release.body || ''}`);
gh(['release','edit',tag,'--repo',repo,'--notes-file',notes]);
assert.equal(JSON.parse(gh(['api',`repos/${repo}/git/ref/tags/${tag}`])).object.sha,originalTag);
console.log(`[release] Published ${version} ${revision} from ${source}; original tag and assets retained.`);
