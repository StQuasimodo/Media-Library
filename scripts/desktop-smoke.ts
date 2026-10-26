/** Real Electron/preload/SQLite smoke test against an isolated disposable profile. */
import { app, BrowserWindow, Menu, clipboard } from 'electron';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { openLibraryDatabase } from '../electron/main/data/database';
import { LibraryRepository } from '../electron/main/data/repository';
import { LibraryService } from '../electron/main/services/library';
import { ImageCache } from '../electron/main/services/imageCache';
import { QuarkLibrary } from '../electron/main/services/quark/library';
import { installQuarkSyncFixture } from './quark-sync-fixture';

const root = process.cwd();
const output = mkdtempSync(join(root, '.harness', 'desktop-smoke-'));
const profile = join(output, 'profile');
mkdirSync(profile);
app.setPath('userData', profile);
const artworkArg = process.argv.indexOf('--artwork-dir');
const artworkDir = artworkArg >= 0 ? resolve(process.argv[artworkArg + 1]) : null;
const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));
const checks: string[] = [];
const errors: string[] = [];
const geometry: Record<string, unknown> = {};
const quarkFixture = process.argv.includes('--quark-fixture');
const quarkSyncFixture = process.argv.includes('--quark-sync-fixture');
let cloudFixture: ReturnType<typeof installQuarkSyncFixture> | null=null;

async function seed() {
  if (quarkFixture) {
    const tool = join(output, 'quark-drive.cjs');
    writeFileSync(tool, `
      const fs=require('node:fs'),p=require('node:path');
      if(process.argv[2]!=='browse')process.exit(2);
      const fid=process.argv[process.argv.indexOf('--parent-fid')+1];
      const tree={
        '0':[{fid:'media',filename:'影视',category:0}],
        media:[{fid:'show',filename:'庆余年',category:0},{fid:'film',filename:'The.Matrix.1999.1080p.mkv',category:1,size:1024}],
        show:[{fid:'episode',filename:'庆余年.第二季.第03集.mkv',category:1,size:2048}]
      };
      fs.mkdirSync('browse',{recursive:true});const file=p.resolve('browse/files.jsonl');
      fs.writeFileSync(file,(tree[fid]||[]).map(v=>JSON.stringify(v)).join('\\n'));
      console.log(JSON.stringify({code:0,type:'result',action:'browse',data:{hasMore:false,file_list:[]}}));
      console.log(JSON.stringify({code:0,type:'artifact',action:'browse',data:{file_path:file,format:'jsonl'}}));
    `);
    new QuarkLibrary(profile).setTool(tool);
  }
  const { db } = openLibraryDatabase(join(profile, 'library.db'));
  const repo = new LibraryRepository(db);
  const images = new ImageCache({ root: join(profile, 'images'), fetchImpl: (async (url: string) => {
    const name = new URL(String(url)).pathname.split('/').at(-1)!;
    const file = artworkDir && join(artworkDir, name);
    return file && existsSync(file)
      ? new Response(readFileSync(file), { headers: { 'content-type': 'image/jpeg' } })
      : new Response('', { status: 404 });
  }) as typeof fetch });
  const library = new LibraryService({ repo, images });
  const films = [];
  for (const [index, [title, original, prefix]] of [
    ['搏击俱乐部', 'Fight Club', 'fight'],
    ['黑客帝国', 'The Matrix', 'matrix'],
  ].entries()) {
    const item = await library.importCandidate({
      source: 'tmdb', externalId: prefix === 'fight' ? '550' : '603', mediaType: 'movie', title,
      originalTitle: original, year: 1999, overview: '这是一份用于界面验收的独立收藏，不包含用户的个人数据。',
      posterUrl: `https://image.tmdb.org/${prefix}-poster.jpg`,
      backdropUrl: `https://image.tmdb.org/${prefix}-backdrop.jpg`,
      tagline: null, runtime: prefix === 'fight' ? 139 : 136,
      genres: prefix === 'fight' ? ['剧情', '悬疑'] : ['动作', '科幻'], originalLanguage: 'en', popularity: 1,
    }, { personalRating: 9, favoriteReason: '留住第一次看见这段光影时的感受。', personalReview: '在重看中，找到新的细节。', collectedAt: `2020-01-0${index + 1}T00:00:00.000Z` });
    films.push(item);
  }
  const missing = library.createManualFilm({ title: '没有剧照的收藏', year: 2001, entry: { collectedAt: '2019-01-01T00:00:00.000Z' } });
  const collection = library.createCollection({ name: '现实的另一面', description: '沿着电影里的线索，重新看见熟悉的世界。\n关于记忆、选择，以及那些值得重看的瞬间。' });
  for (const film of films) library.addFilmToCollection(collection.id, film.entry.id);
  const emptyCollection = library.createCollection({ name: '还未开始的选辑' });
  db.close();
  return { films, missing, collection, emptyCollection };
}

async function verify(win: BrowserWindow, data: Awaited<ReturnType<typeof seed>>) {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  async function waitFor(code: string) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (await js(code)) return;
      await delay(40);
    }
    throw new Error(`Readiness timed out: ${code}`);
  }
  async function route(path: string, ready: string) {
    await js(`location.hash = ${JSON.stringify('#' + path)};`);
    await waitFor(ready);
    // Let layout, decoded artwork and CSS transitions settle before capture.
    await delay(550);
  }
  async function shot(name: string, width = 1440, height = 900) {
    win.setContentSize(width, height);
    await delay(350);
    const metrics = await js(`({
      width:innerWidth,height:innerHeight,
      topbarTop:document.querySelector('.topbar').getBoundingClientRect().top,
      pageOverflow:document.querySelector('.page').scrollWidth > document.querySelector('.page').clientWidth + 1,
      brokenImages:[...document.images].filter(i=>i.complete && !i.naturalWidth).length
    })`);
    assert.equal(metrics.pageOverflow, false, `${name}: horizontal page overflow`);
    assert.equal(metrics.brokenImages, 0, `${name}: broken images`);
    assert.equal(metrics.topbarTop, 0, `${name}: navigation moved out of view`);
    assert.equal(await js("document.querySelector('.sidebar') === null && document.querySelectorAll('nav[aria-label=\"主导航\"]').length === 1"), true, `${name}: shared cinema navigation`);
    if (await js("!!document.querySelector('.home')")) {
      assert.equal(await js("document.querySelector('.sidebar') === null"), true, 'home must use the cinema navigation');
      if (await js("document.querySelector('.page').scrollTop === 0")) {
        const actionBottom = await js("document.querySelector('.hero-actions .btn-primary').getBoundingClientRect().bottom");
        assert.ok(actionBottom <= height, `${name}: primary action below the initial viewport`);
      }
    }
    geometry[name] = metrics;
    writeFileSync(join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
    checks.push(name);
  }
  await waitFor("!!document.querySelector('.focus-rail .rail-item')");
  assert.equal(Menu.getApplicationMenu(),null,'production app must not expose native Edit/View menus');
  assert.equal(win.isMenuBarVisible(),false,'native menu bar must be hidden');
  checks.push('production native menu removed');
  assert.equal(await js('typeof window.cinema.library.home'), 'function');
  assert.equal((await js('window.cinema.app.info()')).metadataCredentialState, quarkSyncFixture ? 'configured' : 'missing');
  assert.equal(await js('window.cinema.library.stats().then(stats => stats.totalFilms)'), 3);
  checks.push('real preload IPC and SQLite');
  assert.equal(await js("document.querySelectorAll('.home .poster-card').length"), 0, 'home must not duplicate the focus rail');
  if (artworkDir) {
    await waitFor("document.querySelector('.rail-art img')?.naturalWidth > 0");
    await waitFor("!!document.querySelector('.hero-layer:last-child')?.style.backgroundImage");
    checks.push('cached artwork loaded through mycinema protocol');
  }
  await delay(550);
  await shot('01-home');
  await js("document.querySelector('.rail-item').focus()");
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
  await waitFor(`document.querySelector('.hero-title')?.textContent === ${JSON.stringify(data.films[0].film.title)}`);
  checks.push('keyboard rail changes hero');
  assert.equal(await js("document.querySelector('.page').scrollTop"), 0, 'rail selection must not scroll the page vertically');
  await delay(550);
  await shot('02-home-focus');
  await js("document.querySelector('.cinema-stage-bottom button').click()");
  await waitFor("document.querySelector('.page').scrollTop > 0");
  await delay(550);
  assert.equal(await js("document.querySelector('.app-shell').dataset.scrolled"), 'true');
  await shot('11-home-curation');
  await js("document.querySelector('.page').scrollTo({top:0,behavior:'instant'})");
  await waitFor("document.querySelector('.page').scrollTop === 0");
  for (const [width, height] of [[1024,680],[1280,800],[1920,1080]]) await shot(`home-${width}`, width, height);
  win.setContentSize(1440,900);
  await js("document.querySelector('.page').scrollTo({top:document.querySelector('.page').scrollHeight,behavior:'instant'})");
  await waitFor("document.querySelector('.page').scrollTop > 0");
  await route('/library', "!!document.querySelector('.poster-grid')");
  assert.equal(await js("document.querySelector('.page').scrollTop"), 0);
  checks.push('route change resets page scroll');
  await shot('03-library');
  await js(`(() => {
    const input = document.querySelector('[aria-label="搜索影视库"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Matrix');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor("document.querySelector('.result-count')?.textContent === '1 部' && document.querySelector('.poster-title')?.textContent === '黑客帝国'");
  await js("document.querySelector('.active-filters button').click()");
  await waitFor("document.querySelector('.result-count')?.textContent === '3 部'");
  await js(`(() => {
    const select = document.querySelector('[aria-label="按年份筛选"]');
    select.value = '2001'; select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor("document.querySelector('.result-count')?.textContent === '1 部' && document.querySelector('.poster-title')?.textContent === '没有剧照的收藏'");
  await js("document.querySelector('.active-filters button').click()");
  await waitFor("document.querySelector('.result-count')?.textContent === '3 部'");
  checks.push('library search, year filter and clear through real UI');
  if(process.platform==='win32') {
    const previousClipboard=await clipboard.readText();
    try {
      await js(`(() => {const input=document.querySelector('[aria-label="搜索影视库"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Matrix');
        input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();})()`);
      win.webContents.focus();
      for(const key of ['A','C']) {
        win.webContents.sendInputEvent({type:'keyDown',keyCode:key,modifiers:['control']});
        win.webContents.sendInputEvent({type:'keyUp',keyCode:key,modifiers:['control']});
      }
      await delay(120);
      assert.equal((await clipboard.readText())==='Matrix',true,'standard text copy must work without visible native menus');
      checks.push('Windows clipboard shortcuts work with no native menu');
      await js("document.querySelector('.active-filters button').click()");
      await waitFor("document.querySelector('.result-count')?.textContent === '3 部'");
    } finally {await clipboard.writeText(previousClipboard);}
  }
  await shot('library-1024', 1024, 680);
  win.setContentSize(1440, 900);
  await route(`/film/${data.films[0].film.id}`, "!!document.querySelector('.film-title')");
  assert.equal(await js("document.querySelector('.film-section-head')?.textContent.includes('我的记录')"), true);
  await shot('04-film');
  await js("document.querySelector('.film-tools summary').click()");
  await waitFor("document.querySelector('.film-tools').open");
  await js("[...document.querySelectorAll('.film-tools button')].find(b=>b.textContent.includes('编辑资料')).click()");
  await waitFor("!!document.querySelector('.modal')");
  await js("[...document.querySelectorAll('.modal button')].find(b=>b.textContent.trim()==='取消').click()");
  await waitFor("!document.querySelector('.modal')");
  await js("document.querySelector('.film-tools').open = false; document.querySelector('.cinema-primary').click()");
  await waitFor("document.querySelector('.page').scrollTop > 0");
  await delay(550);
  const resourceTop = await js("document.querySelector('#resources').getBoundingClientRect().top");
  assert.ok(resourceTop >= 88 && resourceTop < 900, 'resource shortcut must leave the heading visible below navigation');
  checks.push('film more-actions edit dialog and resource navigation');
  await js("document.querySelector('.page').scrollTo({top:0,behavior:'instant'})");
  await shot('film-1024', 1024, 680);
  win.setContentSize(1440, 900);
  await route('/collections', "!!document.querySelector('.collection-grid')");
  await shot('05-collections');
  await js("document.querySelector('.collection-actions button').click()");
  await waitFor("!!document.querySelector('.modal')");
  assert.equal(await js("location.hash"), '#/collections', 'edition edit must not follow the cover link');
  await js("[...document.querySelectorAll('.modal button')].find(b=>b.textContent.trim()==='取消').click()");
  await waitFor("!document.querySelector('.modal')");
  checks.push('edition edit controls do not navigate');
  await route(`/collections/${data.collection.id}`, "!!document.querySelector('.collection-stage-title')");
  assert.equal(await js("document.querySelectorAll('.collection-film').length"), 2);
  await shot('06-collection');
  await js("document.querySelector('.collection-stage .btn').click()");
  await waitFor("!!document.querySelector('.modal .row-card')");
  await js("document.querySelector('.modal .row-card button').click()");
  await waitFor("document.querySelectorAll('.collection-film').length === 3");
  await js("[...document.querySelectorAll('.modal button')].find(b=>b.textContent.trim()==='完成').click()");
  await js(`document.querySelector('[aria-label="从专题中移除 ${data.missing.film.title}"]').click()`);
  await waitFor("document.querySelectorAll('.collection-film').length === 2");
  assert.equal(await js(`window.cinema.collections.detail(${JSON.stringify(data.collection.id)}).then(d=>d.entries.length)`), 2);
  checks.push('collection add/remove through real UI and IPC');
  await route(`/collections/${data.emptyCollection.id}`, `document.querySelector('.collection-stage-title')?.textContent === ${JSON.stringify(data.emptyCollection.name)}`);
  assert.equal(await js("document.querySelectorAll('.collection-film').length"), 0);
  await shot('08-collection-empty');
  await route(`/film/${data.missing.film.id}`, `document.querySelector('.film-title')?.textContent === ${JSON.stringify(data.missing.film.title)}`);
  await shot('07-film-no-art');
  await route('/watchlist', "document.querySelectorAll('.watchlist-list .row-card').length === 3");
  await shot('12-watchlist');
  await shot('watchlist-1024', 1024, 680);
  win.setContentSize(1440, 900);
  const markedEntry = await js("document.querySelector('.watchlist-list .row-title').textContent");
  await js("document.querySelector('.watchlist-list .row-actions button').click()");
  await waitFor("document.querySelectorAll('.watchlist-list .row-card').length === 2");
  assert.equal(await js(`window.cinema.library.list({watchStatus:'watching'}).then(items=>items.some(e=>e.film.title===${JSON.stringify(markedEntry)}))`), true);
  checks.push('watchlist status update persists through real IPC');
  await route('/settings', "!!document.querySelector('.settings-layout')");
  await shot('13-settings');
  await route('/settings#quark', "!!document.querySelector('#quark')");
  assert.equal(await js("location.hash.startsWith('#/settings')"), true);
  assert.equal(await js("document.querySelector('.page').scrollTop > 0"), true, 'settings anchor must survive page scroll reset');
  assert.equal(await js("[...document.querySelectorAll('#quark button')].some(b=>b.textContent==='关联夸克账号')"), true);
  assert.equal((await js("window.cinema.quarkWeb.status()")).state, 'not_checked', 'fresh isolated profile must not claim a verified account');
  await shot('14-quark-connection');
  if (process.argv.includes('--quark-web-probe')) {
    const connected = await js("window.cinema.quarkWeb.check()");
    assert.equal(connected.state, 'login_required', 'empty integrated session must require login');
    await js("window.cinema.quarkWeb.connect()");
    const remote = BrowserWindow.getAllWindows().find(window => window !== win);
    assert.ok(remote, 'integrated official login window created');
    assert.equal(await remote.webContents.executeJavaScript("typeof window.cinema"), 'undefined');
    assert.equal(await remote.webContents.executeJavaScript("typeof require"), 'undefined');
    remote.close();
    assert.equal((await js("window.cinema.quarkWeb.disconnect()")).state, 'login_required');
    checks.push('integrated web login IPC, real anonymous endpoint and remote isolation');
  }
  if (quarkFixture) {
    await js("document.querySelector('#quark details').open = true");
    await waitFor("[...document.querySelectorAll('#quark button')].some(b=>b.textContent==='选择云端文件夹' && !b.disabled)");
    await js("[...document.querySelectorAll('#quark button')].find(b=>b.textContent==='选择云端文件夹').click()");
    await waitFor("!!document.querySelector('.quark-folders button:not(:disabled)')");
    await js("[...document.querySelectorAll('.quark-folders button')].find(b=>b.textContent.trim()==='影视').click()");
    await waitFor("document.querySelector('.quark-breadcrumbs')?.textContent.includes('影视') && !!document.querySelector('.modal-footer button:not(:disabled)')");
    await js("[...document.querySelectorAll('.modal-footer button')].find(b=>b.textContent==='读取此文件夹').click()");
    await waitFor("document.querySelectorAll('.quark-video').length === 2");
    assert.equal(await js("window.cinema.quark.status().then(s=>s.inventory.videos.length)"), 2);
    assert.equal(await js("window.cinema.library.stats().then(s=>s.totalFilms)"), 3);
    checks.push('Quark read-only folder UI/IPC with fixture CLI (not live account)');
  }
  await js("document.querySelector('#quark').scrollIntoView({block:'start',behavior:'instant'})");
  await shot('09-quark-folder');
  const extraFilmIds: string[]=[];
  if (quarkSyncFixture) {
    assert.ok(cloudFixture);
    await js("[...document.querySelectorAll('#quark button')].find(b=>b.textContent==='检查连接').click()");
    await waitFor("[...document.querySelectorAll('#quark button')].some(b=>b.textContent==='浏览云端目录' && !b.disabled)");
    await js("[...document.querySelectorAll('#quark button')].find(b=>b.textContent==='浏览云端目录').click()");
    await waitFor("[...document.querySelectorAll('#quark button')].some(b=>b.textContent==='文件夹 · 验证影视')");
    await js("[...document.querySelectorAll('#quark button')].find(b=>b.textContent==='文件夹 · 验证影视').click()");
    await waitFor("[...document.querySelectorAll('#quark button')].some(b=>b.textContent==='使用当前目录并开始匹配' && !b.disabled)");
    await js("[...document.querySelectorAll('#quark button')].find(b=>b.textContent==='使用当前目录并开始匹配').click()");
    await waitFor("document.querySelectorAll('.quark-match-group[data-match-state=review]').length===2");
    let sync=await js('window.cinema.quarkSync.status()');
    assert.equal(sync.videos,3);assert.equal(sync.groups.length,2);
    await js("document.querySelector('.quark-sync-panel').scrollIntoView({block:'start',behavior:'instant'})");
    await shot('15-quark-matches');
    await js("[...document.querySelectorAll('#quark button')].find(b=>b.textContent==='确认 2 组高置信匹配').click()");
    await waitFor("[...document.querySelectorAll('#quark [role=status]')].some(node=>node.textContent.includes('2 组已关联'))");
    sync=await js('window.cinema.quarkSync.status()');
    const tv=sync.groups.find((group: any)=>group.query.mediaType==='tv').film;
    const movieGroup=sync.groups.find((group: any)=>group.query.mediaType==='all').film;
    assert.notEqual(tv.id,movieGroup.id,'same TMDB numeric id in movie/tv namespaces must remain distinct');
    assert.equal(movieGroup.id,data.films[1].film.id,'existing movie must be reused');
    extraFilmIds.push(tv.id);
    let tvDetail=await js(`window.cinema.library.detail(${JSON.stringify(tv.id)})`);
    assert.equal(tvDetail.cloudResources.length,2);
    assert.ok(tvDetail.film.posterPath,'cloud matching caches imported artwork');
    const movieDetail=await js(`window.cinema.library.detail(${JSON.stringify(movieGroup.id)})`);
    assert.equal(movieDetail.entry.personalRating,9);
    assert.equal(movieDetail.cloudResources[0].size,2_000_000_000);
    assert.equal(movieDetail.cloudResources[0].technical.resolution,'2160p');
    assert.equal(movieDetail.cloudResources[0].technical.videoCodec,'H.265 / HEVC');
    assert.deepEqual(movieDetail.cloudResources[0].technical.audioCodecs,['TrueHD','Atmos']);
    assert.equal(tvDetail.cloudResources[0].technical.encoder,'x265');
    assert.equal(tvDetail.cloudResources[0].technical.bitDepth,10);
    const searches=cloudFixture.searches();
    cloudFixture.incremental();
    await js('window.cinema.quarkSync.scan()');
    await waitFor("window.cinema.quarkSync.status().then(s=>!s.busy)");
    tvDetail=await js(`window.cinema.library.detail(${JSON.stringify(tv.id)})`);
    assert.equal(tvDetail.cloudResources.length,3);assert.equal(cloudFixture.searches(),searches,'incremental episodes reuse a confirmed match');
    cloudFixture.removeSecond();await js('window.cinema.quarkSync.scan()');
    await waitFor("window.cinema.quarkSync.status().then(s=>!s.busy)");
    tvDetail=await js(`window.cinema.library.detail(${JSON.stringify(tv.id)})`);
    assert.equal(tvDetail.cloudResources.find((file:any)=>file.fileId==='sync-e2').present,false);
    const completed=(await js('window.cinema.quarkSync.status()')).source.lastScanAt;
    cloudFixture.setFailure(true);await js('window.cinema.quarkSync.scan()');
    await waitFor("window.cinema.quarkSync.status().then(s=>!s.busy)");
    assert.equal((await js('window.cinema.quarkSync.status()')).source.lastScanAt,completed,'failed recursive read must not replace a complete inventory');
    cloudFixture.setFailure(false);
    await route(`/film/${tv.id}`,"document.querySelectorAll('.cloud-resource').length===3");
    await js("document.querySelector('#resources').scrollIntoView({block:'start',behavior:'instant'})");
    assert.equal(await js("document.querySelector('.cloud-resources').textContent.includes('H.265 / HEVC')"),true);
    await shot('16-quark-cloud-resources');
    cloudFixture.addSeasons();await js('window.cinema.quarkSync.scan()');
    await waitFor('window.cinema.quarkSync.status().then(s=>!s.busy)');
    await route('/settings',"!!document.querySelector('#quark')");
    await waitFor("[...document.querySelectorAll('#quark button')].some(b=>b.textContent==='确认导入第2季并关联' && !b.disabled)");
    await js("[...document.querySelectorAll('#quark button')].find(b=>b.textContent==='确认导入第2季并关联').click()");
    await waitFor("window.cinema.quarkSync.status().then(s=>s.groups.some(g=>g.season===2 && g.film))");
    await waitFor("[...document.querySelectorAll('#quark button')].some(b=>b.textContent==='手动创建第3季并关联' && !b.disabled)");
    await js("[...document.querySelectorAll('#quark button')].find(b=>b.textContent==='手动创建第3季并关联').click()");
    await waitFor("window.cinema.quarkSync.status().then(s=>s.groups.some(g=>g.season===3 && g.film))");
    const seasons=await js('window.cinema.quarkSync.status()');
    const second=seasons.groups.find((g:any)=>g.season===2).film;
    const obscure=seasons.groups.find((g:any)=>g.season===3).film;
    extraFilmIds.push(second.id,obscure.id);
    const secondDetail=await js(`window.cinema.library.detail(${JSON.stringify(second.id)})`);
    assert.notEqual(second.id,tv.id);assert.equal(secondDetail.film.externalId,'603:season:2');
    assert.equal(secondDetail.film.year,2019);assert.equal(secondDetail.cloudResources.length,1);
    assert.equal((await js(`window.cinema.library.detail(${JSON.stringify(obscure.id)})`)).film.metadataSource,'manual');
    const refreshed=await js(`window.cinema.metadata.refresh(${JSON.stringify(second.id)})`);
    assert.equal(refreshed.externalId,'603:season:2');assert.equal(refreshed.year,2019);
    checks.push('independent TV seasons, real season endpoint import/refresh and missing-title manual creation through UI/IPC');
    await js('window.cinema.quarkWeb.disconnect()');
    assert.equal((await js(`window.cinema.library.detail(${JSON.stringify(tv.id)})`)).cloudResources.every((file:any)=>!file.active),true);
    checks.push('controlled Quark/TMDB: select folder through UI, recurse, match, confirm, real import/cache/SQLite, typed IDs, increment, missing files, failed scan and session isolation (not live account)');
    async function openTvSeasons() {
      await js("document.querySelector('[aria-label=添加影视作品]').click()");
      await waitFor("!!document.querySelector('#import-query')");
      await js("(()=>{const input=document.querySelector('#import-query');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'绝命毒师');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
      await js("[...document.querySelectorAll('.modal button')].find(b=>b.textContent.trim()==='搜索').click()");
      await waitFor("[...document.querySelectorAll('.import-item button')].some(b=>b.textContent==='选择季')");
      await js("[...document.querySelectorAll('.import-item button')].find(b=>b.textContent==='选择季').click()");
      await waitFor("document.querySelectorAll('[data-season-number]').length===6");
    }
    await openTvSeasons();await shot('17-tmdb-season-picker');
    await js("document.querySelector('[data-season-number=\"1\"] button').click()");
    await waitFor("document.querySelector('.modal-title')?.textContent==='确认导入影视资料'");
    await js("[...document.querySelectorAll('.modal-footer button')].find(b=>b.textContent.includes('确认导入')).click()");
    await waitFor("!document.querySelector('.modal')");
    const firstSeason=(await js("window.cinema.library.list({search:'绝命毒师'})")).find((entry:any)=>entry.film.externalId==='1396:season:1');
    assert.ok(firstSeason);extraFilmIds.push(firstSeason.filmId);
    await js(`window.cinema.library.updateEntry(${JSON.stringify(firstSeason.id)},{personalRating:8.5})`);
    await openTvSeasons();
    assert.equal(await js("document.querySelector('[data-season-number=\"1\"] input').disabled"),true);
    await js("document.querySelector('[data-season-number=\"2\"] input').click();document.querySelector('[data-season-number=\"3\"] input').click()");
    await js("[...document.querySelectorAll('.season-picker button')].find(b=>b.textContent==='导入所选 2 季').click()");
    await waitFor("document.querySelector('[data-season-number=\"2\"] input').disabled && document.querySelector('[data-season-number=\"3\"] input').disabled");
    await waitFor("[...document.querySelectorAll('.season-picker button')].some(b=>b.textContent==='收藏整剧' && !b.disabled)");
    await shot('18-tmdb-seasons-collected');
    const imported=await js("window.cinema.library.list({search:'绝命毒师'})");
    assert.equal(imported.length,3);assert.equal(imported.find((entry:any)=>entry.id===firstSeason.id).personalRating,8.5);
    for(const entry of imported)if(entry.id!==firstSeason.id)extraFilmIds.push(entry.filmId);
    assert.equal(imported.find((entry:any)=>entry.film.externalId==='1396:season:2').film.overview,null);

    cloudFixture.setSeasonFailure(5);
    await js("document.querySelector('[data-season-number=\"4\"] input').click();document.querySelector('[data-season-number=\"5\"] input').click()");
    await js("[...document.querySelectorAll('.season-picker button')].find(b=>b.textContent==='导入所选 2 季').click()");
    await waitFor("document.querySelector('.season-picker [role=alert]')?.textContent.includes('已保存 1 季')");
    assert.equal(await js("document.querySelector('[data-season-number=\"4\"] input').disabled"),true);
    assert.equal(await js("document.querySelector('[data-season-number=\"5\"] input').disabled"),false);
    cloudFixture.setSeasonFailure(null);
    await waitFor("[...document.querySelectorAll('.season-picker button')].some(b=>b.textContent==='导入所选 1 季' && !b.disabled)");
    await js("[...document.querySelectorAll('.season-picker button')].find(b=>b.textContent==='导入所选 1 季').click()");
    await waitFor("document.querySelector('[data-season-number=\"5\"] input').disabled");
    await waitFor("[...document.querySelectorAll('.season-picker button')].some(b=>b.textContent==='收藏整剧' && !b.disabled)");
    for (const entry of await js("window.cinema.library.list({search:'绝命毒师'})"))
      if(!extraFilmIds.includes(entry.filmId))extraFilmIds.push(entry.filmId);
    checks.push('season batch partial failure preserves completed imports and retries only the remaining season');
    await js("[...document.querySelectorAll('.season-picker button')].find(b=>b.textContent==='收藏整剧').click()");
    await waitFor("document.querySelector('.modal-title')?.textContent==='确认导入影视资料'");
    await js("[...document.querySelectorAll('.modal-footer button')].find(b=>b.textContent.includes('确认导入')).click()");
    await waitFor("!document.querySelector('.modal')");
    const whole=(await js("window.cinema.library.list({search:'绝命毒师'})")).find((entry:any)=>entry.film.externalId==='1396');
    assert.ok(whole);extraFilmIds.push(whole.filmId);
    await openTvSeasons();
    await js("document.querySelector('.season-picker details summary').click()");
    await js("(()=>{const input=document.querySelector('[aria-label=手动补录季数]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'6');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await js("[...document.querySelectorAll('.season-picker button')].find(b=>b.textContent==='填写本季资料').click()");
    await waitFor("document.querySelector('#manual-title')?.value==='绝命毒师 · 第6季'");
    await js("[...document.querySelectorAll('.modal-footer button')].find(b=>b.textContent.includes('添加到收藏库')).click()");
    await waitFor("!document.querySelector('.modal')");
    const manualSeason=(await js("window.cinema.library.list({search:'绝命毒师'})")).find((entry:any)=>entry.film.metadataSource==='manual');
    assert.ok(manualSeason);extraFilmIds.push(manualSeason.filmId);
    checks.push('normal TMDB search expands six season rows, single/batch season import, collected markers, personal rating preservation, whole-series choice and manual missing-season form through real UI/IPC');
    for(const title of ['影墙排序10','影墙排序2','影墙排序']) {
      const entry=await js(`window.cinema.library.createManual({title:${JSON.stringify(title)},mediaType:'movie'})`);extraFilmIds.push(entry.film.id);
    }
    await route('/library',"!!document.querySelector('[aria-label=按系列筛选]')");
    await waitFor("[...document.querySelectorAll('[aria-label=按系列筛选] option')].some(o=>o.textContent==='影墙排序')");
    await js("(()=>{const input=document.querySelector('[aria-label=按系列筛选]');input.value=[...input.options].find(o=>o.textContent==='影墙排序').value;input.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await waitFor("document.querySelector('.result-count')?.textContent==='3 部'");
    assert.deepEqual(await js("[...document.querySelectorAll('.poster-title')].map(n=>n.textContent)"),['影墙排序','影墙排序2','影墙排序10']);
    await shot('19-series-wall');
    await js("document.querySelector('[aria-label=同系列聚合]').click()");
    await js("document.querySelector('[aria-label=同系列聚合]').click()");

    await js("[...document.querySelectorAll('.poster-title')].find(node=>node.textContent==='影墙排序2').closest('a').click()");
    await waitFor("!!document.querySelector('.film-title')");
    await js("document.querySelector('.film-tools summary').click();document.querySelector('[aria-label=编辑影视资料]').click()");
    await waitFor("!!document.querySelector('#film-series')");
    await js("(()=>{for(const [id,value] of [['film-series','影墙自定义组'],['film-series-order','2']]){const input=document.getElementById(id);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));}})()");
    await js("[...document.querySelectorAll('.modal-footer button')].find(button=>button.textContent.trim()==='保存').click()");
    await waitFor("!document.querySelector('.modal')");
    await route('/library',"!!document.querySelector('[aria-label=按系列筛选]')");
    await waitFor("[...document.querySelectorAll('[aria-label=按系列筛选] option')].some(option=>option.textContent==='影墙自定义组')");
    await js("(()=>{const input=document.querySelector('[aria-label=按系列筛选]');input.value=[...input.options].find(option=>option.textContent==='影墙自定义组').value;input.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await waitFor("document.querySelector('.result-count')?.textContent==='1 部'");
    assert.equal(await js("document.querySelector('.poster-title').textContent"),'影墙排序2');
    checks.push('manual series name and order saved through metadata edit dialog, persisted and exposed as a series category');
    await js("(()=>{const input=document.querySelector('[aria-label=按系列筛选]');input.value='tmdb:tv:1396';input.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await waitFor("document.querySelector('.result-count')?.textContent==='7 部'");
    const tvNames=await js("[...document.querySelectorAll('.poster-title')].map(n=>n.textContent)");
    assert.equal(tvNames[0],'绝命毒师');assert.ok(tvNames[1].includes('第1季'));assert.ok(tvNames[6].includes('第6季'));
    assert.equal((await js(`window.cinema.library.detail(${JSON.stringify(data.films[1].film.id)})`)).film.series.key,'tmdb:collection:234');
    checks.push('series filter and automatic wall grouping keep film 1/2/10 and TV whole/1..6 adjacent in ascending order');


  }
  // Mutations stay within this disposable profile's explicitly seeded or imported test entries.
  const testFilmIds = [...data.films.map((item) => item.film.id), data.missing.film.id, ...extraFilmIds];
  await js(`Promise.all(${JSON.stringify(testFilmIds)}.map(id => window.cinema.library.removeFilm(id)))`);
  await route('/', "!!document.querySelector('.hero-empty-title')");
  assert.equal(await js("document.querySelectorAll('.rail-item').length"), 0);
  await shot('10-home-empty');
  assert.deepEqual(errors, []);
  writeFileSync(join(output, 'report.json'), JSON.stringify({ platform:process.platform, headless:process.argv.includes('--headless'), sandboxDisabled:process.argv.includes('--no-sandbox'), artworkDir, quarkFixture, quarkSyncFixture, actualAccountVerified:false, checks, errors, geometry }, null, 2));
  console.log('[desktop-smoke] PASS', JSON.stringify({ output, checks }));
  app.quit();
}

seed().then((data) => {
  let primaryWindowHandled = false;
  app.on('browser-window-created', (_event, win) => {
    if (primaryWindowHandled) return;
    primaryWindowHandled = true;
    win.webContents.on('console-message', (event) => {
      if (event.level === 'error') errors.push(event.message);
    });
    win.webContents.once('did-finish-load', () => {
      void verify(win, data).catch((error) => { console.error('[desktop-smoke] FAILED', error, errors); app.exit(1); });
    });
  });
  if(quarkSyncFixture) {
    assert.equal(process.argv.includes('--quark-web-probe'),false,'controlled and live network probes must run in separate profiles');
    void app.whenReady().then(()=>{cloudFixture=installQuarkSyncFixture(profile);}).catch(error=>{console.error('[sync-fixture] setup failed',error);app.exit(1);});
  }
  // Load the real production entry after selecting the disposable userData.
  require(join(root, 'dist-electron', 'main.cjs'));
}).catch((error) => { console.error(error); app.exit(1); });
// Includes multi-size captures and functional checks across all seven pages.
setTimeout(() => { console.error('[desktop-smoke] timeout'); app.exit(1); }, 180_000).unref();
