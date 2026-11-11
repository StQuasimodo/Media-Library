# 自动选图与系列归类：开源实现调研

2026-11-11（香港时间）。实际读取6个仓库中的21份实现/规则文件；固定提交与下载记录见[来源索引](../artifacts/research-2026-11-11/artwork-collections-sources.json)。星标仅用于选择研究样本，不代表功能验收或算法准确率。本轮没有运行这些第三方应用，也没有引入其运行时依赖或复制其业务源码。

## 选了哪些项目

| 项目 | 查阅时星标 | 阅读重点 |
|---|---:|---|
| [Jellyfin](https://github.com/jellyfin/jellyfin) | 59,202 | TMDB分季/全剧图片提供器、图片刷新、电影合集 |
| [Jellyfin Android TV](https://github.com/jellyfin/jellyfin-androidtv) | 4,729 | 按图片角色和父级关系处理展示比例 |
| [Sonarr](https://github.com/Sonarr/Sonarr) | 17,646 | 剧集/季/单集的数据映射，区分fanart和截图 |
| [Radarr](https://github.com/Radarr/Radarr) | 14,750 | TMDB合集ID、增量刷新、图片缓存与失效 |
| [MoviePilot](https://github.com/jxxghp/MoviePilot) | 12,060 | 中文媒体刮削、TMDB缺图回填、Fanart语言/季份筛选 |
| [Kometa](https://github.com/Kometa-Team/Kometa) | 3,463 | 电影系列及跨电影/剧集宇宙规则、图片来源和去重更新 |

这里的“收藏算法”拆成元数据匹配、图片选择、系列归类和刷新策略。它们各有规则和数据来源，并不存在一个能同时解决所有问题的通用评分。

## 图片问题的直接证据

Jellyfin的[TmdbSeasonImageProvider](https://github.com/jellyfin/jellyfin/blob/8466670e95b5f4f0b55d6353cf9fb3d6123217e3/MediaBrowser.Providers/Plugins/Tmdb/TV/TmdbSeasonImageProvider.cs#L58)只声明`ImageType.Primary`，读取季的`Images.Posters`；[TmdbSeriesImageProvider](https://github.com/jellyfin/jellyfin/blob/8466670e95b5f4f0b55d6353cf9fb3d6123217e3/MediaBrowser.Providers/Plugins/Tmdb/TV/TmdbSeriesImageProvider.cs#L60)才读取全剧的`Backdrops`。这与My Cinema依赖分季接口自动提供横图的假设不同。

My Cinema此前只接受本季横图，而实际季图库常只有海报；随后Windows的`HeroBackdrop`和TV的`Artwork.background`把竖版海报当背景。另一个独立问题是Windows“恢复自动选图”把自动背景保存成普通缓存路径，导致分季页面的范围检查再次隐藏该背景。

Sonarr的[SkyHookProxy](https://github.com/Sonarr/Sonarr/blob/c018578e4b79ee048575c02d7a8aa2b929e4b837/src/NzbDrone.Core/MetadataSource/SkyHook/SkyHookProxy.cs#L318)明确不把全剧fanart当作单集截图，并分别映射poster、banner、fanart和clearlogo；[Jellyfin TV ImageHelper](https://github.com/jellyfin/jellyfin-androidtv/blob/33235e447a54c28dc2c7155ef23d0dadb9c9de14/app/src/main/java/org/jellyfin/androidtv/util/ImageHelper.kt)也按图片角色选择比例。应借鉴图片角色分离，不能因为“有图”就把海报、背景和剧照互换。

## 本轮采用的规则

1. **背景只使用横图。** 本季横图优先；缺失时按用户明确选择回退全剧图库，显示“全剧通用横图 · 季份未标注”。所有横图都缺失时保留暗色背景；海报留在海报位。
2. **范围必须真实。** 全剧回退缓存为`backdrop/series/<剧集ID>/...`，不会标成某季专属。同一剧集的多季可共用该缓存，其他剧集不能借用；本季图、手选图维持各自范围，不变更数据库schema。
3. **先过滤、再排序。** 背景限制横纵比1.5–2.05、至少1280×720，排除低清/竖图/明显低分，优先有语言标签的横版宣传候选。再综合投票数量、评分、分辨率和比例；同分稳定选择，不按季号随机轮换。海报仍只接受明确简体或英文，不能将通用`zh`标签视为简体。
4. **用户手选优先。** 刷新保留手选锁定；“恢复自动选图”正确恢复本季或全剧范围。图片服务失败保留已有缓存，避免断网清空收藏展示；清单明确无候选才处理自动旧图。
5. **旧收藏自动重新选图的入口是资料刷新。** 影视库一键刷新或单部刷新会运行新规则，不要求逐部挑图。升级本身不会无限触发全库网络请求；手选锁定不会被批量覆盖。

这些是本轮My Cinema自己的实现，分别位于[TMDB提供器](../electron/main/services/metadata/tmdb.ts)、[缓存](../electron/main/services/imageCache.ts)、[自动/手动恢复](../electron/main/services/metadataService.ts)、[背景组件](../src/renderer/components/HeroBackdrop.tsx)及TV的[TmdbClient](../android-tv/app/src/main/java/io/mycinema/tv/TmdbClient.java)、[Artwork](../android-tv/app/src/main/java/io/mycinema/tv/Artwork.java)。

TMDB图库并没有可靠的“宣传图/普通剧照”语义标签，语言标签也不能证明图片一定是宣传画。本轮做的是尺寸、语言和质量排序，不能宣称已经用视觉识别逐图判定；全剧回退也不能保证属于当前季。同剧多季可能使用同一优质横图，来源会明确标注。

## 收藏与系列归类能学什么

Radarr的[MovieCollectionService](https://github.com/Radarr/Radarr/blob/7e3f80c98d01481430ab356f6d7322fc5dc381ee/src/NzbDrone.Core/Movies/Collections/MovieCollectionService.cs)以TMDB合集ID查找/新增合集；[RefreshCollectionService](https://github.com/Radarr/Radarr/blob/7e3f80c98d01481430ab356f6d7322fc5dc381ee/src/NzbDrone.Core/Movies/RefreshCollectionService.cs)按合集刷新成员，并按更新时间决定是否重查。可学习稳定ID与增量更新；不需要引入其下载器、监控缺失影片或服务器架构。

Kometa的[franchise.yml](https://github.com/Kometa-Team/Kometa/blob/cc35af0686967b74ead474277d9eb16119bc888c/defaults/movie/franchise.yml#L74)使用`tmdb_collection`并以`addons`补充衍生系列；[universe.yml](https://github.com/Kometa-Team/Kometa/blob/cc35af0686967b74ead474277d9eb16119bc888c/defaults/both/universe.yml)用维护的规则和外部列表归类宇宙。它不是只比较片名，也不是TMDB自动提供所有电影/剧集的跨媒体关联。

My Cinema现有[franchises.json](../src/shared/data/franchises.json)、[franchises.ts](../src/shared/franchises.ts)已经采用稳定影视ID和手动覆盖，方向一致。本轮保留这些逻辑，没有虚报“新实现了一套影视宇宙算法”。后续适合补充：规则版本与来源、自动归类理由、关系冲突提示，以及发行顺序/故事时间顺序的明确区分；片名匹配只作低置信度补充，不能覆盖已确认ID或用户选择。

## 图片刷新与更多来源

Jellyfin的[ItemImageProvider](https://github.com/jellyfin/jellyfin/blob/8466670e95b5f4f0b55d6353cf9fb3d6123217e3/MediaBrowser.Providers/Manager/ItemImageProvider.cs#L141)按图片类型和替换选项刷新，并在新增多图后再清理旧图；Radarr的[MediaCoverService](https://github.com/Radarr/Radarr/blob/7e3f80c98d01481430ab356f6d7322fc5dc381ee/src/NzbDrone.Core/MediaCover/MediaCoverService.cs#L138)检查来源/本地缓存、失败分项处理、限制缩放并发。Kometa的[library.py](https://github.com/Kometa-Team/Kometa/blob/cc35af0686967b74ead474277d9eb16119bc888c/modules/library.py#L324)比较图片来源，减少重复上传。适用的是增量、失败保护和有界内存；My Cinema已有的缓存/老电视采样继续保留。

MoviePilot的[TMDB scraper](https://github.com/jxxghp/MoviePilot/blob/33cc86e22508894616b6f0741b9b9d8c716c8c20/app/modules/themoviedb/scraper.py#L176)在详情缺图时查询图库回填；[Fanart模块](https://github.com/jxxghp/MoviePilot/blob/33cc86e22508894616b6f0741b9b9d8c716c8c20/app/modules/fanart/__init__.py#L198)区分媒体图/季图并按语言和点赞筛选。其通用`zh`回退不符合本项目“不要繁体海报”的要求；不能原样照搬。

Fanart可作为后续可选图片提供器，但TV需要处理TVDB身份与独立API配置/可用性。本轮没有借用别人的Key、引入NAS依赖或把它标记为已接入；先修复现有TMDB流程。也没有安装这些项目或复制GPL实现到本项目。

## 验证边界

本地类型检查、生产构建和209项测试已通过，覆盖横图回退、缓存范围、跨剧拒绝、手选恢复、重启保留、断网保护，以及镜像保存/超时竞态。实际Windows/API22构建、发布身份与结果见下面的交付记录。真实TMDB账号和长虹55D2S实机仍需单独验收。

## 本轮实际交付

- **Windows1.3.0-beta.3**：[完整发布42979993112](https://github.com/StQuasimodo/Media-Library/actions/runs/42979993112)通过，源码/Tag为`cdb4d70213d02870b1329325a4b5a3a94356f392`，209项测试、类型/构建、非无头且sandbox启用的Windows Electron、旧凭据兼容和实际安装器快捷方式检查通过。真实窗口中验证季图库无横图时使用全剧范围缓存并显示提示；预设/自定义镜像保存均不联网，清除旧超时并显示成功。安装器122950756字节，SHA256`933518454e6bc00912b812cfc095ea16134a6a006d9feb17e0cdb214d6385910`。[下载](https://github.com/StQuasimodo/Media-Library/releases/tag/v1.3.0-beta.3) · [身份/资产记录](../artifacts/releases/v1.3.0-beta.3/validation.json) · [窗口结果](../artifacts/releases/v1.3.0-beta.3/controlled-ui-report.json)。
- **TV0.3.0-alpha.3/code11**：[完整API22构建42979526603](https://github.com/StQuasimodo/Media-Library/actions/runs/42979526603)通过，源码/Tag为`f02b2c523c8c7c4c9188a3627c16e04bb9b6acda`，后续Windows驱动修正和文档不冒充TV构建源码。实际API22 x86验证19项图库/收藏检查、季图库只有海报时的自动全剧横图回退、缓存下载、跨剧拒绝、26项遥控检查/52次按键、三个镜像公网HTTPS验签、完整LibVLC/夸克Range/恢复、备份/500海报/进程及模拟器重启；实际alpha.5原APK→code11同签名升级保留凭据/目录/人工关联/播放进度。[原始报告](../artifacts/releases/tv-v0.3.0-alpha.3/regression-summary.json) · [图片功能](../artifacts/releases/tv-v0.3.0-alpha.3/features-report.json) · [仅季海报的端到端用例](../artifacts/releases/tv-v0.3.0-alpha.3/full-ui.json)。APK48790335字节，SHA256`9f38f8d8e76ac4ea686790b9110871689b54e83b7ad1f1228efc908b94ebc5ac`；固定证书仍为be6ca662…，下载本次构建原APK后独立核对哈希一致。[发布42980593254](https://github.com/StQuasimodo/Media-Library/actions/runs/42980593254)与签名清单任务成功，[下载](https://github.com/StQuasimodo/Media-Library/releases/tag/tv-v0.3.0-alpha.3)。

两端公开预览清单已重新下载并用生产验签器验证，版本、TV code11、大小与安装包哈希均匹配；[验证结果](../artifacts/releases/published-feeds-artwork-2026-11-11.json)。稳定渠道/Latest仍为1.2.0。旧资产和Tag没有覆盖；原数据库/签名/凭据格式保留。

此前失败也保留在Actions：42977599179首次被夸克匿名登录页网络就绪探针阻止；后续受控脚本只模拟预览清单，而Electron测试驱动使用稳定渠道，导致新的超时提示断言失败。修正测试覆盖两种渠道、补充非Node Error形状的超时测试后，完整Windows流程重新通过，未绕过门禁或发布失败包。

截图为受控色块图片，用于验证布局、来源提示和自动路径，不作为真实影视宣传图审美验收。ARMv7原生库已打包并检查包结构，运行回归为API22 x86；ARMv7运行、长虹电视、实体遥控器、真实TMDB/夸克账号及4K硬解仍未验收。
