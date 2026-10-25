import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import type { MetadataCredentialState } from '../../../src/shared/types';

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
  private cache: string | undefined;
  private state: MetadataCredentialState = 'missing';

  constructor(
    private readonly file: string,
    private readonly box: SecretBox,
  ) {}

  hasKey(): boolean {
    return Boolean(this.getKey());
  }

  getState(): MetadataCredentialState {
    this.getKey();
    return this.state;
  }

  getKey(): string | null {
    if (this.cache !== undefined) return this.cache;
    const key = this.load();
    // A temporary storage/decryption failure must be retryable in this process.
    // Only cache a successful read; never rewrite or remove an unreadable file.
    if (key !== null) this.cache = key;
    return key;
  }

  setKey(key: string | null): void {
    const trimmed = key?.trim() ?? '';
    if (!trimmed) {
      this.writeFile({ version: 1 });
      this.cache = undefined;
      this.state = 'missing';
      return;
    }
    if (!this.box.isAvailable()) {
      throw new Error('系统凭据存储不可用，无法安全保存 API Key。');
    }
    const encrypted = this.box.encrypt(trimmed).toString('base64');
    this.writeFile({ version: 1, tmdbApiKey: encrypted });
    this.cache = trimmed;
    this.state = 'configured';
  }

  private load(): string | null {
    this.state = 'unreadable';
    try {
      const raw = readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw) as CredentialFile;
      if (parsed?.version !== 1 || (parsed.tmdbApiKey !== undefined && typeof parsed.tmdbApiKey !== 'string')) {
        this.state = 'unreadable';
        return null;
      }
      if (!parsed.tmdbApiKey) { this.state = 'missing'; return null; }
      this.state = 'unavailable';
      if (!this.box.isAvailable()) return null;
      this.state = 'unreadable';
      const decrypted = this.box.decrypt(Buffer.from(parsed.tmdbApiKey, 'base64'));
      if (decrypted) this.state = 'configured';
      return decrypted || null;
    } catch (error) {
      // Report only a state, never the exception (which could contain secrets).
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') this.state = 'missing';
      else if (this.state !== 'unavailable') this.state = 'unreadable';
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
