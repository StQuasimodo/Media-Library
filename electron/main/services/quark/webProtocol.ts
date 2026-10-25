/** Independent read-only adapter; no OpenList code or dependency is bundled. */
export interface Item { id: string; name: string; directory: boolean; video: boolean }
export class CheckError extends Error {
  constructor(readonly kind: 'login' | 'blocked' | 'network' | 'protocol', message: string) { super(message); }
}
export function directoryUrl(id: string, page: number, size = 100): string {
  if (!id || id.length > 1024 || /[\u0000-\u001f\u007f]/.test(id)) throw new CheckError('protocol', '文件夹标识无效。');
  const url = new URL('https://drive-pc.quark.cn/1/clouddrive/file/sort');
  for (const [key, value] of Object.entries({ pr: 'ucpro', fr: 'pc', pdir_fid: id, _page: String(page), _size: String(size), _fetch_total: '1', _sort: 'file_type:asc,updated_at:desc' })) url.searchParams.set(key, value);
  return url.href;
}
export function parsePage(httpStatus: number, body: unknown): { items: Item[]; total: number } {
  const data = body as Record<string, any> | null;
  if (httpStatus === 401 || data?.code === 31001) throw new CheckError('login', '目录接口要求登录。请在官方网页完成登录后，再检查连接。');
  if (httpStatus === 403 || httpStatus === 429) throw new CheckError('blocked', '访问受限或请求过于频繁，请回到官方网页检查提示，稍后重试。');
  if (httpStatus !== 200) throw new CheckError('network', `目录请求未成功（HTTP ${httpStatus}）。`);
  if (!data || data.status !== 200 || data.code !== 0 || !Array.isArray(data.data?.list) || !Number.isSafeInteger(data.metadata?._total) || data.metadata._total < 0) {
    throw new CheckError('protocol', '目录响应与预期不一致，尚不能确认读取成功。');
  }
  const items = data.data.list.map((item: any): Item => {
    if (!item || typeof item.fid !== 'string' || !item.fid || typeof item.file_name !== 'string' || typeof item.file !== 'boolean') throw new CheckError('protocol', '目录条目格式不完整。');
    return { id: item.fid, name: item.file_name, directory: !item.file, video: item.file && item.category === 1 };
  });
  return { items, total: data.metadata._total };
}
export async function readDirectory(id: string, read: (url: string) => Promise<{ status: number; body: unknown }>): Promise<Item[]> {
  const items: Item[] = [];
  const seen = new Set<string>();
  let total: number | null = null;
  for (let page = 1; page <= 100; page++) {
    const response = await read(directoryUrl(id, page));
    const parsed = parsePage(response.status, response.body);
    if (parsed.total > 10_000) throw new CheckError('protocol', '验证工具每个目录最多读取10000项，请选择更小的测试目录。');
    if (total !== null && total !== parsed.total) throw new CheckError('protocol', '读取期间目录数量变化，请待目录稳定后重试。');
    total = parsed.total;
    for (const item of parsed.items) {
      if (seen.has(item.id)) throw new CheckError('protocol', '分页出现重复文件，本次不作为完整清单。');
      seen.add(item.id); items.push(item);
    }
    if (items.length === total) return items;
    if (!parsed.items.length || items.length > total) throw new CheckError('protocol', '分页结果不完整或不一致，请重试。');
  }
  throw new CheckError('protocol', '超过验证工具的分页上限，本次不作为完整清单。');
}
export function trustedLoginUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.port && (url.hostname === 'quark.cn' || url.hostname.endsWith('.quark.cn')); }
  catch { return false; }
}
