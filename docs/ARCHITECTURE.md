# 架构说明

## 1. 分层

```
渲染进程 (React)          ← 只做 UI 与交互状态，不碰 SQL / 不直接发外部请求
   │  window.cinema.*      由 preload 通过 contextBridge 暴露
   ▼
preload (contextBridge)   ← 唯一 IPC 出口，请求/响应信封
   ▼
主进程
   ├─ ipc.ts              白名单 handler，统一错误信封，参数校验入口
   ├─ runtime.ts          装配数据库与服务，可在恢复备份后整体重建
   ├─ services/           业务规则：library / metadata / backup / imageCache / credentials / logger
   ├─ data/               driver / migrations / database / repository / mappers
   └─ paths.ts             userData 目录布局
   ▼
SQLite (better-sqlite3)  +  图片缓存目录  +  日志
```

**约束**

- 渲染进程无 Node 能力：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- UI 组件不写 SQL、不拼 HTTP；外部网络（TMDB、图片下载）只在主进程发生，API Key 从不跨进程。
- 服务层不 import `electron`，因此可以在 Vitest 中直接测试（`tests/helpers.ts` 用真实数据库 + 临时目录）。

---

## 2. IPC 通道

所有通道返回 `{ ok: true, data }` 或 `{ ok: false, error: { code, message } }`；失败统一由 `toSerializedError` 转换，未知错误只回传用户可读文案，细节进日志。

| 分组 | 通道 |
|---|---|
| 应用 | `app:info` · `app:openExternal` · `app:openFolder` · `app:relaunch` |
| 收藏库 | `library:home` · `library:stats` · `library:list` · `library:years` · `library:detail` · `library:createManual` · `library:updateFilm` · `library:updateEntry` · `library:removeFilm` · `library:importCandidate` |
| 专题 | `collections:list` · `collections:detail` · `collections:create` · `collections:update` · `collections:remove` · `collections:addFilm` · `collections:removeFilm` · `collections:reorder` |
| 夸克资源 | `resources:list` · `resources:create` · `resources:update` · `resources:remove` · `resources:open` · `resources:copy` |
| 元数据 | `metadata:search` · `metadata:candidate` · `metadata:refresh` · `metadata:verifyKey` · `metadata:saveKey` · `metadata:clearKey` |
| 设置 | `settings:get` · `settings:update` |
| 数据 | `data:createBackup` · `data:validateBackup` · `data:chooseBackupFile` · `data:restore` · `data:exportJson` |

新增通道的三步：`src/shared/api.ts` 声明 → `electron/main/ipc.ts` 注册 → `electron/preload/index.ts` 桥接。三处缺一不可，且命名必须同构。

---

## 3. 数据库

### 3.1 表结构（schema v2）

| 表 | 关键列 | 约束 |
|---|---|---|
| `films` | id, title, original_title, year, overview, tagline, poster_path, backdrop_path, media_type, runtime, genres(JSON), original_language, metadata_source, external_id, metadata_updated_at, created_at, updated_at | `(metadata_source, external_id)` 部分唯一索引；`title`/`year` 索引 |
| `collection_entries` | id, film_id, personal_rating, watch_status, collected_at, watched_at, favorite_reason, personal_review, sort_order, created_at, updated_at | `film_id UNIQUE`；rating 0–10 CHECK；status 枚举 CHECK |
| `collections` | id, name, description, cover_path, sort_order, created_at, updated_at | `name` 大小写不敏感唯一 |
| `collection_films` | collection_id, collection_entry_id, sort_order, added_at | 复合主键；两侧外键 `ON DELETE CASCADE` |
| `media_resources` | id, film_id, provider, resource_name, share_url, access_code, quality_label, version_label, subtitle_label, audio_label, notes, availability_status, created_at, updated_at | `provider` CHECK 仅 `quark`；状态 CHECK；`film_id` 级联 |
| `app_settings` | key, value, updated_at | 主键 key |
| `schema_migrations` | version, name, applied_at | 主键 version |

**删除语义**

- 删作品 → 条目、专题关联、资源全部级联删除（UI 会明确告知条数与后果）。
- 删专题 → 只删专题与关联行。
- 删资源 → 只删该行。

### 3.2 迁移

- 迁移定义在 `electron/main/data/migrations.ts`，**只追加**，不修改已发布条目。
- 每个迁移在事务内执行并写入 `schema_migrations`；失败则整体回滚并抛 `MIGRATION_FAILED`。
- 打开时执行 `PRAGMA quick_check`；失败抛 `CORRUPT`，不删除文件。
- 数据库版本高于代码版本时抛 `NEWER_SCHEMA` 并拒绝打开。

### 3.3 连接

`SqlDatabase`（`data/driver.ts`）封装 better-sqlite3：`journal_mode=WAL`、`synchronous=NORMAL`、`foreign_keys=ON`、`busy_timeout=5000`。只读打开（备份校验）不发生 WAL 写入。

---

## 4. 业务规则落点

| 规则 | 实现 |
|---|---|
| 重复导入 | `library.importCandidate` 先查 `getFilmByExternal`，命中则复用并返回 `duplicate: true` |
| 个人数据隔离 | `applyExternalMetadata` 只写 films 的外部字段 |
| 评分 / 年份 / 链接校验 | `src/shared/validation.ts`，主进程与渲染进程共用 |
| URL 只允许 http/https | `validateHttpUrl`，`shell.openExternal` 前强制校验 |
| 图片路径穿越 | `ImageCache.resolveRelative` 只接受 `poster|backdrop/<2hex>/<40hex>.<ext>` 且必须落在缓存根内 |
| 提取码不出日志 | 创建/更新资源时 `logger.registerSecret`，日志写入前统一替换 |
| 恢复失败回滚 | `BackupService.restore` 先做 `pre-restore` 快照，失败用快照覆盖回去并重开数据库 |

---

## 5. 文件与目录

```
electron/main/
  index.ts        启动、单实例、窗口、mycinema:// 协议、导航防护
  ipc.ts          IPC 白名单
  runtime.ts      服务装配 / 重建
  windowState.ts  窗口几何记忆
  paths.ts        userData 布局
  data/           driver · migrations · database · repository · mappers
  services/       library · metadataService · metadata/tmdb · imageCache · backup · credentials · logger
electron/preload/index.ts
src/shared/       types · api · validation
src/renderer/
  App.tsx         路由与全局快捷键
  components/     AppShell · CommandPalette · ImportFilmDialog · FilmDialogs · FocusRail · HeroBackdrop · Track · CollectionCard · primitives · icons
  pages/          Home · Library · FilmDetail · Collections · CollectionDetail · Watchlist · Settings
  lib/            api · appState · format · motion · shortcuts · toast · useAsync
  styles/         tokens · base · components · pages
scripts/          build · dev · fetch-electron · make-icon · make-e2e-assets · ui-harness · run-ui-harness
tests/            library · persistence · metadata · security
```

### 运行时目录（`%APPDATA%\My Cinema`）

`library.db(-wal/-shm)` · `images/{poster,backdrop}/` · `backups/` · `exports/` · `logs/app.log` · `credentials.json` · `window-state.json`

---

## 6. 安全模型

| 面向 | 措施 |
|---|---|
| 进程隔离 | sandbox + contextIsolation + 无 nodeIntegration |
| 攻击面 | 仅白名单 IPC；渲染进程不能执行 shell、读写任意文件 |
| 外链 | 协议白名单 http/https；`setWindowOpenHandler` 一律 deny 后交给系统浏览器 |
| 资源加载 | 生产 CSP：`default-src 'self'`；图片仅 `self`/`data:`/`mycinema:`/`image.tmdb.org` |
| 凭据 | safeStorage(DPAPI) 加密；只在主进程解密；永不进导出与日志 |
| 日志 | 密钥、JWT、`pwd=`/`access_code=` 参数、已登记提取码统一 `[redacted]` |
| 数据 | 数据库/凭据/缓存均在 `.gitignore` 中 |

---

## 7. 扩展时的注意事项

1. **不要**给 IPC 加「通用执行」类通道（如 arbitrary shell / fs read）。
2. 新增外部 API 时先过 `validateHttpUrl`，并把超时、限流、鉴权失败映射成 `AppError` 的既定 code。
3. 数据库结构变更走新迁移；涉及删除列时先做「重建表 + 复制数据」并在事务内完成。
4. 增加图片类型时同时更新 `ImageCache` 的 MIME 映射、相对路径正则与协议处理。
5. 恢复备份会重建整个 `AppRuntime` 核心，新增的有状态服务必须挂在 `runtime.core` 上，否则恢复后会持有旧连接。
