import { execFile } from 'node:child_process';
import { isAbsolute, relative } from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { AppError } from '../../errors';

export interface RemoteItem {
  id: string; name: string; directory: boolean; video: boolean; size: number | null; checkUrl: string | null;
}
export interface CommandResult { stdout: string; exitCode: number }
export type CommandRunner = (tool: string, args: string[], cwd: string, signal?: AbortSignal) => Promise<CommandResult>;

const runCommand: CommandRunner = (tool, args, cwd, signal) => new Promise((resolve, reject) => {
  execFile(process.execPath, [tool, ...args], {
    cwd, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    timeout: 60_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, signal,
  }, (error, stdout) => {
    if (signal?.aborted) return reject(new AppError('VALIDATION', '已取消读取。'));
    // Structured CLI errors may be returned with a nonzero process exit code.
    if (error && !stdout) return reject(new AppError('NETWORK', '夸克工具执行失败或超时，请检查工具安装和授权。'));
    resolve({ stdout, exitCode: error ? 1 : 0 });
  });
});

export const validFolderId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 1024 &&
  !value.startsWith('-') && !/[\u0000-\u001f\u007f]/.test(value);
export const fileIdentity = (id: string): string => id.split('|').at(-1) || id;
const object = (v: unknown): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v);

export class QuarkProvider {
  constructor(private readonly run: CommandRunner = runCommand) {}

  async browse(tool: string, folderId: string, cwd: string, signal?: AbortSignal): Promise<{ items: RemoteItem[]; notices: string[] }> {
    if (!validFolderId(folderId)) throw new AppError('VALIDATION', '所选文件夹无效。');
    const output = await this.run(tool, ['browse', '--parent-fid', folderId, '--all'], cwd, signal);
    let rows: Record<string, any>[];
    try {
      rows = output.stdout.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
      if (!rows.every(object)) throw new Error();
    } catch { throw new AppError('BAD_RESPONSE', '夸克工具返回了无法识别的结果。'); }
    const results = rows.filter((row) => row.type === 'result' && row.action === 'browse');
    const result = results.at(-1);
    const notices = result && typeof result.notice?.text === 'string' && result.notice.text ? [result.notice.text] : [];
    try {
      if (output.exitCode !== 0 || results.length !== 1 || result?.code !== 0) {
        // Never relay raw stdout/stderr or credentials into IPC error logs.
        const error = new AppError('NETWORK', '夸克未完成读取，请先使用官方工具完成授权，再重试。');
        Object.assign(error, { notices });
        throw error;
      }
      const artifacts = rows.filter((row) => row.type === 'artifact' && row.action === 'browse' && row.code === 0);
      const artifact = artifacts[0];
      if (result.data?.hasMore === true || artifacts.length !== 1 || artifact.data?.format !== 'jsonl' ||
        typeof artifact.data?.file_path !== 'string' || !isAbsolute(artifact.data.file_path)) {
        throw new AppError('BAD_RESPONSE', '未取得完整目录清单，本次读取未保存。');
      }
      const base = await realpath(cwd);
      const file = await realpath(artifact.data.file_path);
      const inside = relative(base, file);
      if (inside.startsWith('..') || isAbsolute(inside) || !inside.startsWith(`browse${process.platform === 'win32' ? '\\' : '/'}`)) {
        throw new AppError('BAD_RESPONSE', '夸克清单位置无效，本次读取未保存。');
      }
      const info = await stat(file);
      if (!info.isFile() || info.size > 32 * 1024 * 1024) throw new AppError('BAD_RESPONSE', '目录清单过大或不可读，请选择更小的目录。');
      let entries: unknown[];
      try { entries = (await readFile(file, 'utf8')).split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line)); }
      catch { throw new AppError('BAD_RESPONSE', '完整目录清单已损坏，本次读取未保存。'); }
      const items: RemoteItem[] = [];
      const seen = new Set<string>();
      for (const entry of entries) {
        if (!object(entry) || !validFolderId(entry.fid) || typeof entry.filename !== 'string' || !entry.filename || entry.filename.length > 1024 ||
          (typeof entry.parent_fid === 'string' && fileIdentity(entry.parent_fid) !== fileIdentity(folderId))) {
          throw new AppError('BAD_RESPONSE', '目录清单包含无效条目，本次读取未保存。');
        }
        // Official FIDs may be wrapped; identity is the final nonempty suffix.
        const identity = fileIdentity(entry.fid);
        if (seen.has(identity)) continue;
        seen.add(identity);
        let checkUrl: string | null = null;
        if (typeof entry.check_link === 'string') {
          try {
            const url = new URL(entry.check_link);
            if (url.protocol === 'https:' && !url.username && !url.password && (url.hostname === 'quark.cn' || url.hostname.endsWith('.quark.cn'))) checkUrl = url.href;
          } catch { /* Missing/invalid links do not require inventing a share URL. */ }
        }
        items.push({ id: entry.fid, name: entry.filename,
          directory: entry.file_type === '0' || entry.category === 0,
          video: entry.category === 1,
          size: typeof entry.size === 'number' && Number.isSafeInteger(entry.size) && entry.size >= 0 ? entry.size : null,
          checkUrl,
        });
      }
      return { items, notices };
    } catch (error) {
      if (error instanceof Error) Object.assign(error, { notices });
      throw error;
    }
  }
}
