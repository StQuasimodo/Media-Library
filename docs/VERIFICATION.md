# 验证与交付

## 1. 命令

```powershell
pnpm typecheck              # tsc --noEmit
pnpm test                   # vitest run（8 文件 / 82 用例）
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
