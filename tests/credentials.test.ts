import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { CredentialStore, type SecretBox } from '../electron/main/services/credentials';

const box: SecretBox = { isAvailable: () => true, encrypt: (s) => Buffer.from(s), decrypt: (b) => b.toString() };
it('写入或清除凭据失败时，内存状态不假装保存成功', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cinema-credentials-'));
  const path = join(dir, 'credentials.json');
  try {
    const store = new CredentialStore(path, box);
    store.setKey('old-test-key');
    rmSync(path);
    mkdirSync(path); // A directory cannot be atomically replaced by the file.
    expect(() => store.setKey('new-test-key')).toThrow();
    expect(store.getKey()).toBe('old-test-key');
    expect(() => store.setKey(null)).toThrow();
    expect(store.getKey()).toBe('old-test-key');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function withStore(check: (file: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'cinema-credentials-'));
  try { check(join(dir, 'credentials.json')); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

it('系统凭据暂不可用时保留原文件，同一进程可重新读取', () => withStore(file => {
  new CredentialStore(file, box).setKey('synthetic-test-key');
  const original = readFileSync(file);
  let available = false;
  const store = new CredentialStore(file, { ...box, isAvailable: () => available });
  expect(store.getState()).toBe('unavailable');
  expect(store.hasKey()).toBe(false);
  expect(readFileSync(file)).toEqual(original);
  available = true;
  expect(store.getState()).toBe('configured');
  expect(store.getKey()).toBe('synthetic-test-key');
}));

it('解密失败不被误报为未配置，不泄露异常或覆盖原凭据，恢复后可重试', () => withStore(file => {
  new CredentialStore(file, box).setKey('synthetic-test-key');
  const original = readFileSync(file);
  let readable = false;
  const store = new CredentialStore(file, { ...box, decrypt: value => {
    if (!readable) throw new Error('sensitive error text');
    return box.decrypt(value);
  } });
  expect(store.getState()).toBe('unreadable');
  expect(store.getKey()).toBeNull();
  expect(readFileSync(file)).toEqual(original);
  readable = true;
  expect(store.getKey()).toBe('synthetic-test-key');
  expect(store.getState()).toBe('configured');
}));

it('未配置、格式损坏与不支持的版本分开处理，外部恢复后可再次读取', () => withStore(file => {
  const store = new CredentialStore(file, box);
  expect(store.getState()).toBe('missing');
  for (const payload of ['{broken', '{"version":2,"tmdbApiKey":"legacy"}']) {
    writeFileSync(file, payload);
    expect(store.getState()).toBe('unreadable');
    expect(readFileSync(file, 'utf8')).toBe(payload);
  }
  new CredentialStore(file, box).setKey('recovered-test-key');
  expect(store.getState()).toBe('configured');
  expect(store.getKey()).toBe('recovered-test-key');
}));

it('重建凭据服务沿用版本1文件；主动清除后重启不会恢复旧值', () => withStore(file => {
  const store = new CredentialStore(file, box);
  store.setKey('persisted-test-key');
  const restarted = new CredentialStore(file, box);
  expect(restarted.getKey()).toBe('persisted-test-key');
  expect(restarted.getState()).toBe('configured');
  restarted.setKey(null);
  expect(new CredentialStore(file, box).getState()).toBe('missing');
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1 });
}));
