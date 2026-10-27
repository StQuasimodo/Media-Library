# 界面预览

[返回项目首页](../README.md) · [视觉规范](DESIGN.md)

## beta.3 / TV alpha.3 选图修复

Windows与电视端改为高清横版图库，不再取本季首张单集剧照。以下是真实原生窗口截图，图片和图库响应为合成测试数据，用于验证选图、缓存及界面联动；真实账号资料与最终构图仍须独立验收。[选图规则](ARTWORK.md)。

| 场景 | 截图 |
|---|---|
| Windows第一季的横版图库变体 | [查看](../artifacts/review-2026-10-27/beta3/21-season1-backdrop.png) |
| Windows第二季的另一张图库变体 | [查看](../artifacts/review-2026-10-27/beta3/22-season2-backdrop.png) |
| Windows图库无合适横版时回退合规季海报 | [查看](../artifacts/review-2026-10-27/beta3/23-season-poster-fallback.png) |
| TV原生导入后的详情 | [查看](../artifacts/review-2026-10-27/tv-alpha3/r03-imported-detail.png) |
| TV勾选季后的焦点保留 | [查看](../artifacts/review-2026-10-27/tv-alpha3/r04-season-selection.png) |
| TV进程重开后的本地浏览 | [查看](../artifacts/review-2026-10-27/tv-alpha3/r09-process-restart.png) |

另查阅了[《绝命毒师》公开横版图库](https://www.themoviedb.org/tv/1396-breaking-bad/images/backdrops)；[背景候选示例](https://image.tmdb.org/t/p/w1280/84XPpjGvxNyExjSuLQe0SzioErt.jpg)是TMDB公开图片，不是应用截图，也不代表已通过真实Key在线导入。[三张公开图片核对记录](../artifacts/review-2026-10-27/beta3/public-artwork-check.json)。

## Android TV 0.1.0-alpha.2

以下为真实API22原生Activity操作截图，720p/96MiB和1080p/64MiB应用堆配置均通过；RAM均1GiB。合成收藏、海报、背景及凭据只用于隔离测试，不包含用户电视照片或真实账号数据。[完整验证报告](TV-VALIDATION-2026-10-27.md)。

| 场景 | 720p / 96MiB | 1080p / 64MiB |
|---|---|---|
| 配置验证与加密保存后 | [查看](../artifacts/review-2026-10-27/tv-alpha2/720p-96m/r01-configured.png) | [查看](../artifacts/review-2026-10-27/tv-alpha2/1080p-64m/r01-configured.png) |
| 搜索后的季选择 | [查看](../artifacts/review-2026-10-27/tv-alpha2/720p-96m/r02-season-picker.png) | [查看](../artifacts/review-2026-10-27/tv-alpha2/1080p-64m/r02-season-picker.png) |
| 单季导入后的详情 | [查看](../artifacts/review-2026-10-27/tv-alpha2/720p-96m/r03-imported-detail.png) | [查看](../artifacts/review-2026-10-27/tv-alpha2/1080p-64m/r03-imported-detail.png) |
| 勾选季后的焦点 | [查看](../artifacts/review-2026-10-27/tv-alpha2/720p-96m/r04-season-selection.png) | [查看](../artifacts/review-2026-10-27/tv-alpha2/1080p-64m/r04-season-selection.png) |
| 504条收藏海报墙滚动 | [查看](../artifacts/review-2026-10-27/tv-alpha2/720p-96m/r08-stress-wall.png) | [查看](../artifacts/review-2026-10-27/tv-alpha2/1080p-64m/r08-stress-wall.png) |
| 杀进程重开后本地浏览 | [查看](../artifacts/review-2026-10-27/tv-alpha2/720p-96m/r09-process-restart.png) | [查看](../artifacts/review-2026-10-27/tv-alpha2/1080p-64m/r09-process-restart.png) |
| 模拟器内核重启后 | [查看](../artifacts/review-2026-10-27/tv-alpha2/720p-96m/r10-device-reboot.png) | [查看](../artifacts/review-2026-10-27/tv-alpha2/1080p-64m/r10-device-reboot.png) |

## Android TV 0.1.0-alpha.1

以下为API22 Android模拟器中的真实原生Activity截图，含遥控器操作后的焦点状态；使用受控收藏、占位海报与合成蓝/橙背景，不代表真实账号或影视图片。[检查报告](../artifacts/releases/tv-v0.1.0-alpha.1/emulator-report.json)。这些数据只在独立测试APK中，交付的应用初始为空收藏。

| 场景 | 截图 |
|---|---|
| 首次启动为空收藏 | [查看](../artifacts/review-2026-10-27/tv-alpha1/01-empty.png) |
| 首页主视觉与横向海报轨 | [查看](../artifacts/review-2026-10-27/tv-alpha1/02-home.png) |
| 方向键移动焦点后的标题/背景联动 | [查看](../artifacts/review-2026-10-27/tv-alpha1/03-home-next-focus.png) |
| 详情与内容操作初始焦点 | [查看](../artifacts/review-2026-10-27/tv-alpha1/04-film-detail.png) |
| 海报墙与系列自然排序 | [查看](../artifacts/review-2026-10-27/tv-alpha1/05-library.png) |
| 专题 | [查看](../artifacts/review-2026-10-27/tv-alpha1/06-collections.png) |
| 想看 | [查看](../artifacts/review-2026-10-27/tv-alpha1/07-watchlist.png) |
| 独立电视设置 | [查看](../artifacts/review-2026-10-27/tv-alpha1/08-settings.png) |

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
