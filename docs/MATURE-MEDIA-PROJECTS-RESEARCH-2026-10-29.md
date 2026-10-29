# 成熟开源影视项目调研（2026-10-29）

[文档入口](README.md) · [已有播放架构](TV-PLAYBACK-ARCHITECTURE.md) · [上一轮播放调研](TV-PLAYBACK-RESEARCH-2026-10-28.md)

本轮结论：My Cinema现阶段最值得借鉴的是设备能力诊断、稳定的季集/版本身份、焦点恢复，以及可纠正的图片选择。Windows 1.2.0可以保持稳定；电视继续沿用原生Java、LibVLC和本机夸克转WebDAV，先验证真实账号与长虹设备，再决定是否增加云转码等能力。

## 范围与证据

按GitHub搜索、关注数、维护历史、正式Release及与产品约束的相关性筛选；Star只表示关注度，不能证明可靠性。Jellyfin/Kodi作为长期维护参照，OpenList及Ghosten作为活跃但相对年轻的相关实现。查询日期为香港时间2026-10-29，数字与版本会变化。

本轮核对仓库元信息、Release信息与相关Issue，并静态抽查关键源码；源码固定到提交并校验Git blob哈希。没有构建或运行这些第三方应用，也没有因此新增My Cinema功能、修改数据库或发布安装包。主分支代码可能领先正式版；下文minSdk指所读提交的配置，不自动代表所有历史APK。

[仓库快照](../artifacts/research/2026-10-29/mature-media-projects/repositories.json) · [固定源码索引](../artifacts/research/2026-10-29/mature-media-projects/sources.json) · [Issue索引](../artifacts/research/2026-10-29/mature-media-projects/issues.json)。NOVA实际代码位于多个子模块，本轮按aos-AVP所固定的Video/MediaLib提交阅读，避免把不同分支拼成一个版本。

## 重点项目

| 仓库 | Star快照 | API所示最新正式Release | 许可证概况 | 学习重点 |
|---|---:|---|---|---|
| [jellyfin/jellyfin](https://github.com/jellyfin/jellyfin) | 58,774 | v12.4 | GPL-2.0 | 命名解析、多版本、图片层级；服务端方案 |
| [jellyfin/jellyfin-androidtv](https://github.com/jellyfin/jellyfin-androidtv) | 4,672 | v0.19.10 | GPL-2.0 | 设备能力报告、焦点保存、播放队列 |
| [xbmc/xbmc](https://github.com/xbmc/xbmc) | 21,398 | 21.3-Omega | GPL-2.0-or-later为主，多许可证 | MediaCodec筛选、内容驱动界面与动效 |
| [nova-video-player/aos-AVP](https://github.com/nova-video-player/aos-AVP) | 4,768 | v6.6.2 | Apache-2.0 | 独立电视媒体库、刮削流程与图片选择 |
| [OpenListTeam/OpenList](https://github.com/OpenListTeam/OpenList) | 25,341 | v4.2.9 | AGPL-3.0 | 网盘驱动、短期地址与云转码取流 |
| [GhostenEditor/Ghosten-Player](https://github.com/GhostenEditor/Ghosten-Player) | 3,381 | v2.4.7 | AGPL-3.0 | 夸克直连＋手机/电视界面，路线接近本项目 |
| [Komet/MediaElch](https://github.com/Komet/MediaElch) | 1,119 | v2.12.0 | LGPL-3.0 | 异步刮削任务、按图片类型和语言选图 |
| [leepeuker/movary](https://github.com/leepeuker/movary) | 787 | 0.82.1 | MIT | 个人观影记录与元数据分离、图片覆盖保护 |

补充对照：`chenqimiao/quarkdrive-webdav`（372 Star，MIT）规模较小，适合核对夸克到DAV的协议细节，不能仅凭标题视为可直接嵌入Android的成熟SDK。`moneytoo/Player`（2,758 Star，Unlicense）适合借鉴播放操作，但所读源码minSdk24。另查到mpv-android（3,652 Star），本轮只核对元信息，未再次深入其播放器源码。Emby、VidHub没有纳入可完整审阅实现的开源样本。

## 1. Jellyfin：设备能力与媒体身份

设备报告不是写死“支持H.265”。[deviceProfileReport.kt](https://github.com/jellyfin/jellyfin-androidtv/blob/7ec47a0014b8ac8bac56d66ed75cbe442706f0ce/app/src/main/java/org/jellyfin/androidtv/util/profile/deviceProfileReport.kt#L101)枚举解码器，输出MIME、profile/level、分辨率/码率/帧率范围；新Android才读取硬件加速等标志，并处理部分厂商能力查询异常。[deviceProfile.kt](https://github.com/jellyfin/jellyfin-androidtv/blob/7ec47a0014b8ac8bac56d66ed75cbe442706f0ce/app/src/main/java/org/jellyfin/androidtv/util/profile/deviceProfile.kt#L150)把能力与用户设置组成播放配置，交给服务端做直接播放/转码等决策。

对55D2S的可用借鉴：通过API21/22已有的MediaCodecList收集能力，每个解码器单独容错；Android29才有的isHardwareAccelerated等接口不能直接调用。旧系统上硬件/软件身份可能只能推断，必须标注未知。系统宣称支持也不等于实播流畅，最终要结合实际解码方式、播放时间推进、掉帧和网络读速。我们没有服务器，不能把Jellyfin的服务端FFmpeg转码能力算作电视本地能力。

命名方面，[EpisodePathParser.cs](https://github.com/jellyfin/jellyfin/blob/63464ab8f4e9b73c8f69af7ddc486b2fc74edba6/Emby.Naming/TV/EpisodePathParser.cs#L151)区分季集、日期与多集文件，并专门防止把1920x1080、1080p误当季集或集数范围。[VideoListResolver.cs](https://github.com/jellyfin/jellyfin/blob/63464ab8f4e9b73c8f69af7ddc486b2fc74edba6/Emby.Naming/Video/VideoListResolver.cs#L15)把作品、多版本文件和花絮分别组织。My Cinema已有季身份、系列与文件规格；值得补的是多集文件、特别篇/第0季、数字片名和分辨率冲突的样本覆盖，而不是再建一套影视库。

## 2. Jellyfin Android TV与Kodi：焦点和播放策略

[FocusPersistManager.kt](https://github.com/jellyfin/jellyfin-androidtv/blob/7ec47a0014b8ac8bac56d66ed75cbe442706f0ce/app/src/main/java/org/jellyfin/androidtv/ui/navigation/focus/FocusPersistManager.kt#L26)用稳定key保存最后焦点，[FocusRestorationNavEntryDecorator.kt](https://github.com/jellyfin/jellyfin-androidtv/blob/7ec47a0014b8ac8bac56d66ed75cbe442706f0ce/app/src/main/java/org/jellyfin/androidtv/ui/navigation/focus/FocusRestorationNavEntryDecorator.kt#L13)按页面恢复，防止初始焦点再次覆盖返回位置。适合借鉴为“返回原海报/原资源按钮，数据刷新后按ID找回位置；原项被删时回退到相邻项”，而非仅记列表索引。My Cinema已有focusedFilm和海报墙恢复，下一步应审查弹窗、过滤变化、详情返回以及播放器返回的完整路径，不把已有能力误报为缺失。

Kodi的[DVDVideoCodecAndroidMediaCodec.cpp](https://github.com/xbmc/xbmc/blob/7b12e7be164ddee838efb1d6272c720b5e23b187/xbmc/cores/VideoPlayer/DVDCodecs/Video/DVDVideoCodecAndroidMediaCodec.cpp#L770)会按媒体profile筛选解码器，容错厂商查询异常并允许过滤不合适的解码器；[Includes_Home.xml](https://github.com/xbmc/xbmc/blob/7b12e7be164ddee838efb1d6272c720b5e23b187/addons/skin.estuary/xml/Includes_Home.xml#L151)将内容标签、海报与Focus/Unfocus动效组合。可借鉴的是解码决策与UI分离，以及清晰、克制的焦点反馈。Kodi整套C++内核、皮肤引擎和完整媒体中心并不需要搬入现有工程。

当前电视PlaybackController已经独立管理连接/解码/状态/退出，具备网络取消和旧事件隔离。更有价值的增量是播放诊断与有限回退：失败后区分源连接、缓冲、解码、音轨问题；人工可切换自动/硬解/软解，保留位置，并限制重试次数。不要在能力未知时静默循环重建播放器。

## 3. NOVA：独立电视媒体库的完整流程

NOVA是本轮最值得持续跟踪的独立电视媒体库参照。[MovieDefaultMatcher.java](https://github.com/nova-video-player/aos-MediaLib/blob/fba68119be9b704bfa0cad78f7ca8422df0e5cfb/src/com/archos/mediascraper/preprocess/MovieDefaultMatcher.java#L40)将文件名清洗、年份提取和搜索准备分开，注释也承认通用清洗并不总可靠；[AutoScrapeService.java](https://github.com/nova-video-player/aos-MediaLib/blob/fba68119be9b704bfa0cad78f7ca8422df0e5cfb/src/com/archos/mediascraper/AutoScrapeService.java#L127)维护自动刮削队列及进度；[VideoInfoBackdropChooserFragment.java](https://github.com/nova-video-player/aos-Video/blob/4bf05901637678fbc9453a7e10feccd075b34b71/src/main/java/com/archos/mediacenter/video/info/VideoInfoBackdropChooserFragment.java#L128)提供背景图选择，并在页面停止时停止加载UI图片。

对本项目的应用：网盘文件身份、影视元数据、个人记录及播放进度继续分开；扫描发现文件不应立即覆盖人工匹配。Windows已有high/review候选和自动导入流程，电视当前主要匹配已收藏作品，二者完成度不同。后续若补齐电视自动入库，应复用“高置信度自动、歧义待确认”的规则，并明确完整扫描、失败扫描及资源缺失的区别。

NOVA并非没有坑：[Issue 1782](https://github.com/nova-video-player/aos-AVP/issues/1782)用户报告TMDB集序与NFO问题，[Issue 1923](https://github.com/nova-video-player/aos-AVP/issues/1923)报告重新扫描匹配错片及图片更新耗时。这些属于上游用户报告，未在本轮复现，但很适合作为我们的回归场景：刷新可取消、人工纠正不丢、旧收藏不因临时网络失败而消失。

## 4. OpenList与专用Quark DAV：协议分工，另有云转码线索

[util.go](https://github.com/OpenListTeam/OpenList/blob/78c5d9b60b8c1d6a450346b4f6a7c30059ccbe02/drivers/quark_uc/util.go#L113)将下载地址与Cookie/Referer/UA一起返回，短期URL只是一次取流结果；文件ID才是长期身份。My Cinema已有这种分工，以及4MiB顺序Range、并发失效刷新合并和播放会话取消，本轮没有证据要求推倒它。也没有依据把上游3并发、10MiB直接套到1GB级老电视上。

值得单独验证的是[util.go](https://github.com/OpenListTeam/OpenList/blob/78c5d9b60b8c1d6a450346b4f6a7c30059ccbe02/drivers/quark_uc/util.go#L139)：OpenList通过`/file/v2/play/project`请求转码播放候选，代码列出多个清晰度和流格式。这提示“没有NAS”时仍可能使用夸克提供的云端播放版本，但当前源码只是选第一个非空地址，不能当作完善的清晰度协商。账号权限、会员限制、是否生成版本、签名/有效期、旧TLS及HLS重连都需要真实验证。

[Issue 2115](https://github.com/OpenListTeam/OpenList/issues/2115)有转码取流报plf_invalid的用户报告，因此暂不把它当作已可依赖的回退路径。若之后验证成功，可将候选交给现有MediaSources/PlaybackController；HLS应按清单与分片处理，不能强行套用单文件Range拼接或暴露云端凭据。

另一条路线也有边界：[util.go](https://github.com/OpenListTeam/OpenList/blob/78c5d9b60b8c1d6a450346b4f6a7c30059ccbe02/drivers/quark_open/util.go#L438)的Open驱动本地刷新仍为TODO，需要在线API分支；不能据“Open”命名就认定完全脱离服务独立续期。小型[cache.rs](https://github.com/chenqimiao/quarkdrive-webdav/blob/7a88d7f1fa299a6ef75b99d7e5dbc07a717f579e/src/cache.rs#L80)使用有容量与TTL的目录缓存，但有分页次数上限，若借鉴须显式处理超限而非静默漏文件。其README主要交付桌面/服务器二进制和Docker，Android内置需要另行移植、ABI与生命周期验证。

## 5. MediaElch与Movary：图片可纠正，个人记录要稳定

[scraper-interface.md](https://github.com/Komet/MediaElch/blob/e60309e6b4917db30001a261ff91ae38ad465a0e/docs/adr/scraper-interface.md#L95)记录了刮削任务共享状态造成的串片、设置变化和对象生命周期问题，建议每次搜索/刮削有独立任务上下文。这与我们现有generation、NetworkScope和刷新上下文隔离方向一致；未来加功能仍应沿用这条边界。

[ImageDialog.cpp](https://github.com/Komet/MediaElch/blob/e60309e6b4917db30001a261ff91ae38ad465a0e/src/ui/image/ImageDialog.cpp#L208)提供语言、图片规格与候选选择；[SyncMovie.php](https://github.com/leepeuker/movary/blob/bab0c76216897a753b40fd83e3987c1b7c941d96/src/Service/Tmdb/SyncMovie.php#L68)在同步元数据时检查用户海报覆盖，再决定是否更新缓存；[MovieHistoryEntity.php](https://github.com/leepeuker/movary/blob/bab0c76216897a753b40fd83e3987c1b7c941d96/src/Domain/Movie/History/MovieHistoryEntity.php#L7)把个人观影日期/评论作为独立领域。My Cinema已有个人字段保护，能借鉴的是“自动选图之后仍可人工纠正并锁定”，而不是把全部刷新等同于全部覆盖。

季背景有一个直接可核查的事实：Jellyfin的[TmdbSeasonImageProvider.cs](https://github.com/jellyfin/jellyfin/blob/63464ab8f4e9b73c8f69af7ddc486b2fc74edba6/MediaBrowser.Providers/Plugins/Tmdb/TV/TmdbSeasonImageProvider.cs#L47)只宣告Primary并处理季海报；[TmdbSeriesImageProvider.cs](https://github.com/jellyfin/jellyfin/blob/63464ab8f4e9b73c8f69af7ddc486b2fc74edba6/MediaBrowser.Providers/Plugins/Tmdb/TV/TmdbSeriesImageProvider.cs#L47)处理剧集级backdrop。TMDB季数据不等于一定有该季高质量背景。My Cinema目前从同一剧集的高质量横图池按季分配变体，代码也明确它不是已证明对应某一季的宣传图。应继续优先图质、允许共用好背景，避免拿剧照凑不同。

语言规则不能照搬MediaElch的宽泛语言前缀匹配。TMDB普通zh标记无法证明简体；本项目已有明确简体标记优先、英文回退、繁体和含糊zh不自动选用的规则。后续候选选择也要保留这些限制，人工锁定不应被批量刷新冲掉。

## 6. Ghosten Player：方向接近，但不能照搬运行栈

[README.md](https://github.com/GhostenEditor/Ghosten-Player/blob/8c4fc325c2f816470cb60c1123fd7d7cdb884941/README.md#L16)明确包含夸克、WebDAV、元数据刮削与电视界面；[season.dart](https://github.com/GhostenEditor/Ghosten-Player/blob/8c4fc325c2f816470cb60c1123fd7d7cdb884941/lib/pages_tv/detail/season.dart#L171)提供系列内切季及分集详情，[focusable.dart](https://github.com/GhostenEditor/Ghosten-Player/blob/8c4fc325c2f816470cb60c1123fd7d7cdb884941/lib/pages_tv/components/focusable.dart#L34)封装焦点生命周期。它比Jellyfin服务端方案更接近“电视独立使用”，适合学习作品→季→集→版本的操作路径、资源来源展示和遥控器交互。

同时，README要求Android6+，Gradle下限来自Flutter配置；它不能作为已兼容API22的证据。[Jellyfin TV版本配置](https://github.com/jellyfin/jellyfin-androidtv/blob/7ec47a0014b8ac8bac56d66ed75cbe442706f0ce/gradle/libs.versions.toml#L8)的minSdk为23，[NOVA所读Video子模块](https://github.com/nova-video-player/aos-Video/blob/4bf05901637678fbc9453a7e10feccd075b34b71/build.gradle#L151)为23，[Just Player](https://github.com/moneytoo/Player/blob/b74285ca8a2fc6cf1ad604e34781a0a07b0384c0/app/build.gradle#L13)为24，也不能直接替换我们的minSdk21工程。保留Java＋LibVLC，借鉴交互与分工即可。

[Issue 364](https://github.com/GhostenEditor/Ghosten-Player/issues/364)报告夸克模式搜索正常但确认刮削失败；[Issue 362](https://github.com/GhostenEditor/Ghosten-Player/issues/362)提出电影系列合并和分类。它们说明“列出搜索结果”“已有许多功能”都不足以证明完整流程可用；本项目已有系列功能，应继续守住端到端导入、刷新与返回路径。

## 对My Cinema的最小建议

| 优先级 | 建议与当前基础 | 涉及文件 | 需要怎样验收 |
|---|---|---|---|
| P0 | 固定电视发布签名和可恢复备份；现为开发签名，收藏与媒体源/进度分库，需先核对恢复覆盖范围 | `android-tv/development-signing.sha256`、电视工作流、`Library.java`、`MediaCatalog.java`、`SecretStore.java` | 跨版本覆盖升级后收藏/关联/进度不丢；恢复失败可回退；凭据按原安全边界处理 |
| P0 | 真实夸克登录→选目录→取流与长虹硬解验证；现有API22合成样片回归继续保留 | `MediaSources.java`、`QuarkDavManager.java`、`PlaybackController.java` | 真实账号完整链路、真实ARM设备与长片播放分别给证据；模拟器不代替长虹 |
| P1 | 解码能力报告与播放诊断；当前无完整设备报告 | 新增小型能力收集器，接入`PlaybackController.java`及设置/播放UI | API22未知项不冒充支持；厂商查询异常不崩；分清网络/解码/音频；报告无凭据 |
| P1 | 季集解析边界与多版本选择；已有季身份、资源规格和人工关联 | `ResourceName.java`、`MediaCatalog.java`；Windows的`filename.ts`、`matching.ts` | 多集、特别篇、数字片名、1080p冲突；不误合并不同作品；刷新保留人工结果 |
| P1 | 扩展焦点返回回归；已有海报焦点与基本恢复 | `MainActivity.java`、`PlayerActivity.java`；Windows的`FocusRail.tsx` | 详情/播放/弹窗返回准确；筛选或删除后不失焦；无需改UI框架 |
| P2 | 图片候选与锁定；已有严格选图与批量刷新 | `Artwork.java`、`TmdbClient.java`、`metadata/artwork.ts`及详情页 | 简体/英文规则不退化，锁定不被刷新覆盖；没有好季图可共用剧集背景 |
| 待验证 | 夸克云转码候选；目前只有源码线索 | `MediaSources.java`及受控播放验证 | 先查账号可用性/清晰度/取流格式及续期，再决定是否开发；失败仍能返回原画/换资源 |

P0备份/签名已有相关限制文档，但本轮没有重新执行恢复测试，因此不将其当作新发现的已复现缺陷。表中的建议是后续候选，不等于已排期或已实现；涉及持久化字段时先做最小设计和迁移验证，本轮不改schema。

## 哪些不需要引入

保留PS5聚焦交互和电影杂志排版，学习Kodi/Ghosten的焦点反馈，不复制它们整套首页。Jellyfin的服务端/多用户体系、OpenList的全部网盘与上传功能、NOVA的本地目录扫描，都超出当前产品所需。电视独立连接夸克这一约束保持不变。

许可按实际文件与依赖核查：Jellyfin/Kodi主要GPL，OpenList/Ghosten为AGPL，MediaElch为LGPL；NOVA多个仓库和原生依赖许可证不同，不能只看聚合仓库的Apache标记。本轮只阅读与独立分析，没有复制第三方实现或新增依赖。若将来移植代码或分发组件，再具体处理对应许可义务。

## 本轮交付与验证边界

交付调研文档、仓库/源码/Issue索引及文档入口链接；My Cinema运行时代码、版本号、数据库与Release不变。检查了证据JSON、源码blob校验、文档相对链接与diff格式；未运行应用测试，也未重新构建或运行第三方项目。上述Issue只作回归线索，不代表已独立复现其原因或本项目存在同样缺陷。
