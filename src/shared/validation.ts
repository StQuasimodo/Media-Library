import type { AvailabilityStatus, MediaType, WatchStatus } from './types';

export interface Validated<T> {
  ok: true;
  value: T;
}

export interface Invalid {
  ok: false;
  message: string;
}

export type ValidationResult<T> = Validated<T> | Invalid;

/** Only plain HTTP(S) links may ever reach `shell.openExternal`. */
export function validateHttpUrl(input: string): ValidationResult<URL> {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, message: '链接不能为空。' };
  if (trimmed.length > 2048) return { ok: false, message: '链接过长（最多 2048 个字符）。' };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, message: '链接格式无效，请粘贴完整的 http 或 https 链接。' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, message: '只支持 http 或 https 链接。' };
  }
  if (!parsed.hostname) {
    return { ok: false, message: '链接缺少有效的域名。' };
  }
  return { ok: true, value: parsed };
}

export function isSafeExternalUrl(raw: string): boolean {
  return validateHttpUrl(raw).ok;
}

export function validateTitle(value: string): ValidationResult<string> {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, message: '标题不能为空。' };
  if (trimmed.length > 300) return { ok: false, message: '标题过长（最多 300 个字符）。' };
  return { ok: true, value: trimmed };
}

export function validateOptionalText(
  value: string | null | undefined,
  max: number,
  label: string,
): ValidationResult<string | null> {
  if (value == null) return { ok: true, value: null };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > max) {
    return { ok: false, message: `${label}过长（最多 ${max} 个字符）。` };
  }
  return { ok: true, value: trimmed };
}

export function validateRating(value: number | null | undefined): ValidationResult<number | null> {
  if (value == null) return { ok: true, value: null };
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return { ok: false, message: '评分必须是数字。' };
  }
  if (value < 0 || value > 10) return { ok: false, message: '评分范围是 0 到 10。' };
  return { ok: true, value: Math.round(value * 10) / 10 };
}

export function validateYear(value: number | null | undefined): ValidationResult<number | null> {
  if (value == null) return { ok: true, value: null };
  if (!Number.isInteger(value) || value < 1870 || value > 2200) {
    return { ok: false, message: '年份无效。' };
  }
  return { ok: true, value };
}

export function validateCollectionName(value: string): ValidationResult<string> {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, message: '专题名称不能为空。' };
  if (trimmed.length > 80) return { ok: false, message: '专题名称过长（最多 80 个字符）。' };
  return { ok: true, value: trimmed };
}

export function validateAccessCode(value: string | null | undefined): ValidationResult<string | null> {
  if (value == null) return { ok: true, value: null };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > 32) return { ok: false, message: '提取码过长（最多 32 个字符）。' };
  return { ok: true, value: trimmed };
}

export const WATCH_STATUSES: WatchStatus[] = ['want', 'watching', 'watched', 'dropped'];
export const AVAILABILITY_STATUSES: AvailabilityStatus[] = ['unchecked', 'available', 'unavailable'];
export const MEDIA_TYPES: MediaType[] = ['movie', 'tv'];

export function isWatchStatus(value: unknown): value is WatchStatus {
  return typeof value === 'string' && (WATCH_STATUSES as string[]).includes(value);
}

export function isAvailabilityStatus(value: unknown): value is AvailabilityStatus {
  return typeof value === 'string' && (AVAILABILITY_STATUSES as string[]).includes(value);
}

export function isMediaType(value: unknown): value is MediaType {
  return value === 'movie' || value === 'tv';
}

/** Quark share links use pan.quark.cn; a warning is surfaced but other hosts are allowed. */
export function isQuarkHost(rawUrl: string): boolean {
  const result = validateHttpUrl(rawUrl);
  if (!result.ok) return false;
  return /(^|\.)quark\.cn$/i.test(result.value.hostname);
}
