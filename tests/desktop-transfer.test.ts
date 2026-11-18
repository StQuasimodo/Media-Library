import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {TestApp} from './helpers';
import {seedDesktopTransfer,transferService} from './desktop-transfer-fixture';
let app:TestApp;
beforeEach(()=>{app=new TestApp();seedDesktopTransfer(app);});afterEach(()=>app.dispose());
function exported(){return JSON.parse(readFileSync(transferService(app).exportForTv(join(app.dir,'transfer')).path,'utf8'));}
describe('Windows → TV portable transfer',()=>{
 it('exports real SQLite associations and ignored files, including temporarily missing files, without other accounts or pending suggestions',()=>{
  const p=exported();expect(p.formatVersion).toBe(2);expect(p.quarkTransfer.files.map((f:{fileId:string})=>f.fileId)).toEqual(['migrate-ignored-file','migrate-matrix-file','migrate-season-e01','migrate-season-e02']);expect(p.quarkTransfer.files[0]).toMatchObject({ignored:true,filmId:null,rootId:'migrate-root'});expect(p.quarkTransfer.files[1].filmId).toBe('desktop-matrix');expect(p.collectionFilms).toHaveLength(2);expect(p.films[1].series.franchise.title).toBe('犯罪宇宙');
 });
 it('never exports login/configuration stores and keeps the original desktop JSON format',()=>{
  writeFileSync(join(app.dir,'credentials.json'),JSON.stringify({tmdbApiKey:'never-copy-me'}));const p=exported();expect(JSON.stringify(p)).not.toContain('never-copy-me');expect(p).not.toHaveProperty('settings');expect(p).not.toHaveProperty('quarkSource');const legacy=JSON.parse(readFileSync(transferService(app).exportJson(join(app.dir,'archive')).path,'utf8'));expect(legacy.formatVersion).toBe(1);
 });
 it('survives a desktop restart with exactly the same matching and ignored decisions',()=>{const a=exported();app.restart();const b=exported();expect(b.quarkTransfer).toEqual(a.quarkTransfer);});
 it('refuses an oversized TV transfer without producing a partial output',()=>{
  vi.spyOn(app.repo,'listAllFilms').mockImplementation(()=>[{overview:'界'.repeat(3*1024*1024)}] as never);const directory=join(app.dir,'too-large');expect(()=>transferService(app).exportForTv(directory)).toThrow('8MiB');expect(existsSync(directory)).toBe(false);
 });
 it('agrees with the actual-export fixture consumed by Android instrumentation',()=>{
  const payload=exported();delete payload.exportedAt;
  const path=join(process.cwd(),'tests/fixtures/desktop-transfer-v2.json');
  if(process.env.MY_CINEMA_WRITE_TRANSFER_FIXTURE==='1')writeFileSync(path,JSON.stringify(payload,null,2)+'\n');
  expect(payload).toEqual(JSON.parse(readFileSync(path,'utf8')));
 });
});
