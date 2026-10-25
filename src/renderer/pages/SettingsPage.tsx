import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { AppSettings, LibrarySort, MetadataLanguage, MotionPreference, PosterDensity } from '@shared/types';
import type { BackupValidation } from '@shared/api';
import { api, describeError } from '../lib/api';
import { useAppState } from '../lib/appState';
import { useToast } from '../lib/toast';
import { ConfirmDialog, Field } from '../components/primitives';
import { Icon } from '../components/icons';
import { QuarkWebPanel } from '../components/QuarkWebPanel';
import { PageHeading } from '../components/PageHeading';
import { formatBytes, formatDateTime } from '../lib/format';
import { prefersReducedMotion } from '../lib/motion';

export function SettingsPage() {
  const location = useLocation();
  useEffect(() => {
    const section = location.hash.slice(1);
    if (['metadata', 'quark', 'appearance', 'data', 'about'].includes(section)) {
      document.getElementById(section)?.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'instant' : 'smooth' });
    }
  }, [location.hash]);
  const { info, settings, applySettings, invalidate, refreshInfo } = useAppState();
  const toast = useToast();

  const [apiKey, setApiKey] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<{ path: string; validation: BackupValidation } | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [lastExport, setLastExport] = useState<string | null>(null);

  const hasKey = info?.hasMetadataApiKey ?? false;

  const updateSetting = async (patch: Partial<AppSettings>) => {
    try {
      const next = await api.settings.update(patch);
      applySettings(next.settings);
      invalidate();
    } catch (cause) {
      toast.error(describeError(cause));
    }
  };

  const saveKey = async () => {
    setKeyBusy(true);
    setKeyError(null);
    try {
      await api.metadata.saveKey(apiKey.trim());
      setApiKey('');
      await refreshInfo();
      invalidate();
      toast.success('API Key 已验证并加密保存');
    } catch (cause) {
      setKeyError(describeError(cause));
    } finally {
      setKeyBusy(false);
    }
  };

  const clearKey = async () => {
    try {
      await api.metadata.clearKey();
      await refreshInfo();
      toast.push('已清除 API Key');
    } catch (cause) {
      toast.error(describeError(cause));
    }
  };

  const createBackup = async () => {
    setBackupBusy(true);
    try {
      const result = await api.data.createBackup();
      setLastBackup(`${result.path}（${formatBytes(result.bytes)}，${formatDateTime(result.createdAt)}）`);
      toast.success('备份已创建');
    } catch (cause) {
      toast.error(describeError(cause));
    } finally {
      setBackupBusy(false);
    }
  };

  const chooseRestore = async () => {
    try {
      const path = await api.data.chooseBackupFile();
      if (!path) return;
      const validation = await api.data.validateBackup(path);
      if (!validation.ok) {
        toast.error(validation.reason ?? '备份文件不可用。');
        return;
      }
      setPendingRestore({ path, validation });
    } catch (cause) {
      toast.error(describeError(cause));
    }
  };

  const doRestore = async () => {
    if (!pendingRestore) return;
    setRestoreBusy(true);
    try {
      const result = await api.data.restore(pendingRestore.path);
      setPendingRestore(null);
      invalidate();
      await refreshInfo();
      toast.success(
        result.backupOfPrevious
          ? '数据已恢复，恢复前的数据库已另存为备份'
          : '数据已恢复',
      );
    } catch (cause) {
      toast.error(describeError(cause));
      setPendingRestore(null);
    } finally {
      setRestoreBusy(false);
    }
  };

  const exportJson = async () => {
    try {
      const result = await api.data.exportJson();
      if (!result) return;
      setLastExport(`${result.path}（${formatBytes(result.bytes)}）`);
      toast.success(
        result.includesSensitiveData
          ? '已导出 JSON，其中包含分享链接与提取码，请妥善保管'
          : '已导出 JSON',
      );
    } catch (cause) {
      toast.error(describeError(cause));
    }
  };

  const openFolder = async (kind: 'data' | 'backups' | 'logs' | 'images') => {
    try {
      await api.app.openFolder(kind);
    } catch (cause) {
      toast.error(describeError(cause));
    }
  };

  const openExternal = async (url: string) => {
    try {
      await api.app.openExternal(url);
    } catch (cause) {
      toast.error(describeError(cause));
    }
  };

  return (
    <>
    <PageHeading title="放映室设置" eyebrow="THE STUDIO" description="元数据、夸克目录与本机收藏。" />
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="设置分类">
        <Link to="/settings#metadata">影视元数据</Link>
        <Link to="/settings#quark">夸克文件夹</Link>
        <Link to="/settings#appearance">外观与行为</Link>
        <Link to="/settings#data">数据与备份</Link>
        <Link to="/settings#about">关于</Link>
      </nav>

      <div>
        <section className="section-card" id="metadata">
          <div className="section-card-head">
            <h2 className="section-card-title">影视元数据</h2>
            <p className="section-card-desc">
              使用 TMDB 官方 API 搜索影视资料。API Key 会通过 Windows 凭据保护加密后保存在本机，
              不会写入数据库、导出文件或日志。
            </p>
          </div>

          <div className="setting-row">
            <div className="setting-label">
              <div className="setting-name">
                API Key{' '}
                <span className={`chip ${hasKey ? 'is-active' : ''}`} style={{ marginLeft: 6 }}>
                  {hasKey ? '已配置' : '未配置'}
                </span>
              </div>
              <div className="setting-help">
                在 TMDB 账号设置中免费申请 API Key（v3 Key 或 v4 读取令牌均可）。
                {hasKey ? ' 当前已保存一个 Key，可以随时替换或清除。' : ''}
              </div>
            </div>
          </div>

          <div className="form-grid cols-2" style={{ marginBottom: 12 }}>
            <Field
              label={hasKey ? '替换 API Key' : 'API Key'}
              htmlFor="settings-apikey"
              error={keyError}
              hint="保存前会真实请求一次 TMDB 进行验证"
            >
              <input
                id="settings-apikey"
                className="input"
                type="password"
                autoComplete="off"
                placeholder={hasKey ? '输入新的 Key 以替换' : '粘贴你的 TMDB API Key'}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </Field>
            <div className="row gap-2" style={{ alignItems: 'flex-end', paddingBottom: 2 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={saveKey}
                disabled={keyBusy || apiKey.trim().length < 8}
              >
                {keyBusy ? <span className="spinner" /> : <Icon name="check" size={15} />}
                保存并验证
              </button>
              {hasKey ? (
                <button type="button" className="btn btn-ghost" onClick={clearKey}>
                  清除 Key
                </button>
              ) : null}
            </div>
          </div>

          <div className="row gap-2 wrap">
            <button
              type="button"
              className="link-button"
              onClick={() => void openExternal('https://www.themoviedb.org/settings/api')}
            >
              <Icon name="external" size={12} /> 打开 TMDB API 设置页
            </button>
          </div>

          <div className="setting-row" style={{ marginTop: 8 }}>
            <div className="setting-label">
              <div className="setting-name">元数据语言</div>
              <div className="setting-help">影响 TMDB 搜索与导入时使用的标题、简介语言。</div>
            </div>
            <div className="setting-control">
              <select
                className="select"
                style={{ width: 160 }}
                value={settings.metadataLanguage}
                onChange={(event) =>
                  void updateSetting({ metadataLanguage: event.target.value as MetadataLanguage })
                }
                aria-label="元数据语言"
              >
                <option value="zh-CN">简体中文</option>
                <option value="en-US">English</option>
              </select>
            </div>
          </div>
        </section>

        <QuarkWebPanel />

        <section className="section-card" id="appearance">
          <div className="section-card-head">
            <h2 className="section-card-title">外观与行为</h2>
            <p className="section-card-desc">只提供真正生效的设置项。</p>
          </div>

          <div className="setting-row">
            <div className="setting-label">
              <div className="setting-name">海报密度</div>
              <div className="setting-help">紧凑模式在同一屏展示更多收藏。</div>
            </div>
            <div className="setting-control">
              <select
                className="select"
                style={{ width: 140 }}
                value={settings.posterDensity}
                onChange={(event) =>
                  void updateSetting({ posterDensity: event.target.value as PosterDensity })
                }
                aria-label="海报密度"
              >
                <option value="comfortable">舒适</option>
                <option value="compact">紧凑</option>
              </select>
            </div>
          </div>

          <div className="setting-row">
            <div className="setting-label">
              <div className="setting-name">动效</div>
              <div className="setting-help">
                默认跟随系统的「减少动态效果」设置；也可以在此强制开启或减少。
              </div>
            </div>
            <div className="setting-control">
              <select
                className="select"
                style={{ width: 160 }}
                value={settings.motionPreference}
                onChange={(event) =>
                  void updateSetting({ motionPreference: event.target.value as MotionPreference })
                }
                aria-label="动效偏好"
              >
                <option value="system">跟随系统</option>
                <option value="reduce">减少动效</option>
                <option value="full">完整动效</option>
              </select>
            </div>
          </div>

          <div className="setting-row">
            <div className="setting-label">
              <div className="setting-name">默认排序</div>
              <div className="setting-help">打开影视库时使用的默认排序方式。</div>
            </div>
            <div className="setting-control">
              <select
                className="select"
                style={{ width: 150 }}
                value={settings.defaultSort}
                onChange={(event) =>
                  void updateSetting({ defaultSort: event.target.value as LibrarySort })
                }
                aria-label="默认排序"
              >
                <option value="collected_desc">最近收藏</option>
                <option value="collected_asc">最早收藏</option>
                <option value="title_asc">标题 A→Z</option>
                <option value="title_desc">标题 Z→A</option>
                <option value="year_desc">年份新→旧</option>
                <option value="year_asc">年份旧→新</option>
                <option value="rating_desc">评分高→低</option>
              </select>
            </div>
          </div>
        </section>

        <section className="section-card" id="data">
          <div className="section-card-head">
            <h2 className="section-card-title">数据与备份</h2>
            <p className="section-card-desc">
              数据库、图片缓存和备份都保存在本机的应用数据目录中。卸载应用不会自动删除这些数据。
            </p>
          </div>

          <div className="setting-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <div className="setting-name" style={{ marginBottom: 8 }}>
              数据目录
            </div>
            <div className="path-box">
              <span style={{ flex: 1 }}>{info?.dataDirectory ?? '—'}</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void openFolder('data')}>
                打开
              </button>
            </div>
            <div className="row gap-3 wrap" style={{ marginTop: 10 }}>
              <button type="button" className="link-button" onClick={() => void openFolder('backups')}>
                打开备份目录
              </button>
              <button type="button" className="link-button" onClick={() => void openFolder('images')}>
                打开图片缓存目录
              </button>
              <button type="button" className="link-button" onClick={() => void openFolder('logs')}>
                打开日志目录
              </button>
            </div>
          </div>

          <div className="setting-row">
            <div className="setting-label">
              <div className="setting-name">备份数据库</div>
              <div className="setting-help">
                生成一份完整的数据库快照（影视资料、收藏、专题、夸克资源与应用设置）。图片缓存不包含在内，可随时重新获取。
              </div>
              {lastBackup ? <div className="field-hint" style={{ marginTop: 6 }}>{lastBackup}</div> : null}
            </div>
            <div className="setting-control">
              <button type="button" className="btn btn-secondary" onClick={createBackup} disabled={backupBusy}>
                {backupBusy ? <span className="spinner" /> : <Icon name="download" size={15} />}
                立即备份
              </button>
            </div>
          </div>

          <div className="setting-row">
            <div className="setting-label">
              <div className="setting-name">从备份恢复</div>
              <div className="setting-help">
                恢复会覆盖当前数据库。操作前会自动把当前数据另存为一份「pre-restore」备份，
                若恢复失败会自动回滚。
              </div>
            </div>
            <div className="setting-control">
              <button type="button" className="btn btn-secondary" onClick={chooseRestore}>
                <Icon name="upload" size={15} />
                选择备份文件
              </button>
            </div>
          </div>

          <div className="setting-row">
            <div className="setting-label">
              <div className="setting-name">导出 JSON</div>
              <div className="setting-help">
                导出结构清晰、可长期保存的 JSON。若包含夸克分享链接或提取码，文件即为敏感文件，请妥善保管。
              </div>
              {lastExport ? <div className="field-hint" style={{ marginTop: 6 }}>{lastExport}</div> : null}
            </div>
            <div className="setting-control">
              <button type="button" className="btn btn-secondary" onClick={exportJson}>
                <Icon name="database" size={15} />
                导出 JSON
              </button>
            </div>
          </div>
        </section>

        <section className="section-card" id="about">
          <div className="section-card-head">
            <h2 className="section-card-title">关于</h2>
            <p className="section-card-desc">
              My Cinema 是仅供个人使用的本地影视收藏库，不包含播放器、下载器或网盘登录功能。
            </p>
          </div>

          <dl className="kv" style={{ marginBottom: 16 }}>
            <dt>版本</dt>
            <dd>{info?.appVersion ?? '—'}</dd>
            <dt>数据库版本</dt>
            <dd>{info?.schemaVersion ?? '—'}</dd>
            <dt>图片缓存</dt>
            <dd>{info?.imagesDirectory ?? '—'}</dd>
          </dl>

          <div className="eyebrow" style={{ marginBottom: 8 }}>
            快捷键
          </div>
          <div className="shortcut-table">
            <span className="kbd">Ctrl K</span>
            <span>打开全局搜索</span>
            <span className="kbd">Ctrl F</span>
            <span>跳到影视库并聚焦搜索框</span>
            <span className="kbd">Ctrl I</span>
            <span>添加影视作品</span>
            <span className="kbd">Esc</span>
            <span>关闭弹窗或搜索面板</span>
          </div>

          <p className="field-hint" style={{ marginTop: 18 }}>
            影视资料与图片来自{' '}
            <button
              type="button"
              className="link-button"
              onClick={() => void openExternal('https://www.themoviedb.org/')}
            >
              TMDB
            </button>
            。本产品使用 TMDB API，但未获得 TMDB 的认可或认证。
          </p>
        </section>
      </div>

      <ConfirmDialog
        open={pendingRestore !== null}
        title="确认恢复数据"
        confirmLabel="覆盖并恢复"
        danger
        busy={restoreBusy}
        onConfirm={() => void doRestore()}
        onCancel={() => setPendingRestore(null)}
        message={
          <>
            <p>即将使用备份覆盖当前数据库：</p>
            <p className="dim" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              {pendingRestore?.path}
            </p>
            <p>备份的数据库版本：{pendingRestore?.validation.schemaVersion ?? '—'}</p>
            <p>当前数据会先自动另存为「pre-restore」备份，恢复失败时会自动回滚。</p>
          </>
        }
      />
    </div>
    </>
  );
}
