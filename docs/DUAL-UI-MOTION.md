# 双端浏览动效与详情主视觉

本轮为展示层修改：收藏数据库结构、系列身份、TMDB/夸克关联、凭据和播放器进度保持原有接口。

- Windows：路由重播淡入，顶部导航用常驻滑块过渡，避免新旧页面一起移动。详情首屏约占窗口高度的 92%，弱化遮罩并将标题/操作放在下方；滚动时混合渐变模糊背景、加深遮罩并轻移标题。尊重应用和系统的减少动态效果设置。
- Android TV：原生页面和焦点动画、常驻导航滑块；详情首屏保留大幅背景，遥控器「查看资源」仍可滚动并聚焦资源区。API 21 的 `onScrollChanged` 驱动内存中的模糊背景，派生位图不超过 160×90，不增加磁盘缓存。系统关闭动画时取消位移。
- 文件夹名称仅清理显示：去掉括号和「系列 / Collection」等组织后缀，保留年份等有意义的限定词。原名、归类键和手工关联不改写。双端使用同一组验收样例。
- 首页、详情和图片选择界面不再显示「按季分配 / 季份未标注」等技术来源文字；服务层选图依据和背景范围校验保留。

## 验证

本地：TypeScript、243 个 Vitest 测试、前端构建通过。完整 Android 主源码和 instrumentation 通过 Java 8 编译。隔离 SQLite 配合无头 Chromium 检查了动画中间帧、文件夹显示与持久化原名、1440×900 / 1280×720 / 960×600 详情布局、真实模糊层和减少动态效果，见 `artifacts/dual-ui-motion/browser-report.json`。此结果只证明前端渲染，不代表 Electron 桌面运行或电视实机表现。

独立 Windows Electron 与 API 22/x86 原生 instrumentation 均已完成，详细结果如下。ARMv7 原生库打包检查不能替代长虹电视实机流畅度验收。

## Windows 实际验收

[43449050339](https://github.com/StQuasimodo/Media-Library/actions/runs/43449050339) 完整通过，源码 `2ecdd2137a15f5920646cc7406bf20a4cd76ec5b`。两个独立用户目录分别完成 36 项 UI / 受控 CLI 检查与 67 项完整资料/夸克流程检查，均为 Windows 原生 Electron 窗口，未启用 headless 或禁用 sandbox。包含动画中间帧、详情背景/标题滚动、减少动态效果、文件夹显示与存储原名、无技术来源提示；安装选项 6 项检查、凭据跨版本读取及重启均通过。安装包与便携包已下载，全部 SHA256 校验通过，报告与哈希在同名 artifacts 目录。

首轮 [43448405590](https://github.com/StQuasimodo/Media-Library/actions/runs/43448405590) 已执行 UI 检查，但后续外部夸克登录页未就绪而失败。重跑使用明确的 `probe_live_quark=false`，原有默认线上检查仍保留；此次受控回归不证明真实账号登录成功。

## 电视端回调修正

首轮 [43448402691](https://github.com/StQuasimodo/Media-Library/actions/runs/43448402691) 构建、Lint、安装与 12 项升级检查完成，UI smoke 未完成，已主动取消。复查 Android 5.1 `View.layout` 确认：当 `LAYOUT_REQUIRED` 设置时，即使视图边界未变，也会调用布局监听器。原滑块回调无条件 `setLayoutParams` 会反复请求布局，现仅在实际边界/尺寸变化时更新。新增空闲布局稳定性检查，并限制 smoke 命令最长 180 秒。此轮不记为 UI 通过，见取消记录；最终回归结果见下节。

浏览器截图使用隔离夹具和本机已有电影图片，只用于展示层检查；Windows 受控场景、电视模拟器截图和真实媒体/账号验收分别记录。

重跑 [43450943633](https://github.com/StQuasimodo/Media-Library/actions/runs/43450943633) 已通过原生动效专项 25 项（包括空闲布局稳定性、实际动画中间帧、真实位图模糊、首屏和滚动、资源入口、名称显示/存储身份与减少动态效果）。后续原有 DPAD 回归发现：扩大 Hero 后「下→右→确认」误入记录编辑器。已为 Hero 主操作补充明确的向下焦点衔接，并固定状态/评分的横向邻接；保留原来的键序并增加逐步焦点断言，修复后完整回归已通过，见下节。原始失败报告仍保留。

## 电视最终实际验收

[43452263793](https://github.com/StQuasimodo/Media-Library/actions/runs/43452263793) 完整通过，生产与测试源码均为 `00d9514069d1f4f089dde9320719d14d8a8f829a`，后续提交仅补充文档和证据。Gradle / Lint、API21 / v1 / 固定签名、ARMv7+x86 打包、API22/x86 安装运行与以下检查通过：

| 范围 | 结果 |
|---|---|
| 功能检查 | 167 项，其中包含 25 项新动效专项，不重复计数 |
| 遥控器 | 28 项，保留真实 DPAD 键序；Hero→状态→评分、8.5 分存储和返回焦点均通过 |
| 备份 / 升级 | 25 项备份、12 项实际覆盖升级与旧进度迁移 |
| 播放 / 取流 | 原文件与云端均连续播放约 90 秒，换链、定位、暂停恢复、备份后原生续播通过 |
| 压力与持久化 | 500 张独立海报、96MiB Java 堆、进程重启和模拟器重启通过 |

已下载 APK，SHA256 与 `BUILD.json`、实际安装测试目标三方相同：`31b7a077cc052086c4d359965564af36e5fce1fb61e3cd077f951da8c939c237`，48,828,582 字节。构建清单、原始报告、截图和哈希见 [验收目录](../artifacts/dual-ui-motion/)。Windows 测试源码是 `2ecdd21`；其后生产改动仅在 Android 与 Android 测试脚本，桌面代码保持一致。

本次云端区间实际显示 1,212 帧、丢 124 帧，最大采样 PSS 182,579 KiB，新增应用文件/缓存为 0 字节。这是共享 CI 模拟器上的功能回归，不能描述为无掉帧或电视性能验收。真实夸克账号、长虹/ARMv7 实机、4K/HDR 和长片稳定性仍未验证。

## 预览包与截图

- Windows 1.3.0-beta.5：[构建产物](https://github.com/StQuasimodo/Media-Library/actions/runs/43449050339)。
- TV 0.3.0-alpha.10 / code18：[APK 构建产物](https://github.com/StQuasimodo/Media-Library/actions/runs/43452263793)。
- 浏览器夹具：[详情首屏](../artifacts/dual-ui-motion/browser-detail-top.png)、[滚动后](../artifacts/dual-ui-motion/browser-detail-scroll.png)。
- API22 原生：[详情首屏](../artifacts/dual-ui-motion/tv-motion-detail-top.png)、[滚动后](../artifacts/dual-ui-motion/tv-motion-detail-scroll.png)、[遥控器评分](../artifacts/dual-ui-motion/tv-remote-rating.png)。

以上为预览构建；本轮未发布 Release 或更新 feed，未覆盖原工作区未提交的播放器代码与文档。
