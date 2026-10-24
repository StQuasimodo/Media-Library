# 此前 DSH 交付记录

[文档目录](README.md) · [当前验证状态](VERIFICATION.md)

以下表格记录此前交付，不代表当前工作区重跑结果。当前 Linux 云环境：82 个测试、完整构建及真实 Electron（无显示器诊断模式）检查通过，详见[本轮修复记录](REPAIRS-2026-10-24.md)。Windows 完整桌面与在线 TMDB 链路仍待验收。

| 检查项 | 结果 |
|---|---|
| `tsc --noEmit` | 通过（0 错误） |
| `vitest run` | 4 个文件 / **49 个用例全部通过** |
| `node scripts/build.mjs` | 通过，产出 `dist/` + `dist-electron/` |
| `electron-builder --win` | 通过，产出 `release/My-Cinema-1.0.0-Setup.exe` |
| 安装包内容 | 已确认包含渲染层、主进程/preload 与 better-sqlite3 的 win32-x64 原生二进制 |
| 界面截图 | 1440×900 全页面 + 聚焦切换 + 无图作品 + 空收藏 + 1280 / 1920 两档宽度 |
| Electron 窗口启动 | **未能验证**（环境限制，见下） |

界面截图清单（`artifacts/screenshots/`）：`01-home` · `01b-home-focus-3`（聚焦第 4 部，主视觉随之切换）· `02-library` · `03-film-detail` · `03b-detail-no-images`（无海报/背景图）· `04-collections` · `05-collection-detail` · `06-watchlist` · `07-settings` · `08-library-1280` · `08b-home-1280` · `09-library-1920` · `09b-home-1920` · `11-empty-home` · `12-empty-library` · `13-empty-home-1280`。

安装包尺寸、文件存在性与此前启动失败描述均为交接时的历史记录，不代表当前工作区的产物或运行状态。
