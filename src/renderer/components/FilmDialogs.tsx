import { useEffect, useState } from 'react';
import type {
  AvailabilityStatus,
  CollectionEntry,
  Film,
  FilmCollection,
  MediaType,
  MediaResource,
  WatchStatus,
} from '@shared/types';
import { api, describeError } from '../lib/api';
import { useToast } from '../lib/toast';
import {
  AVAILABILITY_LABEL,
  fromDateInputValue,
  toDateInputValue,
  WATCH_STATUS_OPTIONS,
} from '../lib/format';
import { ConfirmDialog, Field, Modal, RatingInput, Segmented } from './primitives';

/* ------------------------------------------------------------------ */
/* Film metadata                                                       */
/* ------------------------------------------------------------------ */

export function EditFilmDialog({
  open,
  film,
  onClose,
  onSaved,
}: {
  open: boolean;
  film: Film;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    title: film.title,
    originalTitle: film.originalTitle ?? '',
    year: film.year ? String(film.year) : '',
    mediaType: film.mediaType,
    runtime: film.runtime ? String(film.runtime) : '',
    overview: film.overview ?? '',
    tagline: film.tagline ?? '',
    genres: film.genres.join(' / '),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm({
      title: film.title,
      originalTitle: film.originalTitle ?? '',
      year: film.year ? String(film.year) : '',
      mediaType: film.mediaType,
      runtime: film.runtime ? String(film.runtime) : '',
      overview: film.overview ?? '',
      tagline: film.tagline ?? '',
      genres: film.genres.join(' / '),
    });
    setError(null);
  }, [open, film]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.library.updateFilm(film.id, {
        title: form.title,
        originalTitle: form.originalTitle || null,
        year: form.year ? Number.parseInt(form.year, 10) : null,
        mediaType: form.mediaType as MediaType,
        runtime: form.runtime ? Number.parseInt(form.runtime, 10) : null,
        overview: form.overview || null,
        tagline: form.tagline || null,
        genres: form.genres
          .split(/[/,，]/)
          .map((genre) => genre.trim())
          .filter(Boolean),
      });
      toast.success('影视资料已更新');
      onSaved();
      onClose();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      wide
      title="编辑影视资料"
      subtitle="只修改本地资料，不会影响你的评分、笔记和网盘资源"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? <span className="spinner" /> : null}
            保存
          </button>
        </>
      }
    >
      <div className="form-grid cols-2">
        <Field label="标题" htmlFor="film-title">
          <input
            id="film-title"
            className="input"
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
          />
        </Field>
        <Field label="原始标题" htmlFor="film-original" optional>
          <input
            id="film-original"
            className="input"
            value={form.originalTitle}
            onChange={(event) => setForm({ ...form, originalTitle: event.target.value })}
          />
        </Field>
        <Field label="年份" htmlFor="film-year" optional>
          <input
            id="film-year"
            className="input"
            inputMode="numeric"
            value={form.year}
            onChange={(event) =>
              setForm({ ...form, year: event.target.value.replace(/[^\d]/g, '') })
            }
          />
        </Field>
        <Field label="类型" htmlFor="film-type">
          <select
            id="film-type"
            className="select"
            value={form.mediaType}
            onChange={(event) => setForm({ ...form, mediaType: event.target.value as MediaType })}
          >
            <option value="movie">电影</option>
            <option value="tv">剧集</option>
          </select>
        </Field>
        <Field label="片长（分钟）" htmlFor="film-runtime" optional>
          <input
            id="film-runtime"
            className="input"
            inputMode="numeric"
            value={form.runtime}
            onChange={(event) =>
              setForm({ ...form, runtime: event.target.value.replace(/[^\d]/g, '') })
            }
          />
        </Field>
        <Field label="类型标签" htmlFor="film-genres" optional hint="用 / 分隔，例如：剧情 / 科幻">
          <input
            id="film-genres"
            className="input"
            value={form.genres}
            onChange={(event) => setForm({ ...form, genres: event.target.value })}
          />
        </Field>
        <div className="span-all">
          <Field label="宣传语" htmlFor="film-tagline" optional>
            <input
              id="film-tagline"
              className="input"
              value={form.tagline}
              onChange={(event) => setForm({ ...form, tagline: event.target.value })}
            />
          </Field>
        </div>
        <div className="span-all">
          <Field label="简介" htmlFor="film-overview" optional>
            <textarea
              id="film-overview"
              className="textarea"
              style={{ minHeight: 120 }}
              value={form.overview}
              onChange={(event) => setForm({ ...form, overview: event.target.value })}
            />
          </Field>
        </div>
      </div>
      {error ? <p className="field-error" style={{ marginTop: 12 }}>{error}</p> : null}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Personal collection info                                            */
/* ------------------------------------------------------------------ */

export function EditEntryDialog({
  open,
  entry,
  onClose,
  onSaved,
}: {
  open: boolean;
  entry: CollectionEntry;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    personalRating: entry.personalRating,
    watchStatus: entry.watchStatus as WatchStatus,
    collectedAt: toDateInputValue(entry.collectedAt),
    watchedAt: toDateInputValue(entry.watchedAt),
    favoriteReason: entry.favoriteReason ?? '',
    personalReview: entry.personalReview ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm({
      personalRating: entry.personalRating,
      watchStatus: entry.watchStatus,
      collectedAt: toDateInputValue(entry.collectedAt),
      watchedAt: toDateInputValue(entry.watchedAt),
      favoriteReason: entry.favoriteReason ?? '',
      personalReview: entry.personalReview ?? '',
    });
    setError(null);
  }, [open, entry]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.library.updateEntry(entry.id, {
        personalRating: form.personalRating,
        watchStatus: form.watchStatus,
        collectedAt: fromDateInputValue(form.collectedAt) ?? undefined,
        watchedAt: form.watchedAt ? fromDateInputValue(form.watchedAt) : null,
        favoriteReason: form.favoriteReason || null,
        personalReview: form.personalReview || null,
      });
      toast.success('收藏信息已保存');
      onSaved();
      onClose();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      wide
      title="编辑收藏信息"
      subtitle="这些是你自己的记录，重新获取外部资料时不会被覆盖"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? <span className="spinner" /> : null}
            保存
          </button>
        </>
      }
    >
      <div className="form-grid cols-2">
        <div className="stack gap-2">
          <span className="field-label">个人评分</span>
          <RatingInput
            value={form.personalRating}
            onChange={(value) => setForm({ ...form, personalRating: value })}
          />
        </div>
        <div className="stack gap-2">
          <span className="field-label">观看状态</span>
          <Segmented
            ariaLabel="观看状态"
            value={form.watchStatus}
            onChange={(value) => setForm({ ...form, watchStatus: value })}
            options={WATCH_STATUS_OPTIONS}
          />
        </div>
        <Field label="收藏时间" htmlFor="entry-collected">
          <input
            id="entry-collected"
            className="input"
            type="date"
            value={form.collectedAt}
            onChange={(event) => setForm({ ...form, collectedAt: event.target.value })}
          />
        </Field>
        <Field label="观看时间" htmlFor="entry-watched" optional>
          <input
            id="entry-watched"
            className="input"
            type="date"
            value={form.watchedAt}
            onChange={(event) => setForm({ ...form, watchedAt: event.target.value })}
          />
        </Field>
        <div className="span-all">
          <Field
            label="收藏理由"
            htmlFor="entry-reason"
            optional
            hint="为什么把它收进自己的收藏库？"
          >
            <textarea
              id="entry-reason"
              className="textarea"
              style={{ minHeight: 84 }}
              value={form.favoriteReason}
              onChange={(event) => setForm({ ...form, favoriteReason: event.target.value })}
            />
          </Field>
        </div>
        <div className="span-all">
          <Field label="个人短评" htmlFor="entry-review" optional>
            <textarea
              id="entry-review"
              className="textarea"
              style={{ minHeight: 110 }}
              value={form.personalReview}
              onChange={(event) => setForm({ ...form, personalReview: event.target.value })}
            />
          </Field>
        </div>
      </div>
      {error ? <p className="field-error" style={{ marginTop: 12 }}>{error}</p> : null}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Quark resource                                                      */
/* ------------------------------------------------------------------ */

const EMPTY_RESOURCE = {
  resourceName: '',
  shareUrl: '',
  accessCode: '',
  qualityLabel: '',
  versionLabel: '',
  subtitleLabel: '',
  audioLabel: '',
  notes: '',
  availabilityStatus: 'unchecked' as AvailabilityStatus,
};

export function ResourceDialog({
  open,
  filmId,
  resource,
  onClose,
  onSaved,
}: {
  open: boolean;
  filmId: string;
  resource: MediaResource | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({ ...EMPTY_RESOURCE });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (resource) {
      setForm({
        resourceName: resource.resourceName,
        shareUrl: resource.shareUrl,
        accessCode: resource.accessCode ?? '',
        qualityLabel: resource.qualityLabel ?? '',
        versionLabel: resource.versionLabel ?? '',
        subtitleLabel: resource.subtitleLabel ?? '',
        audioLabel: resource.audioLabel ?? '',
        notes: resource.notes ?? '',
        availabilityStatus: resource.availabilityStatus,
      });
    } else {
      setForm({ ...EMPTY_RESOURCE });
    }
  }, [open, resource]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (resource) {
        await api.resources.update(resource.id, {
          resourceName: form.resourceName,
          shareUrl: form.shareUrl,
          accessCode: form.accessCode || null,
          qualityLabel: form.qualityLabel || null,
          versionLabel: form.versionLabel || null,
          subtitleLabel: form.subtitleLabel || null,
          audioLabel: form.audioLabel || null,
          notes: form.notes || null,
          availabilityStatus: form.availabilityStatus,
        });
        toast.success('资源记录已更新');
      } else {
        await api.resources.create({
          filmId,
          resourceName: form.resourceName,
          shareUrl: form.shareUrl,
          accessCode: form.accessCode || null,
          qualityLabel: form.qualityLabel || null,
          versionLabel: form.versionLabel || null,
          subtitleLabel: form.subtitleLabel || null,
          audioLabel: form.audioLabel || null,
          notes: form.notes || null,
          availabilityStatus: form.availabilityStatus,
        });
        toast.success('已添加夸克资源');
      }
      onSaved();
      onClose();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      wide
      title={resource ? '编辑夸克资源' : '添加夸克资源'}
      subtitle="只保存你提供的链接与备注，应用不会访问或解析网盘内容"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? <span className="spinner" /> : null}
            {resource ? '保存修改' : '添加资源'}
          </button>
        </>
      }
    >
      <div className="form-grid cols-2">
        <div className="span-all">
          <Field label="资源名称" htmlFor="res-name" hint="例如：花样年华 4K 修复版 内封中字">
            <input
              id="res-name"
              className="input"
              value={form.resourceName}
              onChange={(event) => setForm({ ...form, resourceName: event.target.value })}
            />
          </Field>
        </div>
        <div className="span-all">
          <Field
            label="分享链接"
            htmlFor="res-url"
            hint="只接受 http/https 链接，例如 https://pan.quark.cn/s/xxxx"
          >
            <input
              id="res-url"
              className="input"
              placeholder="https://pan.quark.cn/s/..."
              value={form.shareUrl}
              onChange={(event) => setForm({ ...form, shareUrl: event.target.value })}
            />
          </Field>
        </div>
        <Field label="提取码" htmlFor="res-code" optional hint="将随资源保存在本机数据库">
          <input
            id="res-code"
            className="input"
            value={form.accessCode}
            onChange={(event) => setForm({ ...form, accessCode: event.target.value })}
          />
        </Field>
        <Field label="资源状态" htmlFor="res-status" hint="应用不会自动检测链接是否有效">
          <select
            id="res-status"
            className="select"
            value={form.availabilityStatus}
            onChange={(event) =>
              setForm({ ...form, availabilityStatus: event.target.value as AvailabilityStatus })
            }
          >
            {(Object.keys(AVAILABILITY_LABEL) as AvailabilityStatus[]).map((value) => (
              <option key={value} value={value}>
                {AVAILABILITY_LABEL[value]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="清晰度" htmlFor="res-quality" optional>
          <input
            id="res-quality"
            className="input"
            placeholder="4K / 1080p"
            value={form.qualityLabel}
            onChange={(event) => setForm({ ...form, qualityLabel: event.target.value })}
          />
        </Field>
        <Field label="版本" htmlFor="res-version" optional>
          <input
            id="res-version"
            className="input"
            placeholder="导演剪辑版 / REMUX"
            value={form.versionLabel}
            onChange={(event) => setForm({ ...form, versionLabel: event.target.value })}
          />
        </Field>
        <Field label="字幕" htmlFor="res-subtitle" optional>
          <input
            id="res-subtitle"
            className="input"
            placeholder="内封中字 / 外挂字幕"
            value={form.subtitleLabel}
            onChange={(event) => setForm({ ...form, subtitleLabel: event.target.value })}
          />
        </Field>
        <Field label="音轨" htmlFor="res-audio" optional>
          <input
            id="res-audio"
            className="input"
            placeholder="国语 / 原声"
            value={form.audioLabel}
            onChange={(event) => setForm({ ...form, audioLabel: event.target.value })}
          />
        </Field>
        <div className="span-all">
          <Field label="备注" htmlFor="res-notes" optional>
            <textarea
              id="res-notes"
              className="textarea"
              style={{ minHeight: 80 }}
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </Field>
        </div>
      </div>
      {error ? <p className="field-error" style={{ marginTop: 12 }}>{error}</p> : null}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Topic membership                                                    */
/* ------------------------------------------------------------------ */

export function ManageCollectionsDialog({
  open,
  entryId,
  collections,
  memberIds,
  onClose,
  onChanged,
}: {
  open: boolean;
  entryId: string;
  collections: FilmCollection[];
  memberIds: string[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  const toggle = async (collection: FilmCollection, member: boolean) => {
    setBusyId(collection.id);
    try {
      if (member) {
        await api.collections.removeFilm(collection.id, entryId);
        toast.push(`已从「${collection.name}」移除`);
      } else {
        await api.collections.addFilm(collection.id, entryId);
        toast.success(`已加入「${collection.name}」`);
      }
      onChanged();
    } catch (cause) {
      toast.error(describeError(cause));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal
      open={open}
      title="管理所属专题"
      subtitle="一部作品可以同时属于多个专题"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            完成
          </button>
        </>
      }
    >
      {collections.length === 0 ? (
        <p className="dim" style={{ fontSize: 13 }}>
          还没有专题。请先在「专题」页面创建一个。
        </p>
      ) : (
        <div className="stack gap-2">
          {collections.map((collection) => {
            const member = memberIds.includes(collection.id);
            return (
              <label
                key={collection.id}
                className="row-card"
                style={{ gridTemplateColumns: '1fr auto' }}
              >
                <span className="row-main">
                  <span className="row-title">{collection.name}</span>
                  <span className="row-sub">{collection.filmCount} 部作品</span>
                </span>
                <span className="row-actions">
                  {busyId === collection.id ? <span className="spinner" /> : null}
                  <input
                    type="checkbox"
                    checked={member}
                    disabled={busyId === collection.id}
                    onChange={() => void toggle(collection, member)}
                    aria-label={`${member ? '从' : '加入'} ${collection.name}`}
                    style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
                  />
                </span>
              </label>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

export function ConfirmRemoveFilmDialog({
  open,
  title,
  resourceCount,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  resourceCount: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      danger
      title="从收藏库中移除"
      confirmLabel="确认移除"
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
      message={
        <>
          <p>
            将移除《{title}》的收藏记录、个人评分与笔记
            {resourceCount > 0 ? `，以及关联的 ${resourceCount} 条夸克资源记录` : ''}。
          </p>
          <p>专题本身不会被删除，其他作品也不受影响。</p>
          <p className="dim" style={{ fontSize: 12 }}>
            此操作无法撤销。建议先在「设置」中创建一次备份。
          </p>
        </>
      }
    />
  );
}

export function ResourceDeleteDialog({
  open,
  name,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  name: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      danger
      title="删除夸克资源记录"
      confirmLabel="删除"
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
      message={
        <>
          <p>将删除资源记录「{name}」。</p>
          <p>影视作品、收藏信息和其他资源不会受影响。</p>
        </>
      }
    />
  );
}
