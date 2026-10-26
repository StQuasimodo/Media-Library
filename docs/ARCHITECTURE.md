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
| 夸克网页登录 | `quark-web:status` · `quark-web:connect` · `quark-web:finishLogin` · `quark-web:check` · `quark-web:list` · `quark-web:disconnect` |
| 夸克只读目录 | `quark:status` · `quark:chooseTool` · `quark:browse` · `quark:selectFolder` · `quark:scan` · `quark:cancel` |
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

## 夸克目录读取（2026-10-24）

`services/quark/provider.ts` 只调用已选工具的 `browse --parent-fid ... --all`，以参数数组启动子进程，不通过shell。解析完整Artifact，限制结果文件在本次工作目录的browse目录内，并校验返回条目范围。

`services/quark/library.ts` 保存选定源与可重建清单，负责递归、去重、取消和上限；`filename.ts` 生成保守的识别线索。服务不下载视频、不调用云端写命令，不读取官方工具凭据文件。

源配置位于userData/quark-source.json，清单位于quark-inventory.json，查询工作目录会清理。它们不修改SQLite schema，不进入个人收藏数据；数据库备份不包含这份可重建清单。凭据仍由官方工具独立管理。后续实际入库需要稳定的云端文件身份及关联设计，不能把临时下载地址或文件名当成主键。


## 夸克网页登录整合（2026-10-25）

`services/quark/webSession.ts` 管理专用 Chromium Session `persist:mycinema-quark-web` 与远端登录窗口，`webProtocol.ts` 负责固定只读请求目标、分页完整性与响应校验。新 IPC 仅接受应用主页面的顶层 frame；远端官方网页启用 sandbox/contextIsolation，禁用 Node，未加载业务 preload，顶层导航/弹窗限制为 HTTPS 夸克域名。

会话由 Chromium 保存在 userData 的专用 partition 内，退出前刷新 Cookie 存储；不读取日常浏览器、不把 Cookie/Token 传给渲染层。断开清除该 partition，不删除收藏或网盘文件。当前只读浏览不写入 SQLite，不自动关联 TMDB；实际账号与真实重启验收仍待完成。旧 CLI 桥接继续独立保留。独立诊断工具复用正式目录协议，使用另一套会话存储。


## TMDB 凭据读取状态（2026-10-25）

凭据文件继续使用原有版本1格式与 Electron safeStorage，不迁移目录、不改数据库。`CredentialStore.getState()` 区分 configured/missing/unavailable/unreadable；仅缓存成功读取的密钥，暂时不可用、解密失败或文件缺失可在同一进程重试，不覆盖旧文件。`app:info` 和 `settings:get` 返回无密钥的状态字段，设置与导入界面不再把解密失败描述为未配置。输入框不会回显已保存密钥。

Windows 预览流程还运行 `scripts/check-credential-upgrade.mjs`：用稳定版原始 CredentialStore 与真实 safeStorage 写入合成测试值，再从另一个安装目录的新 Electron 外壳读取、替换，最后新进程重读。测试使用隔离 profile，不登录 TMDB、不接触个人配置；这不是安装器升级验收，也无法诊断用户本机是否丢失 Local State 或改换 Windows 账户。


## 目录匹配与资源规格（1.2预览 / schema v3）

`QuarkSync` 接受专用网页会话的只读目录适配器，主进程管理任务、取消与进度，设置页通过 `quark-sync:status/configure/scan/match/search/confirm/confirmHigh/linkExisting/ignore/cancel` 调用。新通道与夸克网页登录一样限制为本地应用顶层frame，远端无业务preload。测试fixture只在桌面测试脚本中替换HTTP边界，不进入正式主进程。

数据库增量新增 `quark_sync_source`、`quark_cloud_files`、`quark_match_choices`。源配置保存目录与自动选项；文件以连接批次scope+真实FID为主键，记录路径、季集、大小、规格、作品ID和上次完整读取状态；确认/忽略决策持久化。scope是本地随机连接标识，不是夸克账号UID或访问令牌。重新登录/断开/恢复会隔离范围，网页登录窗口打开时拒绝同步，避免切换账号过程与关联写入交错。

所有目录成功后才原子替换清单；未找到仅标记，不删除收藏。匹配按片名/年份/类型归组，先复用已确认关联，再查询未知组；同组原关联矛盾时强制人工确认。高置信仅指返回候选中的名称/原名、年份一致且唯一，用户可选择自动导入，默认关闭。手动映射支持已有收藏；元数据和图片沿用现有服务，不覆盖个人字段。

v3同时修正TMDB唯一索引为 `(metadata_source,media_type,external_id)`，避免电影与电视剧数值ID冲突；并在异步图片缓存结束后重新检查重复与取消，防止并发重复和取消后提交。旧v2数据升级前用 `VACUUM INTO` 自动保存一致快照，迁移保留原表和个人字段。旧版不支持打开v3；回退应保留新库后使用v2快照。

规格解析独立于TMDB：文件名优先，按字段回退最近父目录，保留未知；大小取真实目录响应的安全整数。`resourceInfo.ts`提取分辨率、片源、编码器/编码、位深、HDR、音频/声道、语言/字幕、版本、帧率与显式码率，明确不探测视频流。规格与关联进入SQLite备份及JSON归档，后者标记私人资源信息。

正式窗口不设原生应用菜单；开发模式保留开发菜单。NSIS自定义选项页独立控制桌面快捷方式，注册表保存偏好，禁用builder无条件创建；开始菜单保留。应用图标由用户指定原图转换，PNG/ICO随应用打包，Windows AppUserModelID与builder保持一致。实际Windows UI、键盘和安装器验证以交付记录为准。

### 1.2.0-beta.2 分季身份

TMDB整剧继续用数字external_id；季条目使用`<seriesId>:season:<N>`，由shared/tmdbIdentity统一校验，仅允许tv类型。沿用schema v3已有文本字段与唯一索引，不需迁移。Provider将该身份路由到`/tv/{id}/season/{N}`并继承整剧背景与类型；刷新走相同路由。目录group_key在存在季号时纳入季号，电影/无季号分组身份稳定；旧文件关联、编辑查询和忽略选择保留。新增`quark-sync:createManual`复用可信页面IPC校验，手动建档与文件关联在同一SQLite事务完成。

### beta.2 rev2 普通搜索分季导入

新增只读`metadata:seasons(seriesId)`，主进程校验整剧数字ID，从整剧详情的seasons字段读取摘要，并按已有季身份标记collectedFilmId。renderer SeasonPicker负责季列表、单季确认与顺序批量导入，复用metadata:candidate和library:importCandidate；与夸克路径使用同一个季详情Provider和唯一身份。批次失败保留完成项，剩余项可重试。独立手动补录复用已有手动表单，不新增数据库关系或修改schema。

### beta.2 rev3 系列分类

Schema v4新增films.series_json可空列。SQL NULL代表未知，JSON null代表已查询而无官方系列，对象保存key/title/order；电影Provider从belongs_to_collection与collection.parts获取系列和首映顺序。Film/MetadataCandidate包含可选series。metadata:resolveSeries后台最多双并发补旧电影，不改作品/个人字段，每会话避免重复失败请求；Runtime关闭时dispose旧MetadataService以禁止恢复后异步落库。手动编辑的manual:系列在外部刷新时保留。

shared/series统一识别整剧身份、明确标题序号与官方系列。组锚点沿用当前列表排序，组内按序号升序。影视库提供系列筛选与默认开启的聚合开关，专题详情复用聚合函数。数据会进入原有SQLite备份和JSON导出。

手动编辑保留同名既有系列身份，仅修改序号时不会拆出原系列；series.customOrder标记手动顺序，刷新外部资料不覆盖它。手工关联不作为推断其他同名作品的依据，避免重分类带动无关条目。
