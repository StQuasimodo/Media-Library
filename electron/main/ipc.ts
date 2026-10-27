import { app, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import type { AppSettings, EntryPatch, FilmPatch, LibraryQuery, MediaType, MetadataCandidate, MetadataSearchOptions, ResourceInput } from '../../src/shared/types';
import { AppError, toSerializedError } from './errors';
import type { AppRuntime } from './runtime';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { QuarkWebSession } from './services/quark/webSession';
import { validateHttpUrl } from '../../src/shared/validation';
import type { QuarkMatchQuery } from '../../src/shared/quarkSync';

type Handler = (...args: never[]) => unknown;

const MAX_CLIPBOARD_TEXT = 4096;
function trustedQuarkPage(event: IpcMainInvokeEvent) {
  try {
    const url=new URL(event.senderFrame?.url ?? '');
    const dev=process.env.VITE_DEV_SERVER_URL;
    return event.senderFrame===event.sender.mainFrame && (dev
      ? url.origin===new URL(dev).origin && url.pathname==='/'
      : url.protocol==='file:' && resolve(fileURLToPath(url))===resolve(join(__dirname,'..','dist','index.html')));
  } catch { return false; }
}

/**
 * Registers the full IPC surface. Every handler is wrapped so failures cross the
 * bridge as a stable `{ok:false,error}` envelope instead of an opaque string.
 */
export function registerIpc(runtime: AppRuntime): void {
  const refreshChannels = new Set(['library:refreshAll', 'library:refreshStatus', 'library:cancelRefresh']);
  const refreshConflicts = new Set([
    'data:restore', 'metadata:refresh', 'metadata:resolveSeries', 'metadata:saveKey', 'metadata:clearKey',
    'library:updateFilm', 'quark:chooseTool', 'quark:browse', 'quark:selectFolder', 'quark:scan',
  ]);
  const handle = <T>(channel: string, handler: (...args: any[]) => T | Promise<T>): void => {
    ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
      if (!runtime.ready) {
        return {
          ok: false,
          error: {
            code: 'INTERNAL',
            message: '数据库不可用，请重启应用。',
          },
        };
      }
      try {
        if (refreshChannels.has(channel) && !trustedQuarkPage(_event)) throw new AppError('VALIDATION', '页面无权刷新收藏及夸克信息。');
        if (refreshConflicts.has(channel)) runtime.refresh.assertIdle();
        const data = await handler(...(args as never[]));
        return { ok: true, data };
      } catch (error) {
        runtime.logger.error(`IPC ${channel} failed`, error);
        return { ok: false, error: toSerializedError(error) };
      }
    });
  };

  const assertString = (value: unknown, label: string): string => {
    if (typeof value !== 'string' || value.length === 0) {
      throw new AppError('VALIDATION', `${label}无效。`);
    }
    return value;
  };

  /* ------------------------------------------------------------ */
  /* App                                                           */
  /* ------------------------------------------------------------ */

  handle('app:info', () => {
    const metadataCredentialState = runtime.credentials.getState();
    return {
      appVersion: app.getVersion(),
      schemaVersion: runtime.schemaVersion,
      dataDirectory: runtime.paths.dataDirectory,
      backupsDirectory: runtime.paths.backupsDir,
      imagesDirectory: runtime.paths.imagesDir,
      hasMetadataApiKey: metadataCredentialState === 'configured',
      metadataCredentialState,
      settings: runtime.repo.getSettings(),
      platform: process.platform,
    };
  });

  handle('app:openExternal', async (url: unknown) => {
    const target = assertString(url, '链接');
    const validated = validateHttpUrl(target);
    if (!validated.ok) throw new AppError('VALIDATION', validated.message);
    await shell.openExternal(validated.value.toString());
  });

  handle('app:openFolder', async (kind: unknown) => {
    const mapping: Record<string, string> = {
      data: runtime.paths.dataDirectory,
      backups: runtime.paths.backupsDir,
      images: runtime.paths.imagesDir,
      logs: runtime.paths.logsDir,
    };
    const path = typeof kind === 'string' ? mapping[kind] : undefined;
    if (!path) throw new AppError('VALIDATION', '未知的目录。');
    const result = await shell.openPath(path);
    if (result) throw new AppError('INTERNAL', `无法打开目录：${result}`);
  });

  handle('app:relaunch', () => {
    app.relaunch();
    app.exit(0);
  });

  /* ------------------------------------------------------------ */
  /* Library                                                       */
  /* ------------------------------------------------------------ */

  handle('library:home', () => runtime.library.getHome());
  handle('library:refreshAll', () => runtime.refresh.start());
  handle('library:refreshStatus', () => runtime.refresh.status());
  handle('library:cancelRefresh', () => runtime.refresh.cancel());

  handle('library:stats', () => runtime.library.getStats());

  handle('library:list', (query: unknown) =>
    runtime.library.listEntries((query ?? {}) as LibraryQuery),
  );

  handle('library:years', () => runtime.library.listYears());

  handle('library:detail', (filmId: unknown) =>
    runtime.library.getFilmDetail(assertString(filmId, '作品 ID')),
  );

  handle('library:createManual', (input: unknown) => {
    const payload = (input ?? {}) as Record<string, unknown>;
    return runtime.library.createManualFilm({
      title: assertString(payload.title, '标题'),
      originalTitle: (payload.originalTitle as string | null) ?? null,
      year: (payload.year as number | null) ?? null,
      overview: (payload.overview as string | null) ?? null,
      mediaType: (payload.mediaType as MediaType) ?? 'movie',
      entry: (payload.entry ?? {}) as EntryPatch,
    });
  });

  handle('library:updateFilm', (filmId: unknown, patch: unknown) =>
    runtime.library.updateFilm(assertString(filmId, '作品 ID'), (patch ?? {}) as FilmPatch),
  );

  handle('library:updateEntry', (entryId: unknown, patch: unknown) =>
    runtime.library.updateEntry(assertString(entryId, '收藏 ID'), (patch ?? {}) as EntryPatch),
  );

  handle('library:removeFilm', (filmId: unknown) =>
    runtime.library.removeFilm(assertString(filmId, '作品 ID')),
  );

  handle('library:importCandidate', (candidate: unknown, entry: unknown) =>
    runtime.library.importCandidate(
      candidate as MetadataCandidate,
      (entry ?? {}) as EntryPatch,
    ),
  );

  /* ------------------------------------------------------------ */
  /* Collections                                                   */
  /* ------------------------------------------------------------ */

  handle('collections:list', () => runtime.library.listCollections());

  handle('collections:detail', (collectionId: unknown) =>
    runtime.library.getCollectionWithEntries(assertString(collectionId, '专题 ID')),
  );

  handle('collections:create', (input: unknown) => {
    const payload = (input ?? {}) as Record<string, unknown>;
    return runtime.library.createCollection({
      name: assertString(payload.name, '专题名称'),
      description: (payload.description as string | null) ?? null,
    });
  });

  handle('collections:update', (id: unknown, patch: unknown) => {
    const payload = (patch ?? {}) as Record<string, unknown>;
    return runtime.library.updateCollection(assertString(id, '专题 ID'), {
      ...(payload.name !== undefined ? { name: String(payload.name) } : {}),
      ...(payload.description !== undefined
        ? { description: payload.description as string | null }
        : {}),
    });
  });

  handle('collections:remove', (id: unknown) => {
    runtime.library.deleteCollection(assertString(id, '专题 ID'));
  });

  handle('collections:addFilm', (collectionId: unknown, entryId: unknown) => {
    const film = runtime.repo.getEntry(assertString(entryId, '收藏 ID'));
    if (!film) throw new AppError('NOT_FOUND', '收藏记录不存在。');
    return runtime.library.addFilmToCollection(
      assertString(collectionId, '专题 ID'),
      assertString(entryId, '收藏 ID'),
    );
  });

  handle('collections:removeFilm', (collectionId: unknown, entryId: unknown) =>
    runtime.library.removeFilmFromCollection(
      assertString(collectionId, '专题 ID'),
      assertString(entryId, '收藏 ID'),
    ),
  );

  handle('collections:reorder', (ids: unknown) => {
    if (!Array.isArray(ids)) throw new AppError('VALIDATION', '排序数据无效。');
    return runtime.library.reorderCollections(ids.map((id) => String(id)));
  });

  /* ------------------------------------------------------------ */
  /* Quark resources                                               */
  /* ------------------------------------------------------------ */

  handle('resources:list', (filmId: unknown) =>
    runtime.library.listResources(assertString(filmId, '作品 ID')),
  );

  const webQuark = new QuarkWebSession();
  runtime.quarkSync.bindReader({read:(id,signal)=>webQuark.readForSync(id,signal),folder:id=>webQuark.knownFolder(id),ready:()=>webQuark.assertSyncReady()});
  void runtime.quarkSync.readOnStartup();
  for (const action of ['status', 'connect', 'finishLogin', 'check', 'list', 'disconnect'] as const) {
    ipcMain.handle(`quark-web:${action}`, async (event, id: unknown) => {
      if (!trustedQuarkPage(event)) return { ok: false, error: { code: 'VALIDATION', message: '页面无权访问夸克连接。' } };
      try {
        if(action!=='status') runtime.refresh.assertIdle();
        if(action!=='status') runtime.quarkSync.assertIdle();
        if(action==='connect' && !webQuark.status().loginOpen) runtime.quarkSync.resetConnection();
        const data = action === 'list' ? await webQuark.list(assertString(id, '文件夹')) : await webQuark[action]();
        if(action==='disconnect') runtime.quarkSync.resetConnection();
        return { ok: true, data };
      } catch (error) { return { ok: false, error: toSerializedError(error) }; }
    });
  }
  const syncHandlers: Record<string,(...args: any[])=>unknown> = {
    status:()=>runtime.quarkSync.status(),
    configure:(id,autoRead,autoImport)=>runtime.quarkSync.configure(assertString(id,'文件夹'),autoRead,autoImport),
    scan:()=>runtime.quarkSync.start(), match:()=>runtime.quarkSync.startMatching(),
    search:(key,query)=>runtime.quarkSync.search(assertString(key,'资源分组'),query as QuarkMatchQuery),
    confirm:(key,id,type)=>runtime.quarkSync.confirm(assertString(key,'资源分组'),assertString(id,'影视资料'),type as MediaType),
    createManual:(key,query)=>runtime.quarkSync.createManual(assertString(key,'资源分组'),query as QuarkMatchQuery),
    confirmHigh:()=>runtime.quarkSync.confirmHigh(),
    linkExisting:(key,id)=>runtime.quarkSync.linkExisting(assertString(key,'资源分组'),assertString(id,'收藏作品')),
    ignore:(key,ignored)=>{
      if(typeof ignored!=='boolean') throw new AppError('VALIDATION','忽略设置无效。');
      return runtime.quarkSync.ignore(assertString(key,'资源分组'),ignored);
    },
    cancel:()=>{ if(runtime.refresh.busy) runtime.refresh.cancel(); else runtime.quarkSync.cancel(); },
  };
  for(const [action,handler] of Object.entries(syncHandlers)) ipcMain.handle(`quark-sync:${action}`,async(event,...args)=>{
    if(!trustedQuarkPage(event)) return {ok:false,error:{code:'VALIDATION',message:'页面无权访问夸克目录匹配。'}};
    try {
      if(action!=='status' && action!=='cancel') runtime.refresh.assertIdle();
      return {ok:true,data:await handler(...args)};
    }
    catch(error) { return {ok:false,error:toSerializedError(error)}; }
  });

  handle('quark:status', () => runtime.quark.status());
  handle('quark:chooseTool', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择已安装并授权的夸克官方工具', properties: ['openFile'],
      filters: [{ name: '夸克官方工具 quark-drive.cjs', extensions: ['cjs'] }],
    });
    return result.canceled || !result.filePaths[0] ? null : runtime.quark.setTool(result.filePaths[0]);
  });
  handle('quark:browse', (folderId: unknown) => runtime.quark.browse(assertString(folderId, '文件夹')));
  handle('quark:selectFolder', (folderId: unknown, recursive: unknown, autoRead: unknown) => {
    if (typeof recursive !== 'boolean' || typeof autoRead !== 'boolean') throw new AppError('VALIDATION', '读取设置无效。');
    return runtime.quark.selectFolder(assertString(folderId, '文件夹'), recursive, autoRead);
  });
  handle('quark:scan', () => runtime.quark.scan());
  handle('quark:cancel', () => { if(runtime.refresh.busy) runtime.refresh.cancel(); else runtime.quark.cancel(); });

  handle('resources:create', (input: unknown) =>
    runtime.library.createResource((input ?? {}) as ResourceInput),
  );

  handle('resources:update', (id: unknown, patch: unknown) =>
    runtime.library.updateResource(assertString(id, '资源 ID'), (patch ?? {}) as Partial<ResourceInput>),
  );

  handle('resources:remove', (id: unknown) => {
    runtime.library.deleteResource(assertString(id, '资源 ID'));
  });

  handle('resources:open', async (url: unknown) => {
    const validated = validateHttpUrl(assertString(url, '链接'));
    if (!validated.ok) throw new AppError('VALIDATION', validated.message);
    await shell.openExternal(validated.value.toString());
  });

  handle('resources:copy', async (text: unknown) => {
    if (typeof text !== 'string') throw new AppError('VALIDATION', '复制内容无效。');
    if (text.length > MAX_CLIPBOARD_TEXT) {
      throw new AppError('VALIDATION', '复制内容过长。');
    }
    await clipboard.writeText(text);
  });

  /* ------------------------------------------------------------ */
  /* Metadata                                                      */
  /* ------------------------------------------------------------ */

  handle('metadata:search', (options: unknown) =>
    runtime.metadata.search((options ?? {}) as MetadataSearchOptions),
  );

  handle('metadata:resolveSeries', () => runtime.metadata.resolveSeries());

  handle('metadata:seasons', (id: unknown) => runtime.metadata.seasons(assertString(id,'剧集 ID')));

  handle('metadata:candidate', (externalId: unknown, mediaType: unknown) =>
    runtime.metadata.getCandidate(assertString(externalId, '资料 ID'), mediaType as MediaType),
  );

  handle('metadata:refresh', (filmId: unknown) =>
    runtime.metadata.refreshFilm(assertString(filmId, '作品 ID')),
  );

  handle('metadata:verifyKey', async (key: unknown) => {
    await runtime.metadata.verifyApiKey(assertString(key, 'API Key'));
  });

  handle('metadata:saveKey', async (key: unknown) => {
    const value = assertString(key, 'API Key');
    await runtime.metadata.verifyApiKey(value);
    runtime.credentials.setKey(value);
    runtime.logger.registerSecret(value);
    runtime.logger.info('Metadata API key updated');
  });

  handle('metadata:clearKey', () => {
    runtime.credentials.setKey(null);
    runtime.logger.info('Metadata API key cleared');
  });

  /* ------------------------------------------------------------ */
  /* Settings                                                      */
  /* ------------------------------------------------------------ */

  const settingsState = () => {
    const metadataCredentialState = runtime.credentials.getState();
    return {
      settings: runtime.repo.getSettings(),
      hasMetadataApiKey: metadataCredentialState === 'configured',
      metadataCredentialState,
      dataDirectory: runtime.paths.dataDirectory,
      appVersion: app.getVersion(),
      schemaVersion: runtime.schemaVersion,
    };
  };

  handle('settings:get', () => settingsState());

  handle('settings:update', (patch: unknown) => {
    runtime.library.updateSettings((patch ?? {}) as Partial<AppSettings>);
    return settingsState();
  });

  /* ------------------------------------------------------------ */
  /* Backup / restore / export                                     */
  /* ------------------------------------------------------------ */

  handle('data:createBackup', () => runtime.backup.createBackup());

  handle('data:validateBackup', (path: unknown) =>
    runtime.backup.validateBackup(assertString(path, '备份路径')),
  );

  handle('data:chooseBackupFile', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择 My Cinema 备份文件',
      properties: ['openFile'],
      filters: [
        { name: 'My Cinema 数据库备份', extensions: ['db'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  handle('data:restore', (path: unknown) => {
    runtime.quarkSync.assertIdle();
    const result=runtime.backup.restore(assertString(path,'备份路径'));
    runtime.quarkSync.resetConnection();
    return result;
  });

  handle('data:exportJson', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择导出位置',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: runtime.paths.exportsDir,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return runtime.backup.exportJson(result.filePaths[0]);
  });
}

export type { Handler };
