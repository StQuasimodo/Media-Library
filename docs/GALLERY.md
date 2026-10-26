# 界面预览

[返回项目首页](../README.md) · [视觉规范](DESIGN.md)

## beta.2 rev4 展开菜单与分季背景

以下截图来自真实Windows Electron窗口，TMDB/目录为受控响应；海报为占位图片，蓝/橙背景为合成测试剧照，用于验证不同季不会复用背景，红色背景用于验证本季海报回退，不代表真实影视图片。[原始报告](../artifacts/releases/v1.2.0-beta.2/rev4/quark-sync-desktop-report.json)。

| 场景 | 截图 |
|---|---|
| 展开筛选菜单的深色主题 | [查看](../artifacts/review-2026-10-27/beta2-rev4/20-library-filter-menu.png) |
| 第一季的独立背景 | [查看](../artifacts/review-2026-10-27/beta2-rev4/21-season1-backdrop.png) |
| 第二季的独立背景 | [查看](../artifacts/review-2026-10-27/beta2-rev4/22-season2-backdrop.png) |
| 缺少本季剧照时回退本季海报 | [查看](../artifacts/review-2026-10-27/beta2-rev4/23-season-poster-fallback.png) |

## beta.2 rev3 系列分类

[查看系列筛选与1/2/10升序排列](../artifacts/review-2026-10-26/beta2-rev3/19-series-wall.png)。截图来自真实Windows Electron窗口，使用独立测试条目和占位海报，验证操作与排列；不代表个人账号或在线海报效果。[原始报告](../artifacts/releases/v1.2.0-beta.2/rev3/quark-sync-desktop-report.json)。

## beta.2 rev2 普通搜索选择季

真实Windows Electron窗口，使用受控《绝命毒师》季资料和测试图片，包含真实preload、SQLite和导入逻辑；不是个人账号或在线海报验收。[原始报告](../artifacts/releases/v1.2.0-beta.2/rev2/quark-sync-desktop-report.json)。

| 场景 | 截图 |
|---|---|
| 整剧搜索后选择季、特别篇和手动补季入口 | [查看](../artifacts/review-2026-10-26/beta2-rev2/17-tmdb-season-picker.png) |
| 单季与批量导入后的已收藏标记 | [查看](../artifacts/review-2026-10-26/beta2-rev2/18-tmdb-seasons-collected.png) |

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
