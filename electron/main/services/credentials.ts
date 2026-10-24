import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

/** Adapter over Electron's safeStorage (DPAPI on Windows), faked in tests. */
export interface SecretBox {
  isAvailable(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(payload: Buffer): string;
}

interface CredentialFile {
  version: number;
  tmdbApiKey?: string;
}

/**
 * Stores the TMDB API key encrypted with the OS credential store.
 *
 * The key never reaches the renderer, never lands in the database export and is
 * never written to logs.
 */
export class CredentialStore {
  private cache: string | null | undefined;

  constructor(
    private readonly file: string,
    private readonly box: SecretBox,
  ) {}

  hasKey(): boolean {
    return Boolean(this.getKey());
  }

  getKey(): string | null {
    if (this.cache !== undefined) return this.cache;
    this.cache = this.load();
    return this.cache;
  }

  setKey(key: string | null): void {
    const trimmed = key?.trim() ?? '';
    if (!trimmed) {
      this.writeFile({ version: 1 });
      this.cache = null;
      return;
    }
    if (!this.box.isAvailable()) {
      throw new Error('系统凭据存储不可用，无法安全保存 API Key。');
    }
    const encrypted = this.box.encrypt(trimmed).toString('base64');
    this.writeFile({ version: 1, tmdbApiKey: encrypted });
    this.cache = trimmed;
  }

  private load(): string | null {
    if (!existsSync(this.file)) return null;
    try {
      const raw = readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw) as CredentialFile;
      if (!parsed?.tmdbApiKey) return null;
      if (!this.box.isAvailable()) return null;
      const decrypted = this.box.decrypt(Buffer.from(parsed.tmdbApiKey, 'base64'));
      return decrypted || null;
    } catch {
      // A broken credential file must not block the app; the user can re-enter the key.
      return null;
    }
  }

  private writeFile(payload: CredentialFile): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
    try {
      renameSync(temporary, this.file);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }
}
