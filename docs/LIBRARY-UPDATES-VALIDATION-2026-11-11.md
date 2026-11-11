# 两端更新与收藏整理验收（2026-11-11）

本轮按用户确认实现可配置镜像、关联剧集与衍生电影的影视宇宙文件夹，同时保留夸克目录/匹配并改进选图。本次不替换播放器内核，不新增数据库迁移。

## Windows1.3.0-beta.1

[真实Windows构建/发布](https://github.com/StQuasimodo/Media-Library/actions/runs/42939674697)全部通过，源码`8d30c31afd93ad466cc023c5af530476cd1fca70`。类型检查、生产构建与18文件/201测试通过；真实Electron窗口启用sandbox、非无头运行，新增图库、在线剧照协议、背景锁定刷新、宇宙文件夹及钻入、更新设置IPC/UI均通过。安装器实际取消/记忆快捷方式选择、安装产物与已验证构建一致、旧Windows加密凭据兼容均通过。

[发布包](https://github.com/StQuasimodo/Media-Library/releases/tag/v1.3.0-beta.1)安装器122949787字节，SHA-256 `c836e717b2974fa9a46ed994a23b27964a68f95df695dc5a9dd4005271a718c6`。公开更新清单经固定密钥签名，发布流程已自动更新Windows预览索引；稳定索引继续指向1.2.0，不将beta设Latest。

[保留证据](../artifacts/releases/v1.3.0-beta.1/BUILD.json)、[真实界面/功能报告](../artifacts/releases/v1.3.0-beta.1/library-features-report.json)、[安装器报告](../artifacts/releases/v1.3.0-beta.1/installer-report.json)。截图使用隔离测试收藏与色块图，证明交互/请求链路，不作为实际电影素材品质的验收。

## Android TV0.3.0-alpha.1 / code9

[完整构建与API22](https://github.com/StQuasimodo/Media-Library/actions/runs/42940425191)通过，实际源码与测试驱动均为`410ab0e482f289a76ec85d34291b366a4359c0ce`。minSdk21/v1签名/ARMv7+x86共享库检查、Gradle/Lint通过；运行在API22 x86、1GiB RAM、96MiB Java堆的独立模拟器。

- 17项新增功能检查通过：实际签名清单的API22验签、篡改/错误渠道拒绝、镜像配置校验、跨剧集与衍生电影归类、刷新保留人工归类和选图、错季旧背景隐藏、内存剧照真实解码且图片目录文件数不增加、原生文件夹/遥控焦点。
- **实际旧APK覆盖升级**：下载并校验已发布alpha.5原始字节（源码`3d0d68cdbd5febb1648a111c5c753a56ed4dbdd7`，SHA`1c03fd9052ec49124dc679302bde543269a1f969288d58fb7e4286cdf43c5fda`），在其中创建合成收藏、评分、三类加密凭据、选定目录、手动关联和45123ms播放进度，然后通过PackageManager覆盖安装新APK。7项验证通过，完整收藏/媒体快照值相同，三个凭据可解密，目录/关联/精确进度保留。未以新源码重建旧应用冒充发布基线；只另外编译对应旧API的测试驱动。
- 原播放回归通过：真实LibVLC1080p H264/AAC解码及显示、内嵌音轨/单字幕、定位/暂停恢复/续播、实际本机Quark→WebDAV、4MiB Range、地址刷新、有限断流恢复、取消与会话撤销。90,072ms连续观测新增1,243显示帧；起止PSS约162/156MiB，不是峰值，也不代表4K性能。
- 16项备份检查、29组名称样本及匹配约束、504条收藏/500张不同海报路径的实际滚动与缓存淘汰，以及离线进程/模拟器内核重启保留凭据与收藏通过。公开无效Key的真实TMDB401验证通过，不冒充真实个人Key成功导入。

原始APK48771547字节，SHA-256 `c561853702449c6077e9e14c5c1546a1a14955889a91a0fac9e992af6fd8371e`；固定证书`be6ca6625b1cc4457d0e016fe8c7b300cd0285cf2cee0ae9ac9e8ed79a8249ad`，与alpha.5相同。[发布流程42941408826](https://github.com/StQuasimodo/Media-Library/actions/runs/42941408826)通过，构建保留文件经校验原样发布，无重新打包。公开TV预览更新清单的签名、code9与APK摘要已再次核对。[产物身份](../artifacts/releases/tv-v0.3.0-alpha.1/BUILD.json)、[覆盖升级](../artifacts/releases/tv-v0.3.0-alpha.1/upgrade-report.json)、[新功能](../artifacts/releases/tv-v0.3.0-alpha.1/features-report.json)、[原播放链路](../artifacts/releases/tv-v0.3.0-alpha.1/quark-dav-report.json)、[重启/收藏汇总](../artifacts/releases/tv-v0.3.0-alpha.1/regression-summary.json)。

首次候选[42939671001](https://github.com/StQuasimodo/Media-Library/actions/runs/42939671001)的新功能与旧包升级已通过，但完整播放测试失败：旧测试依赖重新登录隐式清空挂载，转换入口与预期不符。修正为显式清理测试自己的挂载，另保留重新登录不丢目录检查；同时修正海报尺寸按实际列宽计算、隔离测试恢复原快照。最终完整流程已重新执行通过，未将首次失败记为成功。

## 已知边界

- 默认镜像留空。受控测试模拟GitHub失败、镜像回退与错误哈希，实际第三方镜像尚未配置或验收；无账号头转发。
- 季图片来源不再混用整剧；TMDB许多季没有横图，因此可回退到季海报。语言/尺寸/投票是启发式，无法证明所有横图一定是宣传图。手选可人工确认和锁定。
- 当前只内置明确的绝命毒师/风骚律师/续命之徒跨作品关系；其他宇宙可手选合并，不虚构TMDB有通用影视宇宙元数据。
- 真实个人TMDB、夸克账号、长虹电视硬解/4K/长播和系统安装界面仍未验收。新收藏功能不代表PotPlayer能力已实现。
- 云环境本地未安装可用Electron运行时，自动下载失败；未将此环境的前端渲染替代真实Windows窗口。Windows结果来自上述Actions实际执行。
