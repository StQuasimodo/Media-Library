import type { AvailabilityStatus, MediaType, WatchStatus } from '@shared/types';

export const WATCH_STATUS_LABEL: Record<WatchStatus, string> = {
  want: '想看',
  watching: '观看中',
  watched: '已看完',
  dropped: '暂不观看',
};

export const WATCH_STATUS_ORDER: WatchStatus[] = ['want', 'watching', 'watched', 'dropped'];

/** Single source for every status picker in the app. */
export const WATCH_STATUS_OPTIONS = WATCH_STATUS_ORDER.map((status) => ({
  value: status,
  label: WATCH_STATUS_LABEL[status],
}));

export const AVAILABILITY_LABEL: Record<AvailabilityStatus, string> = {
  unchecked: '未检查',
  available: '可用（用户确认）',
  unavailable: '不可用',
};

export const MEDIA_TYPE_LABEL: Record<MediaType, string> = {
  movie: '电影',
  tv: '剧集',
};

/**
 * Image URLs are served by the main process through the custom `mycinema://`
 * scheme. The headless UI harness sets `__MYCINEMA_IMAGE_BASE__` to an HTTP
 * path so the same bundle can be rendered by a plain browser for screenshots.
 */
const IMAGE_BASE: string =
  (globalThis as { __MYCINEMA_IMAGE_BASE__?: string }).__MYCINEMA_IMAGE_BASE__ ??
  'mycinema://image/';

/** `mycinema://image/poster/ab/<hash>.jpg` served by the main process. */
export function imageUrl(relativePath: string | null | undefined): string | null {
  if (!relativePath) return null;
  return `${IMAGE_BASE}${relativePath}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fromDateInputValue(value: string): string | null {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function formatRuntime(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return '—';
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分`;
}

export function formatRating(rating: number | null | undefined): string {
  if (rating == null) return '—';
  return Number.isInteger(rating) ? String(rating) : rating.toFixed(1);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function mediaLabel(mediaType: MediaType): string {
  return MEDIA_TYPE_LABEL[mediaType];
}

export function statusLabel(status: WatchStatus): string {
  return WATCH_STATUS_LABEL[status];
}
