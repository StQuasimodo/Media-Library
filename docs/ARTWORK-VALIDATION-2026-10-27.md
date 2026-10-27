# 背景与海报修复验证（2026-10-27）

[选图规则](ARTWORK.md) · [Windows beta.3下载](https://github.com/StQuasimodo/Media-Library/releases/tag/v1.2.0-beta.3) · [电视alpha.3下载](https://github.com/StQuasimodo/Media-Library/releases/tag/tv-v0.1.0-alpha.3) · [截图](GALLERY.md)

两端原始构建源码均为`e6ddcafa9283043d918f43cc08e2d1affcbf1fc9`。beta.2 rev4使用首张单集剧照来区分季背景，用户反馈不适合作为大背景；本轮改用横版图库，筛选尺寸/比例/语言/评价，同剧有足够相近品质候选时按季分配。海报只接受明确简体/大陆地区信息或英文，不把通用zh当作简体，也不使用未经分类的默认海报绕过筛选。

## Windows

[完整Windows流程](https://github.com/StQuasimodo/Media-Library/actions/runs/40527049820)通过：14个文件、155项测试、类型检查、生产构建、真实Electron/preload/SQLite、受控目录匹配/分季导入/刷新、旧版凭据读取、打包校验、实际NSIS安装器取消快捷方式与重装保留选择。Linux工作区真实Electron在headless/no-sandbox诊断模式的受控界面检查也通过，不用它替代Windows结果。

新增检查覆盖繁体/港台/未区分简繁的zh排除、明确简体优先与英文回退、尺寸/宽高比、投票平滑、图库去重及稳定分季分配。实际Windows窗口验证两季分别使用不同图库变体、无合适横版时回退合规季海报。刷新确认无合规图时清理旧路径，图库/下载失败保留离线缓存；个人记录、资源关系和重启持久化保留。

全部五个公开资产已重新下载，与保留构建逐字节一致，SHA256SUMS和GitHub资产摘要一致。安装包122,938,177字节，SHA-256 `215373b93eb4901a2fbe8460bc305fac8b9c88fa5c124d40b7276c51039b82b2`；数据库保持schema v4、数据与凭据目录不变，Latest仍为正式版1.1.0，旧Tag/资产保留。

[公开文件检查](../artifacts/releases/v1.2.0-beta.3/public-assets.json) · [真实窗口报告](../artifacts/releases/v1.2.0-beta.3/artwork-desktop-report.json) · [安装器报告](../artifacts/releases/v1.2.0-beta.3/installer-report.json) · [凭据重启读取](../artifacts/releases/v1.2.0-beta.3/report-restart-new.json)。

## Android电视

[原始构建/API22完整流程](https://github.com/StQuasimodo/Media-Library/actions/runs/40527056050)通过：构建与Lint、minSdk21/v1签名/DEX035/无原生库检查、原生界面与Keystore/SQLite、搜索/分季导入/HTTPS图片缓存、编辑/筛选/专题/资源/备份恢复、部分失败重试、504条收藏滚动及进程/内核重启后的持久化。新增原生检查验证英文季海报、繁体/未知中文排除、明确大陆地区海报优先，以及不同季使用同剧高清横版图库变体。

[受限应用堆矩阵](https://github.com/StQuasimodo/Media-Library/actions/runs/40527516571)两组均通过全部业务及进程/内核重启，配置RAM均1GiB，实际可见1,056,206,848字节：

| 配置 | 实际应用堆上限 | 滚动后PSS单次采样 | 结果 |
|---|---|---|---|
| 720p | 100,663,296字节 / 96MiB | 42,966KiB | [第2次尝试通过](../artifacts/releases/tv-v0.1.0-alpha.3/720p-96m/full.json) |
| 1080p | 67,108,864字节 / 64MiB | 42,259KiB | [第1次尝试通过](../artifacts/releases/tv-v0.1.0-alpha.3/1080p-64m/full.json) |

这些采样不是峰值、帧率或实机性能结论。720p首次运行在完整业务和进程检查后，内核重启阶段出现模拟器图形上下文错误、ADB设备消失；取消该次卡住的运行后，仅重跑720p任务通过，未把缺失的重启报告标记为通过。[原始中断记录](../artifacts/releases/tv-v0.1.0-alpha.3/720p-attempt1-canceled/failure-excerpt.txt)保留，底层失联原因不能只由这些日志确定。

后续测试脚本补充设备/启动/测试阶段的等待超时，分阶段提取报告，并在后续读取失败时保留已完成报告。该脚本修正通过Bash语法与设备失联/文件读取失败的边界模拟，[边界检查](../artifacts/releases/tv-v0.1.0-alpha.3/collector-boundary-check.json)没有冒充新的模拟器完整运行；本轮APK和最终矩阵仍以原始e6ddcaf提交为来源。

APK为1,411,567字节，SHA-256 `83e074cba861a3dae1456a1763cee469e737b02f5c7f4a7df2424ce2b93e8bff`。三个公开下载资产与原始产物逐字节一致，矩阵应用APK哈希相同。开发证书沿用alpha.2，versionCode从2增至3，支持该签名身份的覆盖安装；用户真实设备升级仍待验收。不能覆盖alpha.1丢失的旧签名，不要求有旧数据的用户直接卸载。

[构建身份](../artifacts/releases/tv-v0.1.0-alpha.3/BUILD.json) · [公开文件检查](../artifacts/releases/tv-v0.1.0-alpha.3/public-assets.json) · [原生检查](../artifacts/releases/tv-v0.1.0-alpha.3/emulator-report.json) · [完整界面检查](../artifacts/releases/tv-v0.1.0-alpha.3/baseline-full.json)。

## 公开图片与边界

匿名访问《绝命毒师》横版图库，核对三张CDN图片均为HTTP200、1280×720，并查看构图；网站中文海报详情可见CN/TW/HK/SG地区，不能假定API一定提供同样的地区字段。[公开检查](../artifacts/review-2026-10-27/beta3/public-artwork-check.json)。应用没有新增网站爬取依赖或OCR，只有明确来源标记才自动采用中文海报，通常回退英文。

完整成功链路仍使用受控图库/合成图片和凭据；真实公共TMDB仅另测无效Key 401。未验证真实Key成功认证、用户收藏实际图片分布、图库标记准确性、长虹原厂固件/输入法/遥控器/解码，亦未验证512MiB整机RAM。元数据筛选改善候选范围，不能保证每张图的主体位置与留白都符合个人审美；图库变体没有已核实的季归属。WebDAV和电视播放仍未实现。
