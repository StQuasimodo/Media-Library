import { describe, expect, it } from 'vitest';
import { CheckError, directoryUrl, parsePage, readDirectory, trustedLoginUrl } from '../tools/quark-web-check/protocol';

const item = (id: string, file = true) => ({ fid: id, file_name: `name-${id}`, file, category: 1 });
const page = (list: unknown[], total: number) => ({ status: 200, code: 0, data: { list }, metadata: { _total: total } });
describe('网页登录验证的只读目录协议', () => {
  it('明确识别真实匿名响应，不把HTTP成功或空账号信息当登录成功', () => {
    expect(() => parsePage(401, { status: 401, code: 31001, message: 'require login [guest]' })).toThrow(CheckError);
    try { parsePage(401, {}); } catch (error) { expect((error as CheckError).kind).toBe('login'); }
    expect(() => parsePage(200, { success: true, data: {}, code: 'OK' })).toThrow('响应与预期不一致');
  });
  it('访问限制和网络失败不直接解释为账号退出', () => {
    for (const status of [403, 429, 500]) {
      expect(() => parsePage(status, {})).toThrow(CheckError);
      try { parsePage(status, {}); }
      catch (error) { expect((error as CheckError).kind).toBe(status === 500 ? 'network' : 'blocked'); }
    }
  });
  it('只生成固定官方主机的目录GET地址，正确编码目录ID', () => {
    const url = new URL(directoryUrl('a&next=https://example.com', 2));
    expect(url.origin).toBe('https://drive-pc.quark.cn');
    expect(url.searchParams.get('pdir_fid')).toBe('a&next=https://example.com');
    expect(url.searchParams.get('_page')).toBe('2');
    expect(() => directoryUrl('a\n', 1)).toThrow();
  });
  it('区分目录、视频和其他文件，拒绝不完整条目', () => {
    expect(parsePage(200, page([item('d', false), item('v'), { ...item('t'), category: 2 }], 3)).items.map(v => [v.directory, v.video])).toEqual([[true, false], [false, true], [false, false]]);
    expect(() => parsePage(200, page([{ fid: 'x', file_name: 'x' }], 1))).toThrow('条目格式不完整');
  });
  it('读取全部分页，超过5项也不截为预览', async () => {
    const urls: string[] = [];
    const result = await readDirectory('0', async url => {
      urls.push(url); const n = Number(new URL(url).searchParams.get('_page'));
      return { status: 200, body: page(n === 1 ? Array.from({ length: 100 }, (_, i) => item(String(i))) : [item('last')], 101) };
    });
    expect(result).toHaveLength(101); expect(urls).toHaveLength(2);
  });
  it('空目录合法，但中途失败不能返回部分成功', async () => {
    await expect(readDirectory('0', async () => ({ status: 200, body: page([], 0) }))).resolves.toEqual([]);
    await expect(readDirectory('0', async url => Number(new URL(url).searchParams.get('_page')) === 1
      ? { status: 200, body: page([item('a')], 2) } : { status: 401, body: {} })).rejects.toMatchObject({ kind: 'login' });
  });
  it('拒绝重复页、空页缺项、总量变化以及超限目录', async () => {
    await expect(readDirectory('0', async () => ({ status: 200, body: page([item('a')], 2) }))).rejects.toThrow('重复文件');
    await expect(readDirectory('0', async () => ({ status: 200, body: page([], 1) }))).rejects.toThrow('不完整');
    await expect(readDirectory('0', async url => ({ status: 200, body: page([item('a')], Number(new URL(url).searchParams.get('_page')) === 1 ? 2 : 3) }))).rejects.toThrow('数量变化');
    await expect(readDirectory('0', async () => ({ status: 200, body: page([], 10001) }))).rejects.toThrow('最多读取');
  });
  it('远端登录窗口只允许HTTPS夸克域名，拒绝伪造后缀与外部协议', () => {
    expect(trustedLoginUrl('https://pan.quark.cn/list')).toBe(true);
    expect(trustedLoginUrl('https://uop.quark.cn/cas/custom/login')).toBe(true);
    for (const url of ['https://quark.cn.example.com', 'https://quark.cn@evil.com', 'http://pan.quark.cn', 'file:///etc/passwd', 'javascript:alert(1)', 'https://pan.quark.cn:8443']) expect(trustedLoginUrl(url)).toBe(false);
  });
});
