import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import type { CollectionEntry } from '@shared/types';
import { Icon, type IconName } from './icons';
import { PosterImage } from './PosterImage';
import { formatRating, statusLabel } from '../lib/format';

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide = false,
  labelledBy,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  labelledBy?: string;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const fallbackId = useId();
  const titleId = labelledBy ?? fallbackId;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;

    // Prefer the first text field so typing can start immediately, otherwise
    // the first focusable control. Re-queried on every Tab because dialog
    // content loads asynchronously.
    const collect = () =>
      panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
    const initial = collect();
    const preferred =
      initial.find((node) => node.matches('input, textarea, select')) ?? initial[0] ?? panel;
    preferred?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = collect();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previous?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`modal${wide ? ' is-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
        tabIndex={-1}
      >
        <header className="modal-header">
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 className="modal-title" id={titleId}>
              {title}
            </h2>
            {subtitle ? <p className="modal-subtitle">{subtitle}</p> : null}
          </div>
          <button type="button" className="btn btn-icon" onClick={onClose} aria-label="关闭">
            <Icon name="close" size={17} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '确认',
  cancelLabel = '取消',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? <span className="spinner" /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="stack gap-2" style={{ color: 'var(--text-secondary)', lineHeight: 1.65 }}>
        {message}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Form helpers                                                        */
/* ------------------------------------------------------------------ */

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  optional = false,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  htmlFor?: string;
  children: ReactNode;
  optional?: boolean;
}) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
        {optional ? <span className="dim">（可选）</span> : null}
      </label>
      {children}
      {error ? <span className="field-error">{error}</span> : null}
      {!error && hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function RatingInput({
  value,
  onChange,
  disabled = false,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rating-control">
      {Array.from({ length: 10 }, (_, index) => index + 1).map((score) => (
        <button
          key={score}
          type="button"
          className="rating-dot"
          data-filled={value != null && value >= score}
          aria-label={`${score} 分`}
          aria-pressed={value === score}
          disabled={disabled}
          onClick={() => onChange(value === score ? null : score)}
        />
      ))}
      <input
        className="input rating-value-input"
        type="number"
        min={0}
        max={10}
        step={0.5}
        value={value ?? ''}
        placeholder="—"
        aria-label="个人评分"
        disabled={disabled}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === '') {
            onChange(null);
            return;
          }
          const parsed = Number(raw);
          if (Number.isFinite(parsed)) onChange(Math.min(10, Math.max(0, parsed)));
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* States                                                              */
/* ------------------------------------------------------------------ */

export function EmptyState({
  icon = 'film',
  title,
  text,
  children,
}: {
  icon?: IconName;
  title: string;
  text?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="state-panel">
      <span className="state-icon">
        <Icon name={icon} size={20} />
      </span>
      <h3 className="state-title">{title}</h3>
      {text ? <p className="state-text">{text}</p> : null}
      {children ? <div className="state-actions">{children}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = '加载失败',
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="state-panel is-error">
      <span className="state-icon">
        <Icon name="alert" size={20} />
      </span>
      <h3 className="state-title">{title}</h3>
      <p className="state-text">{message}</p>
      {onRetry ? (
        <div className="state-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
            <Icon name="refresh" size={14} />
            重试
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function SkeletonGrid({ count = 12, compact = false }: { count?: number; compact?: boolean }) {
  return (
    <div className={`poster-grid${compact ? ' is-compact' : ''}`} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index}>
          <div className="skeleton" style={{ aspectRatio: '2 / 3', borderRadius: 9 }} />
          <div
            className="skeleton"
            style={{ height: 12, marginTop: 12, width: '70%', borderRadius: 4 }}
          />
        </div>
      ))}
    </div>
  );
}

export function LoadingRow({ label = '加载中…' }: { label?: string }) {
  return (
    <div className="row gap-2 muted" style={{ padding: '18px 0', fontSize: 13 }}>
      <span className="spinner" />
      {label}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Poster                                                              */
/* ------------------------------------------------------------------ */

export function PosterCard({
  entry,
  compact = false,
  showStatus = true,
}: {
  entry: CollectionEntry;
  compact?: boolean;
  showStatus?: boolean;
}) {
  return (
    <Link
      to={`/film/${entry.film.id}`}
      className="poster-card"
      aria-label={`${entry.film.title}${entry.film.year ? `（${entry.film.year}）` : ''}`}
    >
      <div className="poster-frame">
        <PosterImage film={entry.film} />
        <span className="poster-badge">
          {entry.film.mediaType === 'tv' ? '剧集' : '电影'}
        </span>
        {showStatus ? (
          <div className="poster-overlay">
            <span className={`status-chip status-${entry.watchStatus}`}>
              <span className="chip-dot" />
              {statusLabel(entry.watchStatus)}
            </span>
            {entry.personalRating != null ? (
              <span className="rating">
                <span className="rating-value">{formatRating(entry.personalRating)}</span>
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="poster-caption">
        <div className="poster-title">{entry.film.title}</div>
        <div className="poster-sub">
          {[entry.film.year, compact ? null : entry.film.originalTitle]
            .filter(Boolean)
            .join(' · ') || '—'}
        </div>
      </div>
    </Link>
  );
}

export function AddPosterTile({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" className="poster-add" onClick={onClick}>
      <span className="poster-add-icon">
        <Icon name="plus" size={17} />
      </span>
      <span style={{ fontSize: 12.5 }}>{label}</span>
    </button>
  );
}
