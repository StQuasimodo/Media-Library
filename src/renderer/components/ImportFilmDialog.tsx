import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  MediaType,
  MetadataCandidate,
  MetadataSearchResult,
  WatchStatus,
} from '@shared/types';
import { api, describeError, errorCode } from '../lib/api';
import { useAppState } from '../lib/appState';
import { useToast } from '../lib/toast';
import { Field, Modal, RatingInput, Segmented } from './primitives';
import { Icon } from './icons';
import { MEDIA_TYPE_LABEL, WATCH_STATUS_OPTIONS } from '../lib/format';

type Stage = 'search' | 'confirm';

interface EntryDraft {
  personalRating: number | null;
  watchStatus: WatchStatus;
  favoriteReason: string;
}

const EMPTY_DRAFT: EntryDraft = {
  personalRating: null,
  watchStatus: 'want',
  favoriteReason: '',
};

export function ImportFilmDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const { invalidate, info } = useAppState();

  const [mode, setMode] = useState<'search' | 'manual'>('search');
  const [query, setQuery] = useState('');
  const [mediaType, setMediaType] = useState<MediaType | 'all'>('all');
  const [year, setYear] = useState('');
  const [results, setResults] = useState<MetadataSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<string>('');

  const [stage, setStage] = useState<Stage>('search');
  const [candidate, setCandidate] = useState<MetadataCandidate | null>(null);
  const [loadingCandidate, setLoadingCandidate] = useState(false);
  const [draft, setDraft] = useState<EntryDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  const [manual, setManual] = useState({
    title: '',
    originalTitle: '',
    year: '',
    mediaType: 'movie' as MediaType,
    overview: '',
  });

  useEffect(() => {
    if (!open) return;
    setStage('search');
    setCandidate(null);
    setResults(null);
    setError(null);
    setErrorKind('');
    setDraft(EMPTY_DRAFT);
    setQuery('');
    setYear('');
    setManual({ title: '', originalTitle: '', year: '', mediaType: 'movie', overview: '' });
  }, [open]);

  const hasKey = info?.hasMetadataApiKey ?? false;

  const runSearch = async () => {
    if (!query.trim()) {
      setError('请输入要搜索的作品名称。');
      setErrorKind('VALIDATION');
      return;
    }
    setSearching(true);
    setError(null);
    setErrorKind('');
    setResults(null);
    try {
      const found = await api.metadata.search({
        query: query.trim(),
        mediaType,
        year: year.trim() ? Number.parseInt(year, 10) : null,
      });
      setResults(found);
    } catch (cause) {
      setError(describeError(cause));
      setErrorKind(errorCode(cause));
    } finally {
      setSearching(false);
    }
  };

  const chooseCandidate = async (result: MetadataSearchResult) => {
    setLoadingCandidate(true);
    setError(null);
    try {
      const detail = await api.metadata.candidate(result.externalId, result.mediaType);
      setCandidate(detail);
      setStage('confirm');
    } catch (cause) {
      setError(describeError(cause));
      setErrorKind(errorCode(cause));
    } finally {
      setLoadingCandidate(false);
    }
  };

  const importCandidate = async () => {
    if (!candidate) return;
    setSaving(true);
    try {
      const result = await api.library.importCandidate(candidate, {
        personalRating: draft.personalRating,
        watchStatus: draft.watchStatus,
        favoriteReason: draft.favoriteReason.trim() || null,
      });
      invalidate();
      if (result.duplicate) {
        toast.push('这部作品已经在收藏库中，已为你打开详情。');
      } else {
        toast.success(`已加入收藏库：${result.film.title}`);
      }
      if (result.imageWarning) {
        toast.error(`作品已保存，但图片缓存失败：${result.imageWarning}`);
      }
      onClose();
      navigate(`/film/${result.film.id}`);
    } catch (cause) {
      toast.error(describeError(cause));
    } finally {
      setSaving(false);
    }
  };

  const createManual = async () => {
    if (!manual.title.trim()) {
      setError('请输入标题。');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const detail = await api.library.createManual({
        title: manual.title.trim(),
        originalTitle: manual.originalTitle.trim() || null,
        year: manual.year.trim() ? Number.parseInt(manual.year, 10) : null,
        mediaType: manual.mediaType,
        overview: manual.overview.trim() || null,
        entry: { watchStatus: draft.watchStatus, personalRating: draft.personalRating },
      });
      invalidate();
      toast.success(`已添加：${detail.film.title}`);
      onClose();
      navigate(`/film/${detail.film.id}`);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setSaving(false);
    }
  };

  const title =
    stage === 'confirm' && candidate
      ? '确认导入影视资料'
      : mode === 'manual'
        ? '手动添加影视作品'
        : '添加影视作品';

  return (
    <Modal
      open={open}
      wide
      title={title}
      subtitle={
        stage === 'confirm'
          ? '确认后会把资料和海报保存到本地收藏库'
          : '从 TMDB 搜索真实影视资料，或手动录入没有网络资料的作品'
      }
      onClose={onClose}
      footer={
        stage === 'confirm' ? (
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setStage('search')}
              disabled={saving}
            >
              <Icon name="chevronLeft" size={15} />
              返回结果
            </button>
            <span className="spacer" />
            <button type="button" className="btn btn-primary" onClick={importCandidate} disabled={saving}>
              {saving ? <span className="spinner" /> : <Icon name="download" size={15} />}
              确认导入
            </button>
          </>
        ) : mode === 'manual' ? (
          <>
            <span className="spacer" />
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
              取消
            </button>
            <button type="button" className="btn btn-primary" onClick={createManual} disabled={saving}>
              {saving ? <span className="spinner" /> : <Icon name="plus" size={15} />}
              添加到收藏库
            </button>
          </>
        ) : null
      }
    >
      {stage === 'search' ? (
        <>
          <div className="row gap-2" style={{ marginBottom: 16 }}>
            <Segmented
              ariaLabel="添加方式"
              value={mode}
              onChange={(next) => {
                setMode(next);
                setError(null);
              }}
              options={[
                { value: 'search', label: '搜索 TMDB' },
                { value: 'manual', label: '手动添加' },
              ]}
            />
            <span className="dim" style={{ fontSize: 12 }}>
              {mode === 'search'
                ? '搜索结果来自 TMDB，导入前可逐条确认'
                : '适合没有外部资料或不想联网时使用'}
            </span>
          </div>

          {mode === 'search' ? (
            <>
              {!hasKey ? (
                <div className="state-panel" style={{ padding: '20px 18px', marginBottom: 16 }}>
                  <p className="state-text" style={{ maxWidth: 620 }}>
                    尚未配置 TMDB API Key，因此无法在线搜索。你可以在「设置」中填入自己的 Key（免费申请），
                    或者先用「手动添加」记录作品信息。
                  </p>
                  <div className="state-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        onClose();
                        navigate('/settings#metadata');
                      }}
                    >
                      <Icon name="key" size={14} />
                      前往设置
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="import-search-row">
                <Field label="作品名称" htmlFor="import-query">
                  <input
                    id="import-query"
                    className="input"
                    placeholder="例如：花样年华 / Blade Runner"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void runSearch();
                    }}
                    autoFocus
                  />
                </Field>
                <Field label="年份" htmlFor="import-year" optional>
                  <input
                    id="import-year"
                    className="input"
                    style={{ width: 108 }}
                    inputMode="numeric"
                    placeholder="任意"
                    value={year}
                    onChange={(event) => setYear(event.target.value.replace(/[^\d]/g, ''))}
                  />
                </Field>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={runSearch}
                  disabled={searching || !hasKey}
                  style={{ marginBottom: 2 }}
                >
                  {searching ? <span className="spinner" /> : <Icon name="search" size={15} />}
                  搜索
                </button>
              </div>

              <div className="row gap-2" style={{ marginBottom: 14 }}>
                <Segmented
                  ariaLabel="作品类型"
                  value={mediaType}
                  onChange={setMediaType}
                  options={[
                    { value: 'all', label: '全部' },
                    { value: 'movie', label: '电影' },
                    { value: 'tv', label: '剧集' },
                  ]}
                />
              </div>

              {error ? (
                <div className="field-error" style={{ marginBottom: 12 }}>
                  {error}
                  {errorKind === 'INVALID_API_KEY' ? (
                    <button
                      type="button"
                      className="link-button"
                      style={{ marginLeft: 8 }}
                      onClick={() => {
                        onClose();
                        navigate('/settings#metadata');
                      }}
                    >
                      去更新 Key
                    </button>
                  ) : null}
                </div>
              ) : null}

              {loadingCandidate ? (
                <div className="row gap-2 muted" style={{ padding: '14px 0' }}>
                  <span className="spinner" /> 正在读取影视资料…
                </div>
              ) : null}

              {results ? (
                results.length === 0 ? (
                  <p className="dim">没有找到匹配结果，换一个关键词试试。</p>
                ) : (
                  <div className="import-results">
                    {results.map((result) => (
                      <div className="import-item" key={`${result.mediaType}-${result.externalId}`}>
                        <div className="import-thumb">
                          {result.posterUrl ? (
                            <img src={result.posterUrl} alt="" loading="lazy" />
                          ) : (
                            <div className="collection-cover-placeholder" style={{ fontSize: 16 }}>
                              <Icon name="film" size={18} />
                            </div>
                          )}
                        </div>
                        <div className="import-main">
                          <div className="import-title">
                            {result.title}
                            {result.year ? (
                              <span className="dim" style={{ fontWeight: 400 }}>
                                {' '}
                                · {result.year}
                              </span>
                            ) : null}
                          </div>
                          <div className="import-meta">
                            {MEDIA_TYPE_LABEL[result.mediaType]}
                            {result.originalTitle && result.originalTitle !== result.title
                              ? ` · ${result.originalTitle}`
                              : ''}
                          </div>
                          {result.overview ? (
                            <p className="import-overview">{result.overview}</p>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => void chooseCandidate(result)}
                        >
                          选择
                        </button>
                      </div>
                    ))}
                  </div>
                )
              ) : null}
            </>
          ) : (
            <div className="form-grid cols-2">
              <Field label="标题" htmlFor="manual-title">
                <input
                  id="manual-title"
                  className="input"
                  value={manual.title}
                  onChange={(event) => setManual({ ...manual, title: event.target.value })}
                  autoFocus
                />
              </Field>
              <Field label="原始标题" htmlFor="manual-original" optional>
                <input
                  id="manual-original"
                  className="input"
                  value={manual.originalTitle}
                  onChange={(event) => setManual({ ...manual, originalTitle: event.target.value })}
                />
              </Field>
              <Field label="年份" htmlFor="manual-year" optional>
                <input
                  id="manual-year"
                  className="input"
                  inputMode="numeric"
                  value={manual.year}
                  onChange={(event) =>
                    setManual({ ...manual, year: event.target.value.replace(/[^\d]/g, '') })
                  }
                />
              </Field>
              <Field label="类型" htmlFor="manual-type">
                <select
                  id="manual-type"
                  className="select"
                  value={manual.mediaType}
                  onChange={(event) =>
                    setManual({ ...manual, mediaType: event.target.value as MediaType })
                  }
                >
                  <option value="movie">电影</option>
                  <option value="tv">剧集</option>
                </select>
              </Field>
              <div className="span-all">
                <Field label="简介" htmlFor="manual-overview" optional>
                  <textarea
                    id="manual-overview"
                    className="textarea"
                    value={manual.overview}
                    onChange={(event) => setManual({ ...manual, overview: event.target.value })}
                  />
                </Field>
              </div>
            </div>
          )}
        </>
      ) : null}

      {stage === 'confirm' && candidate ? (
        <>
          <div className="import-preview">
            <div className="import-preview-poster">
              {candidate.posterUrl ? (
                <img src={candidate.posterUrl} alt="" />
              ) : (
                <div className="collection-cover-placeholder">
                  <Icon name="film" size={22} />
                </div>
              )}
            </div>
            <div className="stack gap-2" style={{ minWidth: 0 }}>
              <h3 style={{ fontSize: 22, fontWeight: 600 }}>{candidate.title}</h3>
              {candidate.originalTitle && candidate.originalTitle !== candidate.title ? (
                <div className="serif" style={{ fontStyle: 'italic', color: 'var(--text-secondary)' }}>
                  {candidate.originalTitle}
                </div>
              ) : null}
              <div className="meta-row wrap">
                <span>{MEDIA_TYPE_LABEL[candidate.mediaType]}</span>
                {candidate.year ? <span className="meta-sep">{candidate.year}</span> : null}
                {candidate.runtime ? (
                  <span className="meta-sep">{candidate.runtime} 分钟</span>
                ) : null}
                {candidate.genres.length > 0 ? (
                  <span className="meta-sep">{candidate.genres.slice(0, 3).join(' / ')}</span>
                ) : null}
              </div>
              {candidate.overview ? (
                <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.7, maxHeight: 150, overflow: 'auto' }}>
                  {candidate.overview}
                </p>
              ) : (
                <p className="dim" style={{ fontSize: 13 }}>
                  TMDB 没有提供这部作品的简介。
                </p>
              )}
            </div>
          </div>

          <div className="form-grid cols-2">
            <div className="stack gap-2">
              <span className="field-label">个人评分</span>
              <RatingInput
                value={draft.personalRating}
                onChange={(value) => setDraft({ ...draft, personalRating: value })}
              />
            </div>
            <div className="stack gap-2">
              <span className="field-label">观看状态</span>
              <Segmented
                ariaLabel="观看状态"
                value={draft.watchStatus}
                onChange={(value) => setDraft({ ...draft, watchStatus: value })}
                options={WATCH_STATUS_OPTIONS}
              />
            </div>
            <div className="span-all">
              <Field label="收藏理由" htmlFor="import-reason" optional>
                <textarea
                  id="import-reason"
                  className="textarea"
                  style={{ minHeight: 72 }}
                  placeholder="为什么想把它放进收藏？"
                  value={draft.favoriteReason}
                  onChange={(event) => setDraft({ ...draft, favoriteReason: event.target.value })}
                />
              </Field>
            </div>
          </div>
        </>
      ) : null}

      {error && stage === 'confirm' ? <p className="field-error">{error}</p> : null}
    </Modal>
  );
}
