# 剧集、衍生电影与系列归类

## 为何《浴血黑帮》电影此前独立

此前只有TMDB电影合集和少量显式影视ID规则；不能据此识别任意剧集的衍生电影。电影合集与跨电影/剧集关联是不同的数据关系。本轮不为《浴血黑帮》添加特例，而是增加通用证据推断，电影仍保留电影类型、TMDB身份和资源关联。

## 已查阅项目实际如何使用TMDB

| 项目与固定源码 | 实际做法 | 不能据此承诺的能力 |
|---|---|---|
| [Jellyfin TmdbBoxSetProvider](https://github.com/jellyfin/jellyfin/blob/8466670e95b5f4f0b55d6353cf9fb3d6123217e3/MediaBrowser.Providers/Plugins/Tmdb/BoxSets/TmdbBoxSetProvider.cs) | 根据合集ID调用GetCollectionAsync；无ID时搜索合集 | 不是任意剧集/衍生电影的自动关系接口 |
| [Radarr RefreshCollectionService](https://github.com/Radarr/Radarr/blob/7e3f80c98d01481430ab356f6d7322fc5dc381ee/src/NzbDrone.Core/Movies/RefreshCollectionService.cs) | 按TMDB合集ID同步电影成员，并保留独立电影记录 | 不提供跨电视剧和电影的通用衍生识别 |
| [Kometa franchise.yml](https://github.com/Kometa-Team/Kometa/blob/cc35af0686967b74ead474277d9eb16119bc888c/defaults/movie/franchise.yml#L74) / [universe.yml](https://github.com/Kometa-Team/Kometa/blob/cc35af0686967b74ead474277d9eb16119bc888c/defaults/both/universe.yml) | 电影系列基于tmdb_collection，衍生系列用addons补充；宇宙用外部列表和维护规则 | 不是单靠TMDB自动发现所有影视宇宙 |

因此不能把“采用这些项目的方法”描述成已解决全部跨媒体归类。下面的证据推断是My Cinema新增的实现，不声称是TMDB官方提供的关联结论。[前次源码调研与来源索引](OPEN-SOURCE-ARTWORK-COLLECTIONS-2026-11-11.md)。

## 当前算法

优先级为：用户手动归属/排除 → 明确影视ID与合集ID关系 → 高置信度跨媒体推断 → 原电影合集或剧集系列 → 独立作品。TMDB电影不会只因片名相近或数字后缀而自动并入其他作品。

推断只针对本机已收藏的TMDB剧集与电影，不扫描网盘视频内容，也不搜索整张互联网影视关系图。剧集各季按同一个TMDB剧集ID合并为判断目标。

导入/刷新详情使用`append_to_response=credits,keywords`获取公开资料，记录前20名演员ID、创作者/编剧/导演ID和关键词。优先使用中英文完整名称锚点，以标点、大小写和季号规范化后的短语比较，不使用宽泛的文字相似度。主演和主创比较稳定人物ID，不按中文译名猜同一个人。

| 判断路径 | 必需证据 |
|---|---|
| 电影名包含明确剧名 | 名称锚点；至少两位共同主演，或一位共同主演加共同主创/明确衍生标记；综合评分达到门槛 |
| 电影名不含剧名 | 明确的电视剧衍生/改编标记；至少三位共同主演；至少一位共同创作者 |
| 多个候选剧集 | 最高分必须明确领先；否则保持独立，不随API返回顺序选一个 |

评分是可测试的启发规则：不同名称锚点最多2项、每项20分；共同主演最多3项、每项20分；存在共同主创加25分；存在明确衍生标记加25分。至少70分，第一/第二候选差至少15分。门槛不代表统计意义上的概率或100%正确。

同名重拍但主演不同、只有演员相同、只有片名相似、重复人物ID、过短泛词，以及候选歧义都有反例测试。关键词中的普通题材、动画或“同一导演”都不能单独触发合并。名称不含剧名的路线优先检查缓存中的明确衍生标记，避免对所有旧电影逐个发出额外网络请求。

## 数据和交互

- 自动结果存为现有系列JSON中的`relatedTv`，附目标剧集ID、证据和算法版本；手动整理仍存`franchise`，优先覆盖自动结果，包括明确排除。原电影合集ID和作品ID不改写。
- 公开演职员证据缓存为`relationshipHints`；没有独立电影合集时，内部作品标识仅承载缓存，不在用户界面冒充一个电影系列。复用原SQLite JSON字段，不增加数据库迁移。
- Windows在影视库后台补充关系，最多两个工作任务；TV使用独立单线程，界面与播放器不等待关系查询。任务合并、关闭取消、查询前后元数据版本和手动选择检查，防止过期结果覆盖新操作。
- 网络失败、缺失/不完整的演职员响应保留已有判断；正常资料刷新和重启保留自动关系与手动选择。不同剧集ID的同名作品不会仅靠名称覆盖已确认身份。
- 详情显示“由片名与演职员信息推断”，供用户识别和手动调整，不把推断标成官方关系。

旧收藏点击影视库一键刷新，补齐演职员资料后回到影视库等待后台整理。新导入会带上证据，无需为《浴血黑帮》另点一个专用匹配入口。资源仍关联原电影记录，不转成电视剧集或移动网盘文件。

资料缺失、别名未收录、演员/主创缺乏重合或复杂跨宇宙作品仍可能保持独立。当前没有完整的全球衍生关系库，不能保证每部作品都自动识别；用户可用现有整理文件夹功能合并或排除。

## 同期背景修复

本季横图优先。全剧回退在尺寸合格、质量接近最佳候选的图片中按季稳定分配；先去重、排除低清/明显差图，并按评分/图片标识稳定排序。正常S1/S2/S3分别选择不同候选，特别篇优先末位候选；不足时复用，不用海报或单集截图硬凑差异。

这提供浏览差异，不证明图片属于该季；界面标注“全剧图库按季分配 · 季份未标注”。图库、评分或候选变化时刷新可能重新选择；同一图库的接口顺序、单季/乱序导入不会改变分配。手选锁定继续保留。[完整图片规则](ARTWORK.md)。

## 测试与限制

本地234项测试、生产构建、全部Java/仪器测试源码编译已通过。两端共用[正反例数据](../tests/fixtures/related-tv-cases.json)，覆盖《浴血黑帮》《续命之徒》《X档案》《冲出宁静号》及误合并反例，人物ID为受控测试值。

Windows/API22回归额外验证三个无横图的季实际使用不同图片字节/解码像素，以及独立电影自动加入剧集文件夹；实际结果以发布后的产物记录为准。回归中的电影ID900001和演员ID是受控值，不冒充真实TMDB账号在线验收。长虹电视与用户真实账号仍需单独验收。

## 本轮交付（2026-11-11）

两端应用与测试均来自`335a73b9647f4fc21697f6021acfd973683aa659`；后续文档不冒充构建源码，包名/签名/数据库版本没有更换。

| 平台 | 实际流程 | 产物 |
|---|---|---|
| Windows1.3.0-beta.4 | [42996408934](https://github.com/StQuasimodo/Media-Library/actions/runs/42996408934)通过：234项测试、构建、真实Windows Electron（非无头、sandbox开启）、34/64项窗口检查、旧凭据兼容和实际安装器6项检查 | [下载](https://github.com/StQuasimodo/Media-Library/releases/tag/v1.3.0-beta.4) · [身份与资产](../artifacts/releases/v1.3.0-beta.4/validation.json) · [实际UI结果](../artifacts/releases/v1.3.0-beta.4/controlled-ui-report.json) |
| TV0.3.0-alpha.4/code12 | [完整API22构建42996413849](https://github.com/StQuasimodo/Media-Library/actions/runs/42996413849)通过：38项图片/归类检查（含两端共用10个关系样本）、26项遥控检查、3个公开镜像HTTPS验签、真实1080p解码/90秒取流、备份/500海报/进程及模拟器内核重启、alpha.5原APK同签名升级 | [发布42997572706](https://github.com/StQuasimodo/Media-Library/actions/runs/42997572706)通过 · [下载](https://github.com/StQuasimodo/Media-Library/releases/tag/tv-v0.3.0-alpha.4) · [身份](../artifacts/releases/tv-v0.3.0-alpha.4/BUILD.json) · [完整UI结果](../artifacts/releases/tv-v0.3.0-alpha.4/full-ui.json) |

Windows实际窗口验证了自动文件夹与推断来源提示；API22通过生产后台任务验证附加演职员资料、自动关联及原收藏保留。分季图同时比较实际字节/解码像素，不以路径不同替代图片不同。[Windows文件夹截图](../artifacts/releases/v1.3.0-beta.4/inferred-tv-film-folder.png) · [推断说明截图](../artifacts/releases/v1.3.0-beta.4/inferred-film-provenance.png) · [季1](../artifacts/releases/v1.3.0-beta.4/season-1-fixture.png) · [季2](../artifacts/releases/v1.3.0-beta.4/season-2-fixture.png) · [季3](../artifacts/releases/v1.3.0-beta.4/season-3-fixture.png)。截图为受控色块，不作真实物料审美验收。

Windows安装器122954129字节，SHA256`78b76ffb7ceab8669f9d8533806b52bc65ca5688cc074326e29d148b95a0dbf5`。APK48797575字节，SHA256`337292ab92a4549a45ef997591ec3027c3cd7d392cef15632aee1ff9057881cc`，已下载构建原包独立核对；固定证书仍为be6ca662…，ARMv7/x86打包检查通过，运行验收为API22 x86。实体长虹电视、ARMv7运行、真实TMDB/夸克账号及4K原盘未代验收。

两端公开预览清单已下载并用生产验签器验证版本、code12、大小/哈希一致：[清单记录](../artifacts/releases/published-feeds-relations-2026-11-11.json)。Latest/稳定渠道仍为1.2.0，旧版本资产未覆盖。早期准备包在发布前取消，以补充特别篇边界及用户明确要求的通用关系层；最终仅发布上述源码和产物。
