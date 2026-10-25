/** Real Electron/preload/SQLite smoke test against an isolated disposable profile. */
import { app, BrowserWindow } from 'electron';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { openLibraryDatabase } from '../electron/main/data/database';
import { LibraryRepository } from '../electron/main/data/repository';
import { LibraryService } from '../electron/main/services/library';
import { ImageCache } from '../electron/main/services/imageCache';
import { QuarkLibrary } from '../electron/main/services/quark/library';

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
  assert.equal(await js('typeof window.cinema.library.home'), 'function');
  assert.equal((await js('window.cinema.app.info()')).metadataCredentialState, 'missing');
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
  // All mutations below are limited to the three seeded test entries.
  const testFilmIds = [...data.films.map((item) => item.film.id), data.missing.film.id];
  await js(`Promise.all(${JSON.stringify(testFilmIds)}.map(id => window.cinema.library.removeFilm(id)))`);
  await route('/', "!!document.querySelector('.hero-empty-title')");
  assert.equal(await js("document.querySelectorAll('.rail-item').length"), 0);
  await shot('10-home-empty');
  assert.deepEqual(errors, []);
  writeFileSync(join(output, 'report.json'), JSON.stringify({ platform:process.platform, headless:process.argv.includes('--headless'), sandboxDisabled:process.argv.includes('--no-sandbox'), artworkDir, quarkFixture, checks, errors, geometry }, null, 2));
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
  // Load the real production entry after selecting the disposable userData.
  require(join(root, 'dist-electron', 'main.cjs'));
}).catch((error) => { console.error(error); app.exit(1); });
// Includes multi-size captures and functional checks across all seven pages.
setTimeout(() => { console.error('[desktop-smoke] timeout'); app.exit(1); }, 120_000).unref();
