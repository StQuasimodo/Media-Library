/** Publish only retained, verified TV APK bytes. Never rebuild, move a tag, or replace an asset. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const gh=args=>execFileSync('gh',args,{encoding:'utf8'}).trim();
async function retryRead(read){let failure;for(let attempt=0;attempt<10;attempt++){try{return read();}catch(error){failure=error;if(attempt<9)await delay(1000);}}throw failure;}
const repo=process.env.GITHUB_REPOSITORY || 'StQuasimodo/Media-Library';
const runId=process.env.TV_BUILD_RUN,source=process.env.TV_BUILD_SOURCE;
assert.match(runId,/^[1-9][0-9]+$/);assert.match(source,/^[0-9a-f]{40}$/);
const run=JSON.parse(gh(['api',`repos/${repo}/actions/runs/${runId}`]));
assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');assert.equal(run.head_sha,source);
assert.equal(run.path,'.github/workflows/android-tv.yml');
const jobs=JSON.parse(gh(['api',`repos/${repo}/actions/runs/${runId}/jobs`]));
const checks=jobs.jobs.flatMap(job=>job.steps);
for(const name of ['Build and lint native APK and separate instrumentation','Install, launch and exercise actual API 22'])
  assert.ok(checks.some(step=>step.name===name && step.conclusion==='success'),name);
assert.ok(checks.some(step=>['Verify API 21 minimum, v1 signature and universal Java APK','Verify API 21 minimum, v1 signature and ARMv7/x86 decoder'].includes(step.name)&&step.conclusion==='success'),'APK compatibility verification');
const output='.harness/tv-publish';mkdirSync(output,{recursive:true});
const gradle=execFileSync('git',['show',`${source}:android-tv/app/build.gradle`],{encoding:'utf8'});
const version=/versionName '([0-9.]+-(?:alpha|beta|rc)\.[0-9]+)'/.exec(gradle)?.[1];assert.ok(version);
gh(['run','download',runId,'--repo',repo,'--name',`my-cinema-tv-${version}`,'--dir',output]);
const build=JSON.parse(readFileSync(join(output,'BUILD.json'),'utf8'));
assert.equal(build.source,source);assert.equal(build.run,runId);assert.equal(build.version,version);
assert.equal(build.minSdk,21);assert.equal(build.v1SignatureVerified,true);
if(build.nativeLibraries){
  assert.deepEqual(build.nativeAbis,['armeabi-v7a','x86']);assert.equal(build.player,'LibVLC 3.7.7');
  const evidence=join(output,'evidence');
  gh(['run','download',runId,'--repo',repo,'--name','android-tv-api22-evidence','--dir',evidence]);
  const playback=JSON.parse(readFileSync(join(evidence,'.harness/tv-playback/report.json'),'utf8'));
  assert.equal(playback.result,'passed');assert.equal(playback.apiLevel,22);
  assert.ok(playback.decodedVideo>0&&playback.decodedAudio>0&&playback.displayedPictures>0,'Actual API22 playback must pass before distributing a decoder APK.');
  const code=Number(/versionCode (\d+)/.exec(gradle)?.[1]);
  if(code>=5){const dav=JSON.parse(readFileSync(join(evidence,'.harness/tv-playback/quark-dav-report.json'),'utf8'));assert.equal(dav.result,'passed');assert.equal(dav.buildRun,runId);assert.equal(dav.actualLocalWebDavServer,true);}
  if(code>=6){const dav=JSON.parse(readFileSync(join(evidence,'.harness/tv-playback/quark-dav-report.json'),'utf8'));assert.equal(dav.localForwardingHops,1);assert.equal(dav.byteExactDropAndExpiryRecovery,true);assert.equal(dav.nativePlaybackAfterDropAndExpiry,true);assert.equal(dav.manualReconnectResumes,true);assert.ok(dav.continuousPlaybackWallMs>=90000);}
  if(code>=7){const dav=JSON.parse(readFileSync(join(evidence,'.harness/tv-playback/quark-dav-report.json'),'utf8'));for(const check of ['boundedMultiSegmentByteExact','headWithoutUpstreamHead','suffixRangeByteExact','wrongInitialRangeRejected','concurrentExpirySingleRefresh','leaseApiCancellationVerified','playbackSessionRevoked','pausedReconnectPreserved','rapidReconnectVerified','stoppedSessionCannotRestart'])assert.equal(dav[check],true,check);}
}else assert.equal(build.nativeLibraries,false);
if(version!=='0.1.0-alpha.1'){
  const signer=execFileSync('git',['show',`${source}:android-tv/development-signing.sha256`],{encoding:'utf8'}).trim();
  assert.equal(build.signerSha256,signer,'Retained APK must use the pinned development signer.');
}
assert.ok(gradle.includes(`versionName '${build.version}'`));
const apk=`My-Cinema-TV-${build.version}-debug.apk`,tag=`tv-v${build.version}`;
const files=[apk,'BUILD.json','SHA256SUMS.txt'];
const digest=name=>createHash('sha256').update(readFileSync(join(output,name))).digest('hex');
assert.equal(digest(apk),build.sha256);assert.equal(readFileSync(join(output,apk)).length,build.bytes);
const lines=readFileSync(join(output,'SHA256SUMS.txt'),'utf8').trim().split(/\r?\n/);
const names=new Set();for(const line of lines){const match=/^([a-f0-9]{64})  (.+)$/.exec(line);assert.ok(match);assert.ok([apk,'BUILD.json'].includes(match[2]));assert.equal(digest(match[2]),match[1]);names.add(match[2]);}
assert.equal(names.size,2);
const refs=JSON.parse(gh(['api',`repos/${repo}/git/matching-refs/tags/${tag}`]));
const original=refs.find(ref=>ref.ref===`refs/tags/${tag}`);if(original)assert.equal(original.object.sha,source);
const releases=JSON.parse(gh(['api',`repos/${repo}/releases?per_page=100`]));
let release=releases.find(release=>release.tag_name===tag);
if(release){assert.ok(release.draft || (release.prerelease && release.assets.length===3));if(release.draft)assert.equal(release.target_commitish,source);}
const notes=join(output,'release-notes.md');
writeFileSync(notes,readFileSync('docs/TV-RELEASE-NOTES.md','utf8')+`\n\n构建源码：${source}。\n原始构建：https://github.com/${repo}/actions/runs/${runId}\n`);
if(!release){gh(['release','create',tag,'--repo',repo,'--target',source,'--title',`My Cinema TV ${build.version}（Android 5.1 开发预览）`,'--prerelease','--draft','--notes-file',notes]);
  release=await retryRead(()=>{const created=JSON.parse(gh(['api',`repos/${repo}/releases?per_page=100`])).find(release=>release.tag_name===tag);assert.ok(created);return created;});}
assert.ok(release);
for(const name of files){const existing=release.assets.find(asset=>asset.name===name);if(existing)assert.equal(existing.digest,`sha256:${digest(name)}`);
  else {assert.ok(release.draft,'Published releases must not be amended by this script.');gh(['release','upload',tag,'--repo',repo,join(output,name)]);}}
if(release.draft)gh(['release','edit',tag,'--repo',repo,'--draft=false','--prerelease','--latest=false']);
await retryRead(()=>{const published=JSON.parse(gh(['api',`repos/${repo}/releases/tags/${tag}`]));assert.equal(published.draft,false);assert.equal(published.prerelease,true);
  for(const name of files){const asset=published.assets.find(asset=>asset.name===name);assert.ok(asset);assert.equal(asset.digest,`sha256:${digest(name)}`);}
  assert.equal(JSON.parse(gh(['api',`repos/${repo}/git/ref/tags/${tag}`])).object.sha,source);});
console.log(`Published ${tag}: retained APK ${build.sha256} from verified run ${runId}.`);
