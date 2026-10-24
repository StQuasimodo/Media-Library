#!/usr/bin/env node
/**
 * End-to-end verification against the real Electron window.
 *
 * Launches the built app with a throwaway profile, seeds a few films through the
 * real IPC/database path (the poster files are served by a local HTTP server so
 * the image-cache pipeline is exercised too), then drives the UI over the
 * DevTools protocol and captures screenshots at the design baseline widths.
 *
 * Usage: node scripts/e2e.mjs [--keep]
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronBinary = require('electron');
const root = process.cwd();
const profileDir = join(root, '.e2e-profile');
const shotsDir = join(root, 'artifacts', 'screenshots');
const assetsDir = join(root, '.e2e-assets');
const PORT = 8977;
const CDP_PORT = 9333;
const keep = process.argv.includes('--keep');

const log = (...args) => console.log('[e2e]', ...args);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ */
/* Static asset server (posters/backdrops for the image cache)         */
/* ------------------------------------------------------------------ */

function startAssetServer() {
  const server = createServer((req, res) => {
    const file = join(assetsDir, (req.url ?? '/').replace(/^\//, '').split('?')[0]);
    if (!file.startsWith(assetsDir) || !existsSync(file)) {
      res.writeHead(404).end('not found');
      return;
    }
    const body = readFileSync(file);
    const type = extname(file) === '.png' ? 'image/png' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'content-length': body.length }).end(body);
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

/* ------------------------------------------------------------------ */
/* Minimal CDP client                                                  */
/* ------------------------------------------------------------------ */

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      } else if (message.method) {
        this.events.push(message);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30_000);
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        `evaluate failed: ${result.exceptionDetails.text} ${
          result.exceptionDetails.exception?.description ?? ''
        }`,
      );
    }
    return result.result?.value;
  }
}

async function waitForTarget(timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // not up yet
    }
    await sleep(400);
  }
  throw new Error('Electron DevTools endpoint did not appear');
}

/* ------------------------------------------------------------------ */
/* Seeding through the real IPC surface                                */
/* ------------------------------------------------------------------ */

const FILMS = [
  {
    externalId: '1001',
    title: '花样年华',
    originalTitle: 'In the Mood for Love',
    year: 2000,
    runtime: 98,
    genres: ['剧情', '爱情'],
    overview:
      '1960 年代的香港，周慕云与苏丽珍成为邻居，在发现各自的伴侣有染之后，两人之间生出一种始终未曾越界的情感。',
    tagline: '那些消逝了的岁月，仿佛隔着一块积着灰尘的玻璃。',
    mediaType: 'movie',
    rating: 9.5,
    status: 'watched',
    reason: '旗袍、走廊和雨夜，是我对「克制」最早的理解。',
    review: '每一次重看都更安静一点。',
  },
  {
    externalId: '1002',
    title: '银翼杀手',
    originalTitle: 'Blade Runner',
    year: 1982,
    runtime: 117,
    genres: ['科幻', '悬疑'],
    overview:
      '2019 年的洛杉矶，一名退休的银翼杀手被召回追捕四名复制人，在与他们的接触中开始怀疑自己存在的意义。',
    tagline: 'More human than human.',
    mediaType: 'movie',
    rating: 9,
    status: 'watched',
    reason: '雨、霓虹和缓慢的镜头，是我心里科幻的定义。',
    review: '终剪辑版最好。',
  },
  {
    externalId: '1003',
    title: '海边的曼彻斯特',
    originalTitle: 'Manchester by the Sea',
    year: 2016,
    runtime: 137,
    genres: ['剧情'],
    overview: '一个男人回到故乡处理兄长的后事，被迫面对自己一直逃避的过去。',
    tagline: null,
    mediaType: 'movie',
    rating: 8.5,
    status: 'watched',
    reason: '关于无法被治愈的悲伤，它没有给任何廉价的安慰。',
    review: null,
  },
  {
    externalId: '1004',
    title: '燃烧',
    originalTitle: 'Burning',
    year: 2018,
    runtime: 148,
    genres: ['剧情', '悬疑'],
    overview: '一个送外卖的年轻人和一个女孩重逢，女孩从非洲带回一个神秘男人，三个人的关系逐渐失控。',
    tagline: null,
    mediaType: 'movie',
    rating: 8,
    status: 'watching',
    reason: '那种悬而未决的愤怒，直到最后一刻才落地。',
    review: null,
  },
  {
    externalId: '1005',
    title: '地久天长',
    originalTitle: 'So Long, My Son',
    year: 2019,
    runtime: 175,
    genres: ['剧情', '家庭'],
    overview: '两个家庭在三十年的时代变迁中，被一次意外彻底改变。',
    tagline: null,
    mediaType: 'movie',
    rating: null,
    status: 'want',
    reason: '一直没有准备好一口气看完这三个小时。',
    review: null,
  },
  {
    externalId: '1006',
    title: '完美的日子',
    originalTitle: 'Perfect Days',
    year: 2023,
    runtime: 124,
    genres: ['剧情'],
    overview: '东京的公厕清洁工平山，过着规律而安静的生活，在树影和磁带之间找到自己的秩序。',
    tagline: null,
    mediaType: 'movie',
    rating: null,
    status: 'want',
    reason: '想在有阳光的下午看。',
    review: null,
  },
];

async function seed(cdp) {
  const payload = JSON.stringify(FILMS);
  const script = `
    (async () => {
      const films = ${payload};
      const api = window.cinema;
      const imported = [];
      for (let i = 0; i < films.length; i += 1) {
        const f = films[i];
        const result = await api.library.importCandidate(
          {
            source: 'tmdb',
            externalId: f.externalId,
            mediaType: f.mediaType,
            title: f.title,
            originalTitle: f.originalTitle,
            year: f.year,
            overview: f.overview,
            posterUrl: 'http://127.0.0.1:${PORT}/poster-' + (i + 1) + '.png',
            backdropUrl: 'http://127.0.0.1:${PORT}/backdrop-' + (i + 1) + '.png',
            tagline: f.tagline,
            runtime: f.runtime,
            genres: f.genres,
            originalLanguage: 'cn',
            popularity: 1,
          },
          {
            personalRating: f.rating,
            watchStatus: f.status,
            favoriteReason: f.reason,
            personalReview: f.review,
          },
        );
        imported.push({ id: result.film.id, entryId: result.entry.id, title: f.title });
      }

      const byTitle = Object.fromEntries(imported.map((f) => [f.title, f]));

      const collectionA = await api.collections.create({
        name: '夜色与霓虹',
        description: '城市的另一面：雨、霓虹、以及不肯睡去的人。',
      });
      const collectionB = await api.collections.create({
        name: '安静的房间',
        description: '留给那些几乎没有情节、却让人久久坐着的电影。',
      });
      await api.collections.addFilm(collectionA.id, byTitle['银翼杀手'].entryId);
      await api.collections.addFilm(collectionA.id, byTitle['燃烧'].entryId);
      await api.collections.addFilm(collectionA.id, byTitle['花样年华'].entryId);
      await api.collections.addFilm(collectionB.id, byTitle['完美的日子'].entryId);
      await api.collections.addFilm(collectionB.id, byTitle['海边的曼彻斯特'].entryId);

      await api.resources.create({
        filmId: byTitle['花样年华'].id,
        resourceName: '花样年华 Criterion 4K 修复版',
        shareUrl: 'https://pan.quark.cn/s/e2e-demo-mood',
        accessCode: 'm0od',
        qualityLabel: '4K',
        versionLabel: 'Criterion 修复',
        subtitleLabel: '内封中字',
        audioLabel: '原声',
        notes: '仅供个人备份使用。',
      });
      await api.resources.create({
        filmId: byTitle['花样年华'].id,
        resourceName: '花样年华 1080p 国粤双语',
        shareUrl: 'https://pan.quark.cn/s/e2e-demo-mood-2',
        qualityLabel: '1080p',
        subtitleLabel: '外挂中字',
        audioLabel: '国粤双语',
        availabilityStatus: 'unavailable',
      });

      return {
        imported: imported.length,
        collections: [collectionA.id, collectionB.id],
        firstFilmId: byTitle['花样年华'].id,
      };
    })()
  `;
  return cdp.evaluate(script);
}

/* ------------------------------------------------------------------ */
/* Screenshots                                                         */
/* ------------------------------------------------------------------ */

async function setViewport(cdp, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(350);
}

async function navigate(cdp, hash, waitSelector = '.app-shell') {
  await cdp.evaluate(`window.location.hash = ${JSON.stringify(hash)}; true`);
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    const ready = await cdp.evaluate(
      `Boolean(document.querySelector(${JSON.stringify(waitSelector)}))`,
    );
    if (ready) break;
    await sleep(150);
  }
  await sleep(450);
}

async function shot(cdp, name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = join(shotsDir, `${name}.png`);
  writeFileSync(file, Buffer.from(data, 'base64'));
  log(`screenshot ${name} -> ${file}`);
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  if (existsSync(profileDir)) rmSync(profileDir, { recursive: true, force: true });
  mkdirSync(profileDir, { recursive: true });
  mkdirSync(shotsDir, { recursive: true });

  const server = await startAssetServer();
  log(`asset server on http://127.0.0.1:${PORT}`);

  const env = { ...process.env };
  // The harness sets this globally; leaving it on would run Electron as plain Node.
  delete env.ELECTRON_RUN_AS_NODE;

  const app = spawn(
    electronBinary,
    ['.', `--user-data-dir=${profileDir}`, `--remote-debugging-port=${CDP_PORT}`],
    { cwd: root, stdio: 'inherit', env },
  );
  app.on('exit', (code) => log(`electron exited with ${code}`));

  let failure = null;
  try {
    const target = await waitForTarget();
    log(`attached to ${target.url}`);

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    const cdp = new Cdp(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    // Wait for the renderer to mount the shell.
    const started = Date.now();
    while (Date.now() - started < 20_000) {
      const state = await cdp.evaluate(
        `({ hasApi: Boolean(window.cinema), root: document.querySelector('#root')?.children.length ?? 0, text: document.body.innerText.slice(0, 200) })`,
      );
      if (state.root > 0) break;
      await sleep(300);
    }

    const emptyState = await cdp.evaluate(
      `({ title: document.querySelector('.hero-empty-title')?.textContent ?? null, body: document.body.innerText.slice(0, 400) })`,
    );
    log('initial screen:', JSON.stringify(emptyState).slice(0, 300));
    await setViewport(cdp, 1440, 900);
    await shot(cdp, '01-home-empty');

    const seeded = await seed(cdp);
    log('seeded:', JSON.stringify(seeded));

    await cdp.evaluate('location.reload(); true');
    await sleep(2500);

    await setViewport(cdp, 1440, 900);
    await navigate(cdp, '#/');
    await shot(cdp, '02-home');

    await navigate(cdp, '#/library');
    await shot(cdp, '03-library');

    await navigate(cdp, `#/film/${seeded.firstFilmId}`, '.detail-hero');
    await shot(cdp, '04-film-detail');

    await navigate(cdp, '#/collections');
    await shot(cdp, '05-collections');

    await navigate(cdp, '#/collections/' + seeded.collections[0], '.poster-grid');
    await shot(cdp, '06-collection-detail');

    await navigate(cdp, '#/watchlist');
    await shot(cdp, '07-watchlist');

    await navigate(cdp, '#/settings');
    await shot(cdp, '08-settings');

    // Narrower window: confirm the grid reflows instead of overflowing.
    await setViewport(cdp, 1280, 800);
    await navigate(cdp, '#/library');
    await shot(cdp, '09-library-1280');

    await setViewport(cdp, 1920, 1080);
    await navigate(cdp, '#/library');
    await shot(cdp, '10-library-1920');

    // Command palette + empty vs. filled checks.
    await setViewport(cdp, 1440, 900);
    await navigate(cdp, '#/');
    await cdp.evaluate(
      `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })); true`,
    );
    await sleep(600);
    await shot(cdp, '11-command-palette');

    const report = await cdp.evaluate(`
      (async () => {
        const stats = await window.cinema.library.stats();
        const home = await window.cinema.library.home();
        const detail = await window.cinema.library.detail(${JSON.stringify(seeded.firstFilmId)});
        return {
          stats,
          recentCount: home.recent.length,
          featured: home.featured?.film?.title ?? null,
          collectionCount: home.collections.length,
          detailPoster: detail.film.posterPath,
          detailBackdrop: detail.film.backdropPath,
          resourceCount: detail.resources.length,
          rating: detail.entry.personalRating,
          review: detail.entry.personalReview,
          imagesOk: Array.from(document.images).filter((img) => img.src.startsWith('mycinema://')).every((img) => img.complete && img.naturalWidth > 0),
          overflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
        };
      })()
    `);
    log('report:', JSON.stringify(report, null, 2));
    writeFileSync(join(shotsDir, 'report.json'), JSON.stringify(report, null, 2));
  } catch (error) {
    failure = error;
    console.error('[e2e] FAILED:', error);
  } finally {
    try {
      app.kill();
    } catch {
      // ignore
    }
    server.close();
    if (!keep) {
      await sleep(800);
      if (existsSync(profileDir)) {
        try {
          rmSync(profileDir, { recursive: true, force: true });
        } catch {
          log('profile dir left in place (locked by a lingering process)');
        }
      }
    }
  }

  if (failure) process.exit(1);
  log('done');
  process.exit(0);
}

await main();
