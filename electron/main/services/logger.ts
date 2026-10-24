import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

const JWT_LIKE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const SECRET_QUERY = /([?&](?:pwd|passcode|access_code|password|api_key|key)=)[^&\s#'"]+/gi;

/**
 * Minimal file logger with secret redaction.
 *
 * Callers must register secrets (API key, access codes) so they are scrubbed
 * from both messages and captured error details before anything is written.
 */
export class Logger {
  private readonly file: string;
  private readonly secrets = new Set<string>();
  private readonly maxBytes: number;
  private consoleEnabled: boolean;

  constructor(file: string, options: { maxBytes?: number; console?: boolean } = {}) {
    this.file = file;
    this.maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
    this.consoleEnabled = options.console ?? false;
  }

  registerSecret(secret: string | null | undefined): void {
    if (!secret) return;
    const trimmed = secret.trim();
    if (trimmed.length >= 4) this.secrets.add(trimmed);
  }

  info(message: string): void {
    this.write('INFO', message);
  }

  warn(message: string): void {
    this.write('WARN', message);
  }

  error(message: string, error?: unknown): void {
    if (error === undefined) {
      this.write('ERROR', message);
      return;
    }
    const detail =
      error instanceof Error
        ? `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`
        : String(error);
    this.write('ERROR', `${message}\n${detail}`);
  }

  scrub(text: string): string {
    let output = text;
    for (const secret of this.secrets) {
      if (!secret) continue;
      output = output.split(secret).join('[redacted]');
    }
    return output
      .replace(JWT_LIKE, '[redacted-token]')
      .replace(SECRET_QUERY, '$1[redacted]');
  }

  private write(level: string, message: string): void {
    const line = `${new Date().toISOString()} ${level} ${this.scrub(message)}\n`;
    if (this.consoleEnabled) {
      process.stdout.write(line);
    }
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      this.rotateIfNeeded();
      appendFileSync(this.file, line, 'utf8');
    } catch {
      // Logging must never break a user-facing operation.
    }
  }

  private rotateIfNeeded(): void {
    if (!existsSync(this.file)) return;
    try {
      if (statSync(this.file).size < this.maxBytes) return;
      renameSync(this.file, `${this.file}.1`);
    } catch {
      // ignore rotation failures
    }
  }
}
