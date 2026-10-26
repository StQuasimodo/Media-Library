# 界面预览

[返回项目首页](../README.md) · [视觉规范](DESIGN.md)

## 1.2自动匹配（Windows）

以下来自1.2.0-beta.2构建源码的真实Windows Electron窗口，包含真实preload、SQLite与导入/缓存代码。目录和TMDB响应使用受控测试数据，不代表个人账号已验收。[原始报告](../artifacts/releases/v1.2.0-beta.2/quark-sync-desktop-report.json)。

| 页面或场景 | 截图 |
|---|---|
| 目录归并、规格识别与TMDB候选确认 | [查看](../artifacts/review-2026-10-26/beta2/15-quark-matches.png) |
| 作品关联文件、季集、画质编码与增量状态 | [查看](../artifacts/review-2026-10-26/beta2/16-quark-cloud-resources.png) |

## 沉浸浏览与字体

以下均来自最近一次字体加粗调整后的同一轮真实 Electron 检查（`desktop-smoke-iXIm7U`）。截图在 Linux 无显示器诊断模式下生成，使用独立测试数据与本地缓存图片；夸克为测试工具数据，不代表真实账号已接通，也不代替 Windows 字体与缩放验收。

| 页面或场景 | 截图 |
|---|---|
| 首页 | [查看](../artifacts/review-2026-10-24/current/01-home.png) |
| 焦点切换 | [查看](../artifacts/review-2026-10-24/current/02-home-focus.png) |
| 首屏之后 | [查看](../artifacts/review-2026-10-24/current/11-home-curation.png) |
| 1024 窗口 | [查看](../artifacts/review-2026-10-24/current/home-1024.png) |
| 影视库 | [查看](../artifacts/review-2026-10-24/current/03-library.png) |
| 影视详情 | [查看](../artifacts/review-2026-10-24/current/04-film.png) |
| 专题 | [查看](../artifacts/review-2026-10-24/current/05-collections.png) |
| 专题详情 | [查看](../artifacts/review-2026-10-24/current/06-collection.png) |
| 想看 | [查看](../artifacts/review-2026-10-24/current/12-watchlist.png) |
| 设置 | [查看](../artifacts/review-2026-10-24/current/13-settings.png) |
| 夸克文件夹 | [查看](../artifacts/review-2026-10-24/current/09-quark-folder.png) |
| 空收藏 | [查看](../artifacts/review-2026-10-24/current/10-home-empty.png) |

旧版截图保留在原目录用于历史对比；执行方式和范围见[验证说明](VERIFICATION.md)及[修复记录](REPAIRS-2026-10-24.md)。
