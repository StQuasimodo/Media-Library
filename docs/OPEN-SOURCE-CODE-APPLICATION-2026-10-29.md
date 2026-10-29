# 开源代码如何应用到My Cinema（2026-10-29）

[调研总览](MATURE-MEDIA-PROJECTS-RESEARCH-2026-10-29.md) · [当前播放架构](TV-PLAYBACK-ARCHITECTURE.md)

本轮进一步对照上游实现与本项目，执行现有解析函数和受控网络探针。结论：优先统一两端的文件名规则，并把已有NetworkScope用于媒体目录任务；随后补播放能力诊断和稳定焦点。图片锁定、按集选择版本值得做，但范围更大。现有数据库、业务服务和播放器内核可继续保留。

这是一份代码适配分析，表中方案均未加入运行时代码。下面区分“本轮已执行复现”“源码可确认的缺口”“后续设计候选”，不把建议当成完成项。

## 一、已经复现：电视与Windows的解析结果不一致

执行对象是本项目未修改的[ResourceName.java](https://github.com/StQuasimodo/Media-Library/blob/bd7b7e5eedceac99e719fe967e807e0ca1a0b888/android-tv/app/src/main/java/io/mycinema/tv/ResourceName.java#L12)、[filename.ts](https://github.com/StQuasimodo/Media-Library/blob/bd7b7e5eedceac99e719fe967e807e0ca1a0b888/electron/main/services/quark/filename.ts#L19)和[resourceInfo.ts](https://github.com/StQuasimodo/Media-Library/blob/bd7b7e5eedceac99e719fe967e807e0ca1a0b888/electron/main/services/quark/resourceInfo.ts#L1)，不是用另一套正则模拟生产逻辑。电视部分在主机JVM运行，使用org.json Java实现与最小Library.Item桩，不涉及Android界面、SQLite或真实设备。

| 输入 | 当前电视结果 | 当前Windows结果 / 对照 | 影响 |
|---|---|---|---|
| `Paddington.2014.1080p.BluRay.x264.AAC.mkv` | 标题`Pa`，audio=`dd` | 标题`Paddington`，音频`AAC` | 音频正则没有词边界，把正常片名截断 |
| `1917.2019.1080p.mkv` | 标题为空，年份1917 | 标题1917，年份2019 | 电视把第一个数字标题当年份 |
| `2001.A.Space.Odyssey.1968.2160p.mkv` | 标题为空，年份2001 | 标题2001 A Space Odyssey，年份1968 | 同上 |
| `Breaking.Bad.S00E01.1080p.mkv` | 季0、集1，但不匹配已有第0季 | Windows保留明确季0 | 电视把未知季和特别篇季0混用 |
| 同一S00文件，父目录为`Season 01` | 匹配到第1季的测试记录`bb1` | 文件自身明确季0应优先 | `season==0`触发父目录继承，覆盖明确季号 |
| `Breaking.Bad.S01E01E02.1080p.mkv` | 只存集1，没有结束集 | Windows标题残留S01E01E02，季集为空 | 两端都没有完整的合并集表达 |
| `Breaking.Bad.S01E01.1920x1080.mkv` | 年份1920，quality为空 | 年份未知，分辨率1920×1080 | 尺寸被误读为年份；当前TV匹配忽略剧集年份，不等于一定错配 |
| `Breaking Bad / Season 01 / 01.mkv` | parse标题01，未关联 | Windows继承剧名与季1/集1 | 仅数字文件名及目录上下文规则较弱 |
| 带HEVC、10bit、HDR10、DDP5.1、Atmos、CHS的样例 | 只保留部分规格 | Windows另有位深、声道、Atmos与简体字幕 | 电视资源选择缺少已有的Windows规格线索 |

正常的Breaking.Bad.S02E03样例两端能识别；探针共10组，目的在于定位边界，不能写成“10项新回归全部通过”。[输入](../artifacts/research/2026-10-29/code-application/cases.json)、[TV原始结果](../artifacts/research/2026-10-29/code-application/tv-results.json)、[Windows原始结果](../artifacts/research/2026-10-29/code-application/windows-results.json)。

### 具体可以借鉴什么

Jellyfin的[EpisodePathParser.cs](https://github.com/jellyfin/jellyfin/blob/63464ab8f4e9b73c8f69af7ddc486b2fc74edba6/Emby.Naming/TV/EpisodePathParser.cs#L151)区分日期、明确季集和多集范围，并阻止1080p等分辨率成为集数；[VideoListResolver.cs](https://github.com/jellyfin/jellyfin/blob/63464ab8f4e9b73c8f69af7ddc486b2fc74edba6/Emby.Naming/Video/VideoListResolver.cs#L251)在合并版本时明确禁用猜测性解析，避免把独立集吞到另一集的版本列表。NOVA的[MovieDefaultMatcher.java](https://github.com/nova-video-player/aos-MediaLib/blob/fba68119be9b704bfa0cad78f7ca8422df0e5cfb/src/com/archos/mediascraper/preprocess/MovieDefaultMatcher.java#L92)分阶段处理年份与标题垃圾词；本项目Windows实现已经采用“较后年份＋非空标题”等保护，因此优先统一自有规则，再独立实现缺少的上游思想。

建议最小改动：

1. 先建立一份两端共享的输入/期望JSON样本，而不是引入跨语言运行框架。对音轨/编码词加明确边界；先识别尺寸与规格，再提取合理年份，数字标题必须保留。
2. 内部解析结果区分“未知季”与“明确季0”；只有未知才继承父目录。保留文件名→最近父目录→外层目录的字段优先级。
3. 合并集以起始/结束集或有序集号列表表达；缺少完整身份时保持独立文件，暂不自动当作重复版本。
4. 电视识别位深、声道、音轨和字幕时复用Windows的样本与命名语义；这些仍是名称线索，不能标成真实媒体探测结果。

改动主要位于ResourceName、MediaBrowserActivity、MediaCatalog以及Windows filename/resourceInfo。优先修复解析与输入上下文，不需更改SQLite表结构。新解析字段若写入JSON，必须保持旧数据可读。

**已有错误关联不会因此自动变对。**[MediaCatalog.java](https://github.com/StQuasimodo/Media-Library/blob/bd7b7e5eedceac99e719fe967e807e0ca1a0b888/android-tv/app/src/main/java/io/mycinema/tv/MediaCatalog.java#L18)目前保留旧的非空film_id，包括旧自动关联。修正解析后，新文件可按新规则匹配；要纠正存量自动关联，需要明确的重新匹配操作，只处理可确定的自动项，人工关联与取消关联继续保留。旧数据里season=0含义不明确，应从原文件名重新推导，不能一律当特别篇。

## 二、已经复现的机制差异：目录浏览的取消可以沿用现有播放架构

MediaElch的[scraper-interface.md](https://github.com/Komet/MediaElch/blob/e60309e6b4917db30001a261ff91ae38ad465a0e/docs/adr/scraper-interface.md#L95)说明独立任务上下文可以防止搜索过程中改设置、切作品造成串写。本项目播放器已经有generation、NetworkScope和会话回收，无需重新设计这部分。

目录浏览还没有接齐同样的机制。[MediaBrowserActivity.java](https://github.com/StQuasimodo/Media-Library/blob/bd7b7e5eedceac99e719fe967e807e0ca1a0b888/android-tv/app/src/main/java/io/mycinema/tv/MediaBrowserActivity.java#L67)的job使用Future，返回/销毁时调用cancel(true)；默认MediaSources持有的scope没有在该任务结束时关闭。启用夸克DAV后的[QuarkDavManager.list](https://github.com/StQuasimodo/Media-Library/blob/bd7b7e5eedceac99e719fe967e807e0ca1a0b888/android-tv/app/src/main/java/io/mycinema/tv/QuarkDavManager.java#L38)也没有接受浏览任务的scope，内部目录定位、本机PROPFIND和逐条resolve分别开启自己的调用。这些请求能有超时/中断检查，但不等于用户取消时全部立即停止。

本轮用生产NetworkScope和现有OkHttp3.12.13连接本机慢响应：Future.cancel(true)后200ms内读请求没有结束；随后scope.close()使其结束，本次观测1ms。[原始结果](../artifacts/research/2026-10-29/code-application/cancellation-result.json)。这是主机JVM的受控机制验证，不是已经复现了电视Activity卡顿，也不能把1ms当性能承诺。

可以实际应用的方案是：每个浏览/扫描任务持有独立NetworkScope；保存当次source、parent、folder等输入快照；沿MediaSources.list、QuarkDavManager.list、QuarkDavTree定位及本机DAV客户端一直传递。在任务finally、取消和销毁时关闭，保留generation过滤。**不关闭共享DAV服务或别的播放会话**，正常完成的请求也及时注销。

这项无需换库或修改数据库；验证需覆盖未启用DAV的原始夸克浏览、已启用DAV的浏览、外部DAV、扫描写库前取消，以及其他播放会话不受影响。此前播放器API22取消测试不能替代新增浏览路径的回归。

## 三、源码可确认：能力报告与播放诊断可接在现有控制器上

Jellyfin TV的[deviceProfileReport.kt](https://github.com/jellyfin/jellyfin-androidtv/blob/7ec47a0014b8ac8bac56d66ed75cbe442706f0ce/app/src/main/java/org/jellyfin/androidtv/util/profile/deviceProfileReport.kt#L102)枚举解码器MIME、profile/level与分辨率等；Kodi按媒体profile筛选解码器，而非仅检查H.265名称。本项目[PlaybackController.java](https://github.com/StQuasimodo/Media-Library/blob/bd7b7e5eedceac99e719fe967e807e0ca1a0b888/android-tv/app/src/main/java/io/mycinema/tv/PlaybackController.java#L22)当前快照主要包含状态、位置、时长、缓冲比例与消息，没有完整的设备能力或媒体轨道信息。

有一个需要纠正的表述：当前`media.setHWDecoderEnabled(true,false)`并不是“绝对只硬解”。我重新读了所用LibVLC3.7.7的Media.java：它会依据设备策略构造含mediacodec与all的候选，未知/禁用硬解时用all。它允许内核选择其他解码器；我们缺的是可见、可控制、可验证的播放策略，而不是简单地再加一次无条件软解重试。

最小分两步：

- 能力收集器在后台读取API21/22已有接口，每个解码器单独容错。输出`支持/不支持/未知`，新系统专有的硬件标志不在API22强行调用。先供诊断使用，不把厂商能力声明作为禁止播放的硬条件。
- 在Playing后，通过当前Media对象读取轨道和Stats，展示实际分辨率/编码/帧率、解码与显示计数、丢帧/缓冲信息；按当前会话代数采样并及时release，不保留旧Media。现有1秒timer可复用，不开高频轮询。网络指标如需新增，应按会话记录，不能把全局segments/recoveries直接当当前影片指标。

LibVLC的IMedia.Track有codec/profile/level等，IMedia.Stats有decodedVideo/displayedPictures/lostPictures；本轮读到的这些公共字段**不提供所用原生解码器名称**。因此UI必须区分“请求硬解优先”与“证实正在硬解”，无法确认时写未知。位深也不能由HEVC字样直接推出，只有profile有明确依据时才解释。

先以文件名规格推荐候选，播放后以实际轨道补充，两个来源并存。增设自动/硬解优先/软解等策略前，先定义与LibVLC参数的准确对应；保持恢复位置和暂停意图，解码失败最多有限次数回退，网络错误先走已有源连接恢复。该阶段不更换LibVLC，不承诺4K/HEVC10bit一定流畅。

## 四、源码可确认：按集聚合版本，和焦点返回一起完善

[MediaCatalog.java](https://github.com/StQuasimodo/Media-Library/blob/bd7b7e5eedceac99e719fe967e807e0ca1a0b888/android-tv/app/src/main/java/io/mycinema/tv/MediaCatalog.java#L18)的forFilm目前按集号排序，[MainActivity.detail](https://github.com/StQuasimodo/Media-Library/blob/bd7b7e5eedceac99e719fe967e807e0ca1a0b888/android-tv/app/src/main/java/io/mycinema/tv/MainActivity.java#L167)把每个资源平铺为播放按钮。这能播放和续播，但一集有1080p/2160p两个文件时，不是“一个集入口内选版本”的呈现。

借鉴Jellyfin时，分组身份应是`影视作品ID＋明确季号＋明确集号/集范围`，不能只拿S01E01跨全库合并。未知项单独列出；同一剧集下版本只做显示分组，原文件ID、资源和每文件进度都保留。先在内存构造展示模型，无需一开始迁移数据库。不同版本进度不能仅按相同时长比例自动复制，剪辑版可能不同。

推荐选择可采用“用户明确选择→已确认能播放的版本→较兼容版本→未知版本”；设备或媒体信息未知时允许手动播放，不能因为HEVC而全拒绝。不要照搬Jellyfin默认按分辨率排序，也不要自动选最高规格。自动下一集要等合并集和特别篇规则可靠后再加。

焦点方面，Jellyfin的[FocusPersistManager.kt](https://github.com/jellyfin/jellyfin-androidtv/blob/7ec47a0014b8ac8bac56d66ed75cbe442706f0ce/app/src/main/java/org/jellyfin/androidtv/ui/navigation/focus/FocusPersistManager.kt#L26)保存稳定key；Ghosten封装焦点与选择态。My Cinema已经保存focusedFilm，首页和海报墙也有恢复；不需要重做。真正缺口是MainActivity的Page仅存screen/value，详情重新显示时总给主操作按钮焦点，资源按钮没有按mediaKey恢复；筛选/滚动等状态也不随每个页面独立保存。这是静态控制流结论，本轮未运行电视导航。

建议PageState增加当前作品/资源key、必要的筛选与滚动锚点；播放器返回时恢复原资源按钮，项目不存在时回到临近项，避免初始焦点再覆盖恢复结果。用原生View与现有页面栈实现即可，不引入Compose或Flutter。

## 五、稍后可做：图片人工纠正与刷新保护

MediaElch的[ImageDialog.cpp](https://github.com/Komet/MediaElch/blob/e60309e6b4917db30001a261ff91ae38ad465a0e/src/ui/image/ImageDialog.cpp#L208)保留候选、语言与规格；Movary的[SyncMovie.php](https://github.com/leepeuker/movary/blob/bab0c76216897a753b40fd83e3987c1b7c941d96/src/Service/Tmdb/SyncMovie.php#L85)只在没有人工海报覆盖时安排替换缓存。本项目[library.ts](https://github.com/StQuasimodo/Media-Library/blob/bd7b7e5eedceac99e719fe967e807e0ca1a0b888/electron/main/services/library.ts#L371)与Artwork.cacheMetadata会根据自动候选更新图片，尚无按海报/背景分别持久化的锁定语义；个人评分和短评保护已经具备，不能把这项重复计为新需求。

建议提供“更换海报/背景”候选入口及“恢复自动选择”，分别保存来源、覆盖选择和修订标记。自动刷新最终提交前重新读取当前覆盖修订，防止用户选图期间旧异步下载完成又覆盖新选择。下载失败仍保留旧缓存。此项会涉及持久化字段与备份格式，需要单独设计兼容，不归入前面无需改表的小修。

保留当前简体/英文规则，普通zh不自动等同于简体；不能照搬语言前缀匹配。季海报和剧集横图的层级也继续分开。另有一个可直接审查的视觉点：Artwork.background和[HeroBackdrop.tsx](https://github.com/StQuasimodo/Media-Library/blob/bd7b7e5eedceac99e719fe967e807e0ca1a0b888/src/renderer/components/HeroBackdrop.tsx#L42)在缺少横图时回退竖版海报；自动选图质量再好，显示层仍可能放大竖海报。可先独立调整为空背景/克制纹理或弱化海报的视觉回退，再用截图评估，避免误当作TMDB选图问题。

## 六、先验证再决定：夸克云转码

OpenList的[util.go](https://github.com/OpenListTeam/OpenList/blob/78c5d9b60b8c1d6a450346b4f6a7c30059ccbe02/drivers/quark_uc/util.go#L139)提供`/file/v2/play/project`路径，现有My Cinema主要解析下载地址。云端播放版本可能减轻老电视解码压力，但目前没有真实账号验证。若返回HLS，需新增明确的媒体源类型、清单/相对分片地址及续期策略，不能把HLS按现有4MiB单文件Range拼接。

因此先核查账号可返回什么格式/清晰度、有效期与权限，再做受控HLS测试；保留原画与换资源入口。它与“装一个播放器就能解决硬解”是不同层次的工作。本轮不引入OpenList整套服务，不改变电视独立连接的目标。

## 建议的实际落地顺序

| 批次 | 具体范围 | 风险与验收 |
|---|---|---|
| 1 | 解析词边界/年份/明确季0；共享样本；目录任务NetworkScope接齐 | 修改小、收益直接；两端结果一致，已有人工关联保留，取消请求真的结束。存量自动误关联另走明确纠正流程 |
| 2 | 能力报告、轨道与播放Stats；按资源key恢复焦点 | 无需先改schema；API22、未知能力、快速重连/退出后的旧采样、遥控器返回都要验收 |
| 3 | 集/版本显示分组；图片候选、锁定与刷新提交保护 | 分组先做展示模型；图片持久化须设计升级/备份；再评估自动下一集 |
| 探索 | 真实夸克云转码 | 账号与协议未验收前不依赖，不宣称提升了播放性能 |

Windows继续以1.2.0稳定线为基础；普通研究提交不需要升应用版本，后续真正向用户分发新包时按版本规则递增。当前播放器、DAV只读边界、SQLite和现有业务服务均保留。上游思想以适合本项目的独立实现落地，实际移植代码时再核查具体许可证。

## 本轮执行与证据

- Windows现有`tests/quark.test.ts`与`tests/quark-resource-info.test.ts`共33项通过；[结果摘要](../artifacts/research/2026-10-29/code-application/verification-summary.json)。它们没有覆盖上面所有新增诊断样例，不能抵消已复现缺口。
- 生产解析函数10组主机探针、生产NetworkScope慢请求探针已执行；TV部分未使用真实Android运行时/数据库。未执行完整170项测试、Electron运行、新API22构建或长虹实机验证。
- [源码提交与SHA256](../artifacts/research/2026-10-29/code-application/provenance.json)、[Java解析探针](../artifacts/research/2026-10-29/code-application/ResourceNameProbe.java)、[最小Item桩](../artifacts/research/2026-10-29/code-application/Library.java)、[取消探针](../artifacts/research/2026-10-29/code-application/BrowserCancellationProbe.java)、[Windows探针](../artifacts/research/2026-10-29/code-application/windows-probe.cjs)。探针不打入应用。
- LibVLC结论来自项目现用3.7.7源码包的Media.java 456–500行、IMedia.java 123–239/299–338行；[上轮官方包索引](../artifacts/research/2026-10-28/tv-playback/aar-checks.json)和本轮provenance记录用于核对。没有将应用请求的解码模式冒充实测硬解状态。
- 本轮交付仅文档及研究证据；解析、取消、焦点、图片等发现仍未修复，没有发布新版本。
