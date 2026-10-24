import { useState } from 'react';
import type { FilmCollection } from '@shared/types';
import { api, describeError } from '../lib/api';
import { useAppState } from '../lib/appState';
import { useToast } from '../lib/toast';
import { useAsyncData } from '../lib/useAsync';
import { CollectionCard } from '../components/CollectionCard';
import { ConfirmDialog, EmptyState, ErrorState, Field, Modal } from '../components/primitives';
import { Icon } from '../components/icons';

export function CollectionsPage({ onOpenImport }: { onOpenImport: () => void }) {
  const { version, invalidate } = useAppState();
  const toast = useToast();
  const collections = useAsyncData(() => api.collections.list(), [version]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FilmCollection | null>(null);
  const [form, setForm] = useState({ name: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<FilmCollection | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', description: '' });
    setError(null);
    setDialogOpen(true);
  };

  const openEdit = (collection: FilmCollection) => {
    setEditing(collection);
    setForm({ name: collection.name, description: collection.description ?? '' });
    setError(null);
    setDialogOpen(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await api.collections.update(editing.id, {
          name: form.name,
          description: form.description || null,
        });
        toast.success('专题已更新');
      } else {
        await api.collections.create({
          name: form.name,
          description: form.description || null,
        });
        toast.success('专题已创建');
      }
      invalidate();
      setDialogOpen(false);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setDeletingBusy(true);
    try {
      await api.collections.remove(deleting.id);
      invalidate();
      toast.push(`已删除专题「${deleting.name}」，其中的影视作品仍保留在收藏库`);
      setDeleting(null);
    } catch (cause) {
      toast.error(describeError(cause));
    } finally {
      setDeletingBusy(false);
    }
  };

  const list = collections.data ?? [];

  return (
    <>
      <div className="section-head">
        <h1 className="section-title" style={{ fontSize: 22 }}>
          专题
        </h1>
        <span className="section-sub">用线索把收藏重新编排</span>
        <span className="spacer" />
        <button type="button" className="btn btn-primary" onClick={openCreate}>
          <Icon name="plus" size={15} />
          新建专题
        </button>
      </div>

      {collections.loading && !collections.data ? (
        <div className="collection-grid">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="skeleton" style={{ height: 210, borderRadius: 12 }} />
          ))}
        </div>
      ) : collections.error ? (
        <ErrorState message={collections.error} onRetry={collections.reload} />
      ) : list.length === 0 ? (
        <EmptyState
          icon="layers"
          title="还没有专题"
          text="专题可以是任何你关心的线索：一个导演、一种情绪、一次重看计划。删除专题不会删除其中的影视作品。"
        >
          <button type="button" className="btn btn-secondary btn-sm" onClick={openCreate}>
            <Icon name="plus" size={14} />
            创建第一个专题
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenImport}>
            先添加作品
          </button>
        </EmptyState>
      ) : (
        <div className="collection-grid">
          {list.map((collection) => (
            <CollectionCard
              key={collection.id}
              collection={collection}
              onEdit={openEdit}
              onDelete={setDeleting}
            />
          ))}
        </div>
      )}

      <Modal
        open={dialogOpen}
        title={editing ? '编辑专题' : '新建专题'}
        subtitle="专题名称在本机唯一"
        onClose={() => setDialogOpen(false)}
        footer={
          <>
            <span className="spacer" />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              取消
            </button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? <span className="spinner" /> : null}
              {editing ? '保存' : '创建'}
            </button>
          </>
        }
      >
        <div className="stack gap-4">
          <Field label="专题名称" htmlFor="collection-name">
            <input
              id="collection-name"
              className="input"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="例如：华语新浪潮"
              autoFocus
            />
          </Field>
          <Field label="描述" htmlFor="collection-desc" optional>
            <textarea
              id="collection-desc"
              className="textarea"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder="这个专题想收集什么？"
            />
          </Field>
          {error ? <p className="field-error">{error}</p> : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        danger
        title="删除专题"
        confirmLabel="删除专题"
        busy={deletingBusy}
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(null)}
        message={
          <>
            <p>将删除专题「{deleting?.name}」。</p>
            <p>专题中的 {deleting?.filmCount ?? 0} 部影视作品会保留在收藏库中，个人评分与网盘资源不受影响。</p>
          </>
        }
      />
    </>
  );
}
