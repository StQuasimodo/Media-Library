import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QuarkProvider, type CommandRunner } from '../electron/main/services/quark/provider';
import { QuarkLibrary } from '../electron/main/services/quark/library';
import { inferVideoName } from '../electron/main/services/quark/filename';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cinema-quark-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

type Row = Record<string, unknown>;
function output(cwd: string, entries: Row[], options: { missingArtifact?: boolean; hasMore?: boolean; outside?: boolean } = {}) {
  const folder = options.outside ? dir : join(cwd, 'browse');
  mkdirSync(folder, { recursive: true });
  const path = join(folder, 'files.jsonl');
  writeFileSync(path, entries.map((entry) => JSON.stringify(entry)).join('\n'));
  const rows: Row[] = [{ type: 'result', action: 'browse', code: 0, data: { file_list: entries.slice(0, 5), total: 999, hasMore: options.hasMore ?? false }, notice: { text: '官方返回提示原文' } }];
  if (!options.missingArtifact) rows.push({ type: 'artifact', action: 'browse', code: 0, data: { file_path: path, format: 'jsonl', count: entries.length } });
  return { stdout: rows.map((entry) => JSON.stringify(entry)).join('\n'), exitCode: 0 };
}

describe('官方工具完整结果协议', () => {
  it('读取完整Artifact，不把5条预览或total当作全量', async () => {
    const entries = Array.from({ length: 8 }, (_, i) => ({ fid: `id-${i}`, parent_fid: 'source', filename: `${i}.mkv`, category: 1 }));
    const provider = new QuarkProvider(async (_tool, args, cwd) => {
      expect(args).toEqual(['browse', '--parent-fid', 'source', '--all']);
      return output(cwd, entries);
    });
    const result = await provider.browse('unused', 'source', dir);
    expect(result.items).toHaveLength(8);
    expect(result.notices).toEqual(['官方返回提示原文']);
  });
  it.each([{ missingArtifact: true }, { hasMore: true }, { outside: true }])('不完整或越界的结果不作为成功清单：%j', async (options) => {
    const cwd = join(dir, 'job'); mkdirSync(cwd);
    const provider = new QuarkProvider(async (_tool, _args, current) => output(current, [], options));
    await expect(provider.browse('unused', 'source', cwd)).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });
  it('拒绝非目标目录条目，不构造缺失链接，并保留完整FID', async () => {
    const provider = new QuarkProvider(async (_tool, _args, cwd) => output(cwd, [
      { fid: 'wrapper|same-id', parent_fid: 'source', filename: 'Film.mkv', file_type: '1', check_link: 'https://quark.cn.evil.invalid/file' },
      { fid: 'other|same-id', parent_fid: 'source', filename: 'duplicate.mkv', file_type: '1' },
    ]));
    const result = await provider.browse('unused', 'source', dir);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('wrapper|same-id');
    expect(result.items[0].checkUrl).toBeNull();
    const bad = new QuarkProvider(async (_t, _a, cwd) => output(cwd, [{ fid: 'a', filename: 'outside.mkv', parent_fid: 'other' }]));
    await expect(bad.browse('unused', 'source', dir)).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });
  it('授权失败时保留官方notice，但不将原始输出或令牌带入错误信息', async () => {
    const provider = new QuarkProvider(async () => ({ exitCode: 1, stdout: JSON.stringify({ type: 'result', action: 'browse', code: -1, msg: 'token=test-secret', notice: { text: '请重新授权' } }) }));
    await expect(provider.browse('unused', 'source', dir)).rejects.toMatchObject({ notices: ['请重新授权'], message: expect.not.stringContaining('test-secret') });
  });
  it('真实子进程按参数调用并解析NDJSON，不经过shell', async () => {
    const tool = join(dir, 'quark-drive.cjs');
    writeFileSync(tool, `
      const fs=require('node:fs'),p=require('node:path');
      if(process.argv[2]!=='browse'||!process.argv.includes('--all'))process.exit(2);
      fs.mkdirSync('browse',{recursive:true});const file=p.resolve('browse/files.jsonl');
      fs.writeFileSync(file,JSON.stringify({fid:'a',filename:'A.mkv',parent_fid:'source'}));
      console.log(JSON.stringify({type:'result',action:'browse',code:0,data:{hasMore:false}}));
      console.log(JSON.stringify({type:'artifact',action:'browse',code:0,data:{file_path:file,format:'jsonl'}}));
    `);
    expect((await new QuarkProvider().browse(tool, 'source', dir)).items[0].name).toBe('A.mkv');
  });
});

describe('只读文件夹扫描', () => {
  function setup(runner: CommandRunner) {
    const tool = join(dir, 'quark-drive.cjs'); writeFileSync(tool, '// test fixture');
    const service = new QuarkLibrary(join(dir, 'data'), new QuarkProvider(runner));
    service.setTool(tool);
    return service;
  }
  const folders: Row[] = [{ fid: 'source', filename: '电影', category: 0 }];
  const tree: Record<string, Row[]> = {
    '0': folders,
    source: [{ fid: 'sub', filename: 'A.Show.2022', category: 0 }, { fid: 'film', filename: '1917.2019.1080p.mkv', parent_fid: 'source' }, { fid: 'text', filename: '说明.txt' }],
    sub: [{ fid: 'ep', filename: 'S01E02.mkv' }, { fid: 'source', filename: 'cycle', category: 0 }],
  };
  it('仅读取选择目录，递归防循环、只识别视频，并持久化完整清单', async () => {
    const calls: string[] = [];
    const run: CommandRunner = async (_tool, args, cwd) => { const id = args[args.indexOf('--parent-fid') + 1]; calls.push(id); return output(cwd, tree[id]); };
    const service = setup(run);
    await service.browse('0');
    service.selectFolder('source', true, false);
    const status = await service.scan();
    expect(calls).toEqual(['0', 'source', 'sub']);
    expect(status.busy).toBe(false);
    expect(status.inventory?.videos).toHaveLength(2);
    expect(status.inventory?.videos[0].hint).toMatchObject({ title: '1917', year: 2019 });
    expect(status.inventory?.videos[1].hint).toMatchObject({ title: 'A Show', year: 2022, season: 1, episode: 2 });
    expect(new QuarkLibrary(join(dir, 'data')).status().inventory?.videos).toHaveLength(2);
  });
  it('不递归时不读取子目录，不能选择未经浏览的任意目录', async () => {
    const calls: string[] = [];
    const service = setup(async (_t, args, cwd) => { const id = args[args.indexOf('--parent-fid') + 1]; calls.push(id); return output(cwd, tree[id]); });
    expect(() => service.selectFolder('not-selected', true, true)).toThrow();
    await service.browse('0'); service.selectFolder('source', false, false);
    expect((await service.scan()).inventory?.videos).toHaveLength(1);
    expect(calls).toEqual(['0', 'source']);
  });
  it('失败不保存半份结果，也不丢失上次成功清单', async () => {
    let fail = false;
    const service = setup(async (_t, args, cwd) => {
      const id = args[args.indexOf('--parent-fid') + 1];
      if (fail && id === 'sub') throw new Error('transport failed');
      return output(cwd, tree[id]);
    });
    await service.browse('0'); service.selectFolder('source', true, false);
    await service.scan();
    const file = join(dir, 'data', 'quark-inventory.json'); const previous = readFileSync(file, 'utf8');
    fail = true;
    await expect(service.scan()).rejects.toThrow();
    expect(readFileSync(file, 'utf8')).toBe(previous);
    expect(service.status().inventory?.videos).toHaveLength(2);
    expect(service.status().busy).toBe(false);
    expect(service.status().error).toBeTruthy();
  });
  it('改变读取范围后不把旧范围缓存当作当前结果', async () => {
    const service = setup(async (_t, args, cwd) => output(cwd, tree[args[args.indexOf('--parent-fid') + 1]]));
    await service.browse('0'); service.selectFolder('source', true, false);
    await service.scan();
    service.selectFolder('source', false, false);
    expect(service.status().inventory).toBeNull();
    expect(new QuarkLibrary(join(dir, 'data')).status().inventory).toBeNull();
  });
  it('取消读取会释放任务，且不会保存半份清单', async () => {
    let begin!: () => void;
    const started = new Promise<void>((resolve) => { begin = resolve; });
    const service = setup(async (_t, args, cwd, signal) => {
      if (args[args.indexOf('--parent-fid') + 1] === '0') return output(cwd, folders);
      return new Promise((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
        begin();
      });
    });
    await service.browse('0'); service.selectFolder('source', true, false);
    const read = service.scan();
    const rejected = expect(read).rejects.toThrow();
    await started; service.cancel(); await rejected;
    expect(service.status().busy).toBe(false);
    expect(existsSync(join(dir, 'data', 'quark-inventory.json'))).toBe(false);
  });
  it('也保留官方分类为视频但没有扩展名的文件', async () => {
    const service = setup(async (_t, args, cwd) => output(cwd,
      args[args.indexOf('--parent-fid') + 1] === '0' ? folders : [{fid:'video',filename:'未命名视频',category:1}]));
    await service.browse('0'); service.selectFolder('source', false, false);
    expect((await service.scan()).inventory?.videos[0].name).toBe('未命名视频');
  });
  it('只对明确开启自动读取的已选目录执行启动读取', async () => {
    const calls: string[] = [];
    const provider = new QuarkProvider(async (_t, args, cwd) => { const id = args[args.indexOf('--parent-fid') + 1]; calls.push(id); return output(cwd, tree[id]); });
    const service = setup(async (_t, args, cwd) => output(cwd, tree[args[args.indexOf('--parent-fid') + 1]]));
    await service.browse('0'); service.selectFolder('source', false, false);
    await new QuarkLibrary(join(dir, 'data'), provider).readOnStartup();
    expect(calls).toEqual([]);
    service.selectFolder('source', false, true);
    await new QuarkLibrary(join(dir, 'data'), provider).readOnStartup();
    expect(calls).toEqual(['source']);
  });
});

it.each([
  ['The.Matrix.1999.1080p.BluRay.x264.mkv', [], { title: 'The Matrix', year: 1999, season: null, episode: null }],
  ['2001.A.Space.Odyssey.1968.2160p.mkv', [], { title: '2001 A Space Odyssey', year: 1968 }],
  ['S01E02.mkv', ['电视剧', 'Dark.2017', 'Season 1'], { title: 'Dark', year: 2017, season: 1, episode: 2 }],
  ['EP03.mp4', ['电视剧', 'Dark.2017', 'Season 2'], { title: 'Dark', year: 2017, season: 2, episode: 3 }],
])('保守识别文件名：%s', (filename, parents, expected) => {
  expect(inferVideoName(filename as string, parents as string[])).toMatchObject(expected);
});

it.each([
  ['庆余年.第二季.第03集.2160p.mkv', [], { title: '庆余年', season: 2, episode: 3 }],
  ['第十二集.mp4', ['庆余年', '第二季'], { title: '庆余年', season: 2, episode: 12 }],
])('识别中文季集：%s', (filename, parents, expected) => {
  expect(inferVideoName(filename as string, parents as string[])).toMatchObject(expected);
});
