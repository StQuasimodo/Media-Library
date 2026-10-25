# 验证与交付

## API Key 更新后状态排查（2026-10-25）

用户报告更新后需要重新配置 API；尚未确认本机是状态为未配置，还是仅输入框为空，也未确认其他收藏/设置是否保留。代码检查发现旧 `CredentialStore` 将缺失、解密失败、系统存储暂不可用都变成 null，并缓存到进程退出；这是已修复的独立问题，不能据此认定它就是用户本机的原因。

当前源码只缓存成功读取的密钥，区分 configured/missing/unavailable/unreadable，失败时保留原文件，可在设置中重试；导入界面的提示同步调整。已配置时明确说明密钥不回显、空输入框无需重填。数据目录、凭据版本1格式、safeStorage 和 SQLite schema 均未改变。

本地94项测试、类型检查、构建与真实 Electron 检查通过。[Windows流程](https://github.com/StQuasimodo/Media-Library/actions/runs/40188705823)的94项测试、真实 Electron 与加密跨进程验证也通过：使用稳定版 `48c306f` 的原始 CredentialStore 保存合成密钥，在另一个目录的新 Electron 外壳中读取并替换，再启动新进程复读。这里使用真实 Windows safeStorage 和隔离 profile；没有使用个人 API Key、登录 TMDB，也不等同于 NSIS 安装升级验收。此次未复现正常升级丢失密钥，用户本机旧配置是否可读取仍未确认。

[下载含修复的 Windows 集成预览版](https://github.com/StQuasimodo/Media-Library/actions/runs/40188705823/artifacts/12597288041)（安装包与免安装 ZIP，源码 `a630553`）。打包、包内容校验和上传均成功；未覆盖稳定版 Release。

证据：[范围记录](../artifacts/research-2026-10-25/credential-upgrade/summary.json)、[旧版写入](../artifacts/research-2026-10-25/credential-upgrade/report-write-old.json)、[新版读取并替换](../artifacts/research-2026-10-25/credential-upgrade/report-read-new.json)、[重启复读](../artifacts/research-2026-10-25/credential-upgrade/report-restart-new.json)、[真实桌面报告](../artifacts/research-2026-10-25/credential-upgrade/desktop-report.json)、[SHA-256](../artifacts/research-2026-10-25/credential-upgrade/SHA256SUMS.txt)。安装包 SHA-256 为 `c37a5209dcec4620d063c0b95277fc12edec0cd7e194a5b463b5f4961983ccc7`。

在 Windows 安装依赖后可复跑：`node scripts/check-credential-upgrade.mjs`。这会构建隔离测试外壳，报告只含检查阶段与布尔结果，不上传凭据或 Local State。

## 夸克应用内整合（2026-10-25）

源码已加入「设置 → 夸克网盘」的官方网页登录、目录连接检查、逐层浏览和断开本机会话。[Windows 集成预览流程](https://github.com/StQuasimodo/Media-Library/actions/runs/40187475255)的90项测试、类型检查、完整构建与真实 Electron/preload/SQLite 检查已通过；集成官方登录窗口可打开，匿名目录返回需要登录，远端页面无业务桥接与 Node require。源码为 `0b3b0e1`。Linux 的真实 Electron 界面检查也已通过，使用独立夹具和显式 headless/no-sandbox 诊断参数；Windows 检查未使用这些诊断参数。真实账号目录访问、实际会话重启、递归同步与 TMDB 自动入库未验证或未完成。

安装包、免安装 ZIP 与包内容校验均通过，[下载集成预览产物](https://github.com/StQuasimodo/Media-Library/actions/runs/40187475255/artifacts/12596621235)。[Windows 原始桌面报告](../artifacts/research-2026-10-25/windows-integrated-quark-desktop.json)、[交付范围记录](../artifacts/research-2026-10-25/integrated-preview.json)、[SHA-256](../artifacts/research-2026-10-25/integrated-preview-SHA256SUMS.txt)、[账号入口截图](../artifacts/review-2026-10-25/quark-integrated-windows.png)。安装包哈希为 `ba5f55e2035885e4ab11bea92f4a13498379d4d6ea79dc2c69058ee66b59c938`。这些预览产物没有覆盖稳定版 Release。

## Windows Release（2026-10-25）

[v1.0.0 已发布](https://github.com/StQuasimodo/Media-Library/releases/tag/v1.0.0)，构建来源为 `48c306f63ad6f8ea441355b564d812b5110964de`。[Windows 流程](https://github.com/StQuasimodo/Media-Library/actions/runs/40114969102)的日志确认：82项测试通过，完整构建、真实Electron/preload/SQLite检查与包内容验证通过；安装包与免安装ZIP上传完成。GitHub资产的SHA-256与发布的校验文件一致。

这证明Windows runner上的运行和打包链路，不代替个人电脑上的安装、字体/缩放与真实TMDB/夸克账号验收。安装包未签名。该稳定版没有应用内账号入口；上方的新入口属于后续源码与预览构建。

## 1. 命令

```powershell
pnpm typecheck              # tsc --noEmit
pnpm test                   # vitest run（当前9文件 / 94用例；稳定版为82用例）
pnpm build                  # 类型检查 + 主进程打包 + 渲染层构建
pnpm package                # 安装包 + 免安装 zip（自动处理 TMP / PATH / 镜像）
pnpm package:dir            # 只生成免安装目录 release/win-unpacked
pnpm ui:shots               # 无头渲染截图到 artifacts/screenshots（含 seeded 场景）
node scripts/run-ui-harness.mjs --empty   # 空收藏状态截图
powershell -File scripts/check-environment.ps1   # 临时目录 / 数据目录 / 构建链体检
```

前置：`pnpm install` 后若 Electron 二进制缺失，执行 `pnpm electron:fetch`（分块续传 + 镜像回退）。

打包不再需要手工设置环境变量：`scripts/package.mjs` 会把 `TMP`/`TEMP` 指到项目内 `.tmp`、把 `.tools` 加入 PATH（并处理 Windows 上 `PATH`/`Path` 大小写陷阱）、补齐 `ELECTRON_BUILDER_CACHE` 与镜像，然后调用 electron-builder，最后用 `Compress-Archive` 生成免安装 zip。

若 `github.com` 不可达（本机曾解析到 127.0.0.1），把 `electron-v45.0.0-win32-x64.zip` 放进 `.eb-cache/electron/`，或设置 `ELECTRON_MIRROR` + `ELECTRON_CUSTOM_DIR`。

---

## 2. 测试用例对应关系

| 需求 | 用例（`tests/`） |
|---|---|
| 收藏增删改 | `library.test.ts`：导入后读取详情、编辑个人字段、删除条目清理关联 |
| 元数据与个人数据隔离 | `library.test.ts`：刷新外部资料后评分/笔记/资源不变 |
| 专题增删改 | `library.test.ts`：创建、重命名、删除；同名拒绝 |
| 一作品多专题 | `library.test.ts`：同一 entry 加入两个专题，重复加入幂等 |
| 一作品多资源 | `library.test.ts`：两条资源、provider 均为 quark、状态默认未检查 |
| 删除资源不删作品 | `library.test.ts`：删除后详情与条目仍存在 |
| 重启后可读 | `persistence.test.ts`：关库重开后收藏、专题、资源、提取码仍在 |
| 备份 / 恢复 | `persistence.test.ts`：备份 → 新增数据 → 恢复 → 回到备份时状态；非法文件被拒且数据不变 |
| 重复导入 | `library.test.ts`：同一 TMDB id 第二次导入返回 `duplicate`，索引唯一 |
| 超时 / 无结果 | `metadata.test.ts`：TimeoutError → TIMEOUT；空结果 → `[]` 与 `NO_RESULTS` |
| 鉴权 / 限流 / 镜像回退 | `metadata.test.ts`：401、429、双域名回退、JWT 走 Authorization |
| 图片失败 | `library.test.ts` + `security.test.ts`：500 时导入成功并带警告；非图片类型被拒；同 URL 只下载一次 |
| 非法链接 | `security.test.ts`：`file:`、`javascript:`、`ftp:`、非 URL 均拒绝；`isQuarkHost` 防 `quark.cn.evil.com` |
| 密钥不入日志 | `security.test.ts`：API Key、提取码、JWT 在日志中被替换为 `[redacted]` |
| 搜索/筛选/排序 | `library.test.ts`：标题/原名/笔记搜索、年份/状态/专题筛选、年份与评分排序、`%` `_` 转义 |
| 路径穿越 | `security.test.ts`：`../`、绝对路径、非法哈希均返回 null |
| 损坏数据库 | `persistence.test.ts`：返回 `CORRUPT` 且文件未被改写 |

窗口缩放与视觉状态由截图验证（第 4 节），不属于单元测试范围。

---

## 3. 构建产物

| 产物 | 路径 | 大小 | SHA-256 |
|---|---|---|---|
| 安装包 | `release/My-Cinema-1.0.0-Setup.exe` | 115.59 MB | `8621E609…2E9B` |
| 免安装版 zip | `release/My-Cinema-1.0.0-portable-win64.zip` | 161.83 MB | `1B41B233…E209` |
| 免安装目录 | `release/win-unpacked/My Cinema.exe` | 383.7 MB / 139 文件 | — |
| 渲染层 | `dist/index.html` + `dist/assets/*` | 约 380 KB |
| 主进程 / preload | `dist-electron/main.cjs` / `preload.cjs` | 111 KB / 3 KB |
| 图标 | `build/icon.ico`（7 个尺寸） | — |

安装包内已核对：`dist` 资源哈希与本地构建一致；`app.asar.unpacked/node_modules/better-sqlite3/prebuilds/win32-x64.node` 存在。

---

## 4. 界面验证方式

本机无法创建 Electron 窗口（`BrowserWindow` 阶段以 `STATUS_BREAKPOINT` / `ACCESS_VIOLATION` 崩溃，`--no-sandbox`、`--disable-gpu`、`--single-process`、关闭硬件加速、offscreen 均无效；`electron --version` 以 Node 模式正常）。

因此界面验证使用 `scripts/ui-harness.ts`：

1. 用**真实**数据层与服务层（同一个 `openLibraryDatabase` / `LibraryService` / `ImageCache`）在临时目录建库并导入作品、专题、资源；
2. 通过 HTTP 提供**真实**的 `dist/` 产物，用极薄的 `window.cinema` 适配层替代 preload 传输；
3. 用无头 Edge（Chromium）在 1280 / 1440 / 1920 下截图。

与发行版的差异只有传输层；React 组件、CSS、业务规则完全一致。

### 截图清单（`artifacts/screenshots/`）

| 文件 | 验证内容 |
|---|---|
| `01-home` | 首页主视觉 + 聚焦轨道 |
| `01b-home-focus-3` | 聚焦第 4 部：背景、标题、简介、评分同步切换 |
| `02-library` | 影视库工具栏与 6 列网格 |
| `03-film-detail` | 详情页主视觉、操作收敛、分区排版 |
| `03b-detail-no-images` | 无海报/背景图时的占位与渐变主视觉 |
| `04-collections` | 专题卡片墙 |
| `05-collection-detail` | 专题内作品与移除操作 |
| `06-watchlist` | 想看队列与快速改状态 |
| `07-settings` | 设置四区块 |
| `08-library-1280` / `08b-home-1280` | 1280 宽度布局 |
| `09-library-1920` / `09b-home-1920` | 1920 宽度布局（主视觉铺满） |
| `11-empty-home` / `12-empty-library` / `13-empty-home-1280` | 空收藏状态 |

---

## 5. 当前验证结论

2026-10-24 Linux 云环境重新验证；此前 Windows 打包结果不视为本轮重新构建。真实 Electron 截图使用独立 SQLite 夹具、本地缓存图片和显式诊断参数，详见 [修复记录](REPAIRS-2026-10-24.md)。

| 检查 | 结果 |
|---|---|
| `tsc --noEmit` | 通过，0 错误 |
| `vitest run` | 82 / 82 通过 |
| `build.mjs` | 通过 |
| `electron-builder --win` | 本轮未执行；历史报告通过 |
| 安装包内容核对 | 本轮未执行；历史报告通过 |
| 截图巡检 | 当前真实 Electron 截图覆盖首页、影视库、详情、专题、想看及设置，含小窗口、空态和无图 |
| Electron 窗口启动 | Linux 无显示器诊断模式通过；Windows 交互桌面待验收 |
| TMDB 带 Key 的在线搜索 | **未验证**（无凭据） |
| 安装器静默安装 | **未验证**：本会话无交互桌面，`Setup.exe /S` 在初始化阶段不返回（已确认未写入注册表 / 开始菜单 / 安装目录，无残留）。免安装 zip 已核对结构完整（含 `My Cinema.exe`、`app.asar`、better-sqlite3 原生二进制） |

---

## 6. 已知限制

1. Linux 已运行真实 Electron BrowserWindow；Windows 安装后的交互桌面、字体与缩放仍需验收。
   - 若双击安装包报 `error writing temporary file`，是 NSIS 无法写入 `%TEMP%`：运行 `scripts/check-environment.ps1` 或改用免安装 zip。应用自身已把 Chromium 临时目录改到 `%APPDATA%\My Cinema\tmp`，不受该问题影响。
2. 没有可用 TMDB API Key：只验证了请求可达与 401 错误映射，未验证成功搜索。
3. 仅 Windows x64；无自动更新。
4. JSON 导出为单向归档，不支持回灌（恢复请用数据库备份）。
5. 安装包包含 better-sqlite3 的多平台预编译二进制（约 5 MB 冗余），不影响运行。
