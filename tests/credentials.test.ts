import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
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
