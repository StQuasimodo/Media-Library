#!/usr/bin/env node
/**
 * Headless UI harness.
 *
 * The Electron window cannot be created in this environment (Chromium crashes at
 * BrowserWindow creation), so visual verification runs the *real* renderer
 * bundle against the *real* data/service layer, bridged by a tiny HTTP shim that
 * mimics the preload API. Only the transport differs from the shipped app.
 *
 * Usage: node scripts/ui-harness.mjs [--width 1440] [--routes home,library]
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { openLibraryDatabase } from '../electron/main/data/database.js';
import { LibraryRepository } from '../electron/main/data/repository.js';
import { LibraryService } from '../electron/main/services/library.js';
import { ImageCache } from '../electron/main/services/imageCache.js';
import { Logger } from '../electron/main/services/logger.js';

const root = process.cwd();
const distDir = join(root, 'dist');
const assetsDir = join(root, '.e2e-assets');
const shotsDir = join(root, 'artifacts', 'screenshots');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 8788;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...args) => console.log('[ui]', ...args);

/* ------------------------------------------------------------------ */
/* Real service layer on a throwaway database                          */
/* ------------------------------------------------------------------ */

const profileDir = mkdtempSync(join(tmpdir(), 'my-cinema-ui-'));
const dbFile = join(profileDir, 'library.db');
const logger = new Logger(join(profileDir, 'logs', 'app.log'));
const images = new ImageCache({ root: join(profileDir, 'images') });
const { db } = openLibraryDatabase(dbFile);
const repo = new LibraryRepository(db);
const library = new LibraryService({ repo, images, onSecret: (s) => logger.registerSecret(s) });

const FILMS = [
  {
    // Imported first so it is the *oldest* entry: the rail (newest first) then
    // shows it last, and the default hero still has real artwork. It verifies
    // the no-image fallback path.
    externalId: '1000',
    title: '没有剧照的电影',
    originalTitle: 'A Film Without Stills',
    year: 1999,
    runtime: 92,
    genres: ['剧情'],
    overview: '这部作品没有任何海报或背景图，用来验证界面在缺失图片时是否依然完整。',
    tagline: null,
    rating: 7,
    status: 'want',
    reason: '先看看没有图的时候长什么样。',
    review: null,
    noImages: true,
  },
  {
    externalId: '1001',
    title: '花样年华',
    originalTitle: 'In the Mood for Love',
    year: 2000,
    runtime: 98,
    genres: ['剧情', '爱情'],
    overview:
      '1960 年代的香港，周慕云与苏丽珍成为邻居。在发现各自的伴侣有染之后，两人之间生出一种始终未曾越界的情感。',
    tagline: '那些消逝了的岁月，仿佛隔着一块积着灰尘的玻璃。',
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
    overview:
      '一个送外卖的年轻人和一个女孩重逢，女孩从非洲带回一个神秘男人，三个人的关系逐渐失控。',
    tagline: null,
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
    rating: null,
    status: 'want',
    reason: '想在有阳光的下午看。',
    review: null,
  },

];

/* ------------------------------------------------------------------ */
/* HTTP server: static dist + rpc + cached images                      */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function apiInfo() {
  return {
    appVersion: '1.0.0',
    schemaVersion: 2,
    dataDirectory: profileDir,
    backupsDirectory: join(profileDir, 'backups'),
    imagesDirectory: join(profileDir, 'images'),
    hasMetadataApiKey: false,
    settings: repo.getSettings(),
    platform: 'win32',
  };
}

async function dispatch(channel, args) {
  switch (channel) {
    case 'app:info':
      return apiInfo();
    case 'library:home':
      return library.getHome();
    case 'library:stats':
      return library.getStats();
    case 'library:list':
      return library.listEntries(args[0] ?? {});
    case 'library:years':
      return library.listYears();
    case 'library:detail':
      return library.getFilmDetail(args[0]);
    case 'library:importCandidate':
      return library.importCandidate(args[0], args[1] ?? {});
    case 'library:updateEntry':
      return library.updateEntry(args[0], args[1]);
    case 'library:updateFilm':
      return library.updateFilm(args[0], args[1]);
    case 'library:removeFilm':
      return library.removeFilm(args[0]);
    case 'collections:list':
      return library.listCollections();
    case 'collections:detail':
      return library.getCollectionWithEntries(args[0]);
    case 'collections:create':
      return library.createCollection(args[0]);
    case 'collections:update':
      return library.updateCollection(args[0], args[1]);
    case 'collections:remove':
      return library.deleteCollection(args[0]);
    case 'collections:addFilm':
      return library.addFilmToCollection(args[0], args[1]);
    case 'collections:removeFilm':
      return library.removeFilmFromCollection(args[0], args[1]);
    case 'collections:reorder':
      return library.reorderCollections(args[0]);
    case 'resources:list':
      return library.listResources(args[0]);
    case 'resources:create':
      return library.createResource(args[0]);
    case 'resources:update':
      return library.updateResource(args[0], args[1]);
    case 'resources:remove':
      return library.deleteResource(args[0]);
    case 'settings:get':
      return {
        settings: repo.getSettings(),
        hasMetadataApiKey: false,
        dataDirectory: profileDir,
        appVersion: '1.0.0',
        schemaVersion: 2,
      };
    case 'settings:update':
      return {
        settings: library.updateSettings(args[0] ?? {}),
        hasMetadataApiKey: false,
        dataDirectory: profileDir,
        appVersion: '1.0.0',
        schemaVersion: 2,
      };
    default:
      throw Object.assign(new Error(`harness: unsupported channel ${channel}`), {
        code: 'INTERNAL',
      });
  }
}

const HARNESS_JS = `
window.__MYCINEMA_IMAGE_BASE__ = '/images/';
(() => {
  const unwrap = async (channel, args) => {
    const response = await fetch('/rpc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel, args }),
    });
    const payload = await response.json();
    if (!payload.ok) {
      const error = new Error(payload.error.message);
      error.name = payload.error.code;
      throw error;
    }
    return payload.data;
  };
  window.cinema = {
    quarkWeb: {
      status: async () => ({state:"not_checked",error:null,loginOpen:false}),
      connect: async () => { throw new Error("请在桌面应用中登录"); },
      check: async () => ({state:"unavailable",error:"请在桌面应用中检查",loginOpen:false}),
      list: async () => { throw new Error("请在桌面应用中浏览"); },
      disconnect: async () => ({state:"login_required",error:null,loginOpen:false}),
    },
    quark: {
      status: async () => ({toolPath:null,folder:null,recursive:true,autoRead:true,busy:false,error:null,notices:[],inventory:null}),
      chooseTool: async () => { throw new Error('请在桌面应用中选择夸克工具'); },
      browse: async () => { throw new Error('请在桌面应用中读取夸克目录'); },
      selectFolder: async () => { throw new Error('请在桌面应用中选择夸克目录'); },
      scan: async () => { throw new Error('请在桌面应用中读取夸克目录'); },
      cancel: async () => {},
    },
    app: {
      info: () => unwrap('app:info', []),
      openExternal: async () => {},
      openFolder: async () => {},
      relaunch: async () => {},
    },
    library: {
      home: () => unwrap('library:home', []),
      stats: () => unwrap('library:stats', []),
      list: (query) => unwrap('library:list', [query]),
      years: () => unwrap('library:years', []),
      detail: (filmId) => unwrap('library:detail', [filmId]),
      createManual: (input) => unwrap('library:createManual', [input]),
      updateFilm: (filmId, patch) => unwrap('library:updateFilm', [filmId, patch]),
      updateEntry: (entryId, patch) => unwrap('library:updateEntry', [entryId, patch]),
      removeFilm: (filmId) => unwrap('library:removeFilm', [filmId]),
      importCandidate: (candidate, entry) => unwrap('library:importCandidate', [candidate, entry]),
    },
    collections: {
      list: () => unwrap('collections:list', []),
      detail: (id) => unwrap('collections:detail', [id]),
      create: (input) => unwrap('collections:create', [input]),
      update: (id, patch) => unwrap('collections:update', [id, patch]),
      remove: (id) => unwrap('collections:remove', [id]),
      addFilm: (collectionId, entryId) => unwrap('collections:addFilm', [collectionId, entryId]),
      removeFilm: (collectionId, entryId) => unwrap('collections:removeFilm', [collectionId, entryId]),
      reorder: (ids) => unwrap('collections:reorder', [ids]),
    },
    resources: {
      list: (filmId) => unwrap('resources:list', [filmId]),
      create: (input) => unwrap('resources:create', [input]),
      update: (id, patch) => unwrap('resources:update', [id, patch]),
      remove: (id) => unwrap('resources:remove', [id]),
      open: async () => {},
      copy: async () => {},
    },
    metadata: {
      search: async () => { throw Object.assign(new Error('harness: 未配置 API Key'), { name: 'NO_API_KEY' }); },
      candidate: async () => { throw Object.assign(new Error('harness: 未配置 API Key'), { name: 'NO_API_KEY' }); },
      refresh: async () => { throw Object.assign(new Error('harness: 未配置 API Key'), { name: 'NO_API_KEY' }); },
      verifyKey: async () => {},
      saveKey: async () => {},
      clearKey: async () => {},
    },
    settings: {
      get: () => unwrap('settings:get', []),
      update: (patch) => unwrap('settings:update', [patch]),
    },
    data: {
      createBackup: async () => { throw new Error('harness'); },
      validateBackup: async () => ({ ok: false, schemaVersion: 0 }),
      chooseBackupFile: async () => null,
      restore: async () => { throw new Error('harness'); },
      exportJson: async () => null,
    },
  };

  // Test-only affordance: a \`?focus=N\` query (before or inside the hash)
  // drives the hero rail so a screenshot can capture the "different film
  // selected" state without a real pointer.
  const hash = location.hash || '';
  const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
  const params = new URLSearchParams(hashQuery || location.search);
  const focus = params.get('focus');
  if (params.get('metrics') === '1') {
    setTimeout(() => {
      const rect = (selector) => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const box = node.getBoundingClientRect();
        return {
          w: Math.round(box.width),
          h: Math.round(box.height),
          x: Math.round(box.x),
          y: Math.round(box.y),
        };
      };
      const layer = document.querySelector('.hero-layer');
      const style = layer ? getComputedStyle(layer) : null;
      document.body.dataset.metrics = JSON.stringify({
        stage: rect('.hero-stage'),
        railWrap: rect('.focus-rail-wrap'),
        rail: rect('.focus-rail'),
        item: rect('.rail-item'),
        art: rect('.rail-art'),
        copy: rect('.hero-copy'),
        layerBg: style ? style.backgroundImage.slice(0, 90) : null,
        layerOpacity: style ? style.opacity : null,
      });
    }, 1500);
  }
  if (focus !== null) {
    const index = Number.parseInt(focus, 10);
    const started = Date.now();
    const tick = () => {
      const items = document.querySelectorAll('.rail-item');
      const target = items[Number.isFinite(index) ? index : 0];
      if (target) {
        target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        target.focus();
        return;
      }
      if (Date.now() - started < 6000) setTimeout(tick, 150);
    };
    setTimeout(tick, 600);
  }
})();
`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  const path = decodeURIComponent(url.pathname);

  if (req.method === 'POST' && path === '/rpc') {
    try {
      const body = JSON.parse(await readBody(req));
      const data = await dispatch(body.channel, body.args ?? []);
      send(res, 200, JSON.stringify({ ok: true, data }));
    } catch (error) {
      send(
        res,
        200,
        JSON.stringify({
          ok: false,
          error: { code: error.code ?? 'INTERNAL', message: error.message ?? String(error) },
        }),
      );
    }
    return;
  }

  if (path === '/harness.js') return send(res, 200, HARNESS_JS, MIME['.js']);

  if (path.startsWith('/images/')) {
    const relative = path.replace('/images/', '');
    const file = images.read(relative);
    if (!file) {
      log(`IMAGE MISS ${relative}`);
      return send(res, 404, 'not found', 'text/plain');
    }
    return send(res, 200, file.data, file.mime);
  }

  if (path.startsWith('/seed/')) {
    const file = join(assetsDir, path.replace('/seed/', ''));
    if (!file.startsWith(assetsDir) || !existsSync(file)) return send(res, 404, 'nope', 'text/plain');
    return send(res, 200, readFileSync(file), 'image/png');
  }

  if (path === '/' || path === '/index.html') {
    const html = readFileSync(join(distDir, 'index.html'), 'utf8');
    const injected = html.replace('</head>', '<script src="/harness.js"></script></head>');
    return send(res, 200, injected, MIME['.html']);
  }

  const assetFile = join(distDir, path);
  if (assetFile.startsWith(distDir) && existsSync(assetFile) && statSync(assetFile).isFile()) {
    return send(res, 200, readFileSync(assetFile), MIME[extname(assetFile)] ?? 'application/octet-stream');
  }

  send(res, 404, 'not found', 'text/plain');
});

/* ------------------------------------------------------------------ */
/* Seed through the real service layer                                 */
/* ------------------------------------------------------------------ */

async function seed() {
  // Binds each fixture title to the artwork generated for it, so screenshots
  // never show one film's poster under another film's name.
  const ART: Record<string, number> = {
    花样年华: 1,
    银翼杀手: 2,
    海边的曼彻斯特: 3,
    燃烧: 4,
    地久天长: 5,
    完美的日子: 6,
  };
  const created = [];
  for (let index = 0; index < FILMS.length; index += 1) {
    const film = FILMS[index];
    const art = ART[film.title] ?? 1;
    const result = await library.importCandidate(
      {
        source: 'tmdb',
        externalId: film.externalId,
        mediaType: 'movie',
        title: film.title,
        originalTitle: film.originalTitle,
        year: film.year,
        overview: film.overview,
        posterUrl: film.noImages ? null : `http://127.0.0.1:${PORT}/seed/poster-${art}.png`,
        backdropUrl: film.noImages ? null : `http://127.0.0.1:${PORT}/seed/backdrop-${art}.png`,
        tagline: film.tagline,
        runtime: film.runtime,
        genres: film.genres,
        originalLanguage: 'cn',
        popularity: 1,
      },
      {
        personalRating: film.rating,
        watchStatus: film.status,
        favoriteReason: film.reason,
        personalReview: film.review,
      },
    );
    created.push({ title: film.title, id: result.film.id, entryId: result.entry.id });
  }

  const byTitle = Object.fromEntries(created.map((item) => [item.title, item]));
  const night = library.createCollection({
    name: '夜色与霓虹',
    description: '城市的另一面：雨、霓虹、以及不肯睡去的人。',
  });
  const quiet = library.createCollection({
    name: '安静的房间',
    description: '留给那些几乎没有情节、却让人久久坐着的电影。',
  });
  library.addFilmToCollection(night.id, byTitle['银翼杀手'].entryId);
  library.addFilmToCollection(night.id, byTitle['燃烧'].entryId);
  library.addFilmToCollection(night.id, byTitle['花样年华'].entryId);
  library.addFilmToCollection(quiet.id, byTitle['完美的日子'].entryId);
  library.addFilmToCollection(quiet.id, byTitle['海边的曼彻斯特'].entryId);

  const mood = byTitle['花样年华'].id;
  library.createResource({
    filmId: mood,
    resourceName: '花样年华 Criterion 4K 修复版',
    shareUrl: 'https://pan.quark.cn/s/demo-mood-4k',
    accessCode: 'm0od',
    qualityLabel: '4K',
    versionLabel: 'Criterion 修复',
    subtitleLabel: '内封中字',
    audioLabel: '原声',
    notes: '仅供个人备份使用。',
  });
  library.createResource({
    filmId: mood,
    resourceName: '花样年华 1080p 国粤双语',
    shareUrl: 'https://pan.quark.cn/s/demo-mood-1080',
    qualityLabel: '1080p',
    subtitleLabel: '外挂中字',
    audioLabel: '国粤双语',
    availabilityStatus: 'unavailable',
  });

  return {
    firstFilmId: mood,
    collectionId: night.id,
    noImageFilmId: byTitle['没有剧照的电影'].id,
    count: created.length,
  };
}

/* ------------------------------------------------------------------ */
/* Screenshots                                                         */
/* ------------------------------------------------------------------ */

function dumpDom(hash: string, width = 1440, height = 900): Promise<string> {
  const url = `http://127.0.0.1:${PORT}/${hash}`;
  return new Promise((resolve, reject) => {
    const child = spawn(
      EDGE,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        `--window-size=${width},${height}`,
        '--virtual-time-budget=7000',
        '--dump-dom',
        `--user-data-dir=${join(profileDir, 'edge-dump')}`,
        url,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    let html = '';
    child.stdout.on('data', (chunk) => {
      html += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('dump timeout'));
    }, 60_000);
    child.on('exit', () => {
      clearTimeout(timer);
      resolve(html);
    });
  });
}

function shoot({ name, hash, width, height }) {
  const out = join(shotsDir, `${name}.png`);
  const url = `http://127.0.0.1:${PORT}/${hash}`;
  return new Promise((resolve, reject) => {
    const child = spawn(
      EDGE,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        `--window-size=${width},${height}`,
        '--virtual-time-budget=7000',
        `--screenshot=${out}`,
        `--user-data-dir=${join(profileDir, 'edge')}`,
        url,
      ],
      { stdio: 'ignore' },
    );
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`screenshot timeout: ${name}`));
    }, 60_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (!existsSync(out)) {
        reject(new Error(`no screenshot for ${name} (edge exit ${code})`));
        return;
      }
      const bytes = statSync(out).size;
      log(`${name} (${width}x${height}) -> ${bytes} bytes`);
      resolve(bytes);
    });
  });
}

/* ------------------------------------------------------------------ */

async function main() {
  mkdirSync(shotsDir, { recursive: true });
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

  const emptyMode = process.argv.includes('--empty');
  const seeded = emptyMode
    ? { firstFilmId: '', collectionId: '', noImageFilmId: '', count: 0 }
    : await seed();
  log(emptyMode ? 'empty mode: no data seeded' : 'seeded', JSON.stringify(seeded));

  if (process.argv.includes('--debug-images')) {
    const detail = library.getFilmDetail(seeded.firstFilmId);
    const posterPath = detail.film.posterPath ?? '';
    const url = `http://127.0.0.1:${PORT}/images/${posterPath}`;
    const response = await fetch(url);
    const body = Buffer.from(await response.arrayBuffer());
    log(
      `debug image -> ${response.status} ${response.headers.get('content-type')} ${body.length}b`,
      url,
    );
    const html = await fetch(`http://127.0.0.1:${PORT}/`).then((r) => r.text());
    log(
      'debug index: harnessScript=',
      html.includes('/harness.js'),
      'csp=',
      html.includes('Content-Security-Policy'),
    );

    const dom = await dumpDom('#/library');
    const homeDom = await dumpDom('#/?metrics=1');
    const metrics = /data-metrics="([^"]+)"/.exec(homeDom)?.[1] ?? 'none';
    log('debug metrics:', metrics.replace(/&quot;/g, '"').slice(0, 600));
    const imgTags = dom.match(/<img[^>]*>/g) ?? [];
    log('debug imgs:', imgTags.length);
    for (const tag of imgTags.slice(0, 4)) log('  ', tag.slice(0, 220));
    const detailDom = await dumpDom(`#/film/${seeded.firstFilmId}`);
    const layers = detailDom.match(/<div class="hero-layer[^"]*"[^>]*>/g) ?? [];
    log('debug hero layers:', layers.length);
    for (const layer of layers.slice(0, 3)) log('debug hero', layer.slice(0, 240));
    log(
      'debug stage classes:',
      (detailDom.match(/<section class="film-stage[^"]*"/) ?? ['none'])[0],
    );
    const scripts = dom.match(/<script[^>]*>/g) ?? [];
    log('debug scripts:', scripts.join(' | ').slice(0, 400));
    if (process.argv.includes('--dump-only')) {
      server.close();
      db.close();
      process.exit(0);
    }
  }

  const report = {
    mode: emptyMode ? 'empty' : 'seeded',
    seeded,
    stats: library.getStats(),
    home: {
      featured: library.getHome().featured?.film.title ?? null,
      recent: library.getHome().recent.length,
      collections: library.getHome().collections.length,
    },
    detail: emptyMode
      ? null
      : (() => {
          const detail = library.getFilmDetail(seeded.firstFilmId);
          return {
            poster: detail.film.posterPath,
            backdrop: detail.film.backdropPath,
            rating: detail.entry.personalRating,
            resources: detail.resources.length,
          };
        })(),
  };
  log('report', JSON.stringify(report, null, 2));

  const shots = emptyMode
    ? [
        { name: '11-empty-home', hash: '#/', width: 1440, height: 900 },
        { name: '12-empty-library', hash: '#/library', width: 1440, height: 900 },
        { name: '13-empty-home-1280', hash: '#/', width: 1280, height: 800 },
      ]
    : [
        { name: '01-home', hash: '#/', width: 1440, height: 900 },
        { name: '01b-home-focus-3', hash: '#/?focus=3', width: 1440, height: 900 },
        { name: '02-library', hash: '#/library', width: 1440, height: 900 },
        { name: '03-film-detail', hash: `#/film/${seeded.firstFilmId}`, width: 1440, height: 900 },
        { name: '03b-detail-no-images', hash: `#/film/${seeded.noImageFilmId}`, width: 1440, height: 900 },
        { name: '04-collections', hash: '#/collections', width: 1440, height: 900 },
        { name: '05-collection-detail', hash: `#/collections/${seeded.collectionId}`, width: 1440, height: 900 },
        { name: '06-watchlist', hash: '#/watchlist', width: 1440, height: 900 },
        { name: '07-settings', hash: '#/settings', width: 1440, height: 900 },
        { name: '08-library-1280', hash: '#/library', width: 1280, height: 800 },
        { name: '08b-home-1280', hash: '#/', width: 1280, height: 800 },
        { name: '09-library-1920', hash: '#/library', width: 1920, height: 1080 },
        { name: '09b-home-1920', hash: '#/', width: 1920, height: 1080 },
      ];

  for (const shot of shots) {
    await shoot(shot);
  }

  writeFileSync(join(shotsDir, 'ui-report.json'), JSON.stringify(report, null, 2));
  server.close();
  db.close();
  if (!process.argv.includes('--keep')) {
    await sleep(300);
    rmSync(profileDir, { recursive: true, force: true });
  }
  log('done');
  process.exit(0);
}

main().catch((error) => {
  console.error('[ui] FAILED', error);
  process.exit(1);
});
