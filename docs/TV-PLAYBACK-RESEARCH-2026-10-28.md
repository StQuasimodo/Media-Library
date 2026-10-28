# 电视独立连接夸克与播放调研（2026-10-28）

用户本轮确认：家里没有NAS或常开电脑，希望电视独立连接夸克。本轮只调研、讨论，不接入播放代码。现有电视端独立收藏、原生Java界面、minSdk21及API22兼容目标保留；Windows 1.2.0正式发布不包含播放。

建议主线是：**电视本机夸克授权 → 文件ID/季集关联 → 临时播放地址与鉴权请求头 → 内置播放器**。优先验证LibVLC 3.x，Media3 1.8.1作为对照。WebDAV保留为可选来源，不要求用户新增一台网关设备。

## 官方播放实现与实际版本边界

本轮直接读取源码和发布AAR的AndroidManifest，不仅参考项目介绍。结果是依赖兼容性证据，尚未构建播放原型，也未连接用户夸克或电视。

| 候选 | 实际检查 | 对API22目标的意义 |
|---|---|---|
| Android官方Media3/ExoPlayer | [官方设备说明](https://developer.android.com/media/media3/exoplayer/supported-devices)当前音视频基本播放要求API23；[1.9.0更新记录](https://github.com/androidx/media/blob/8c6678b657ede1e7883fc164ef73ed483c7796c3/RELEASENOTES.md#190-2025-12-17)明确将minSdk升为23 | 新版不能直接接入；不能只强行改应用minSdk |
| Media3 1.8.1 | Google Maven的`media3-exoplayer:1.8.1` AAR清单为minSdk21；另核对1.8.0的ExoPlayer/UI清单与源码也为21 | 可保留为旧安卓对照方案；完整依赖、旧分支维护与运行情况还需验证 |
| VideoLAN LibVLC 3.7.7 | Maven AAR清单minSdk17，JNI含armeabi-v7a及x86等；[VLC构建设置](https://github.com/videolan/vlc-android/blob/7c19011e048bcd3f82fefff11d9f922969cecd5d/settings.gradle)也将3.x设为17、4.x设为23 | 适合优先做API22与ARMv7播放原型，应用自身仍保持minSdk21 |

[依赖包检查记录与下载地址](../artifacts/research/2026-10-28/tv-playback/aar-checks.json)。Media3没有原生库不代表不使用系统硬解；LibVLC包含ARMv7库也不代表已在这台电视验证解码。

官方参考：[Media3网络数据源](https://developer.android.com/media/media3/exoplayer/network-stacks)、[格式与系统解码器说明](https://developer.android.com/media/media3/exoplayer/supported-formats)、[VideoLAN Android官方示例](https://code.videolan.org/videolan/libvlc-android-samples)。Media3默认依赖系统解码器；其[FFmpeg扩展](https://github.com/androidx/media/blob/8c6678b657ede1e7883fc164ef73ed483c7796c3/libraries/decoder_ffmpeg/README.md)主要提供音频解码，不能据此宣称所有视频都能软解。LibVLC在容器、音轨、字幕方面更适合作为兼容性优先的候选，但实际内存和芯片表现需测。

## GitHub上与独立直连最相关的实现

### TV Media：适合研究数据流，不能直接搬到API22

[Shield1st/tvmedia-public](https://github.com/Shield1st/tvmedia-public/tree/13d43eda1624bd0b95ed8728c20b2b715c74e669)有实际Android源码。本轮读取了登录、网络请求、凭据、播放器与本机代理实现：

- [QuarkLoginActivity](https://github.com/Shield1st/tvmedia-public/blob/13d43eda1624bd0b95ed8728c20b2b715c74e669/app/src/main/java/com/tvmedia/openlist/ui/auth/QuarkLoginActivity.kt)：WebView加载夸克页面，手机扫码，处理登录弹窗与遥控器焦点。
- [QuarkApiClient](https://github.com/Shield1st/tvmedia-public/blob/13d43eda1624bd0b95ed8728c20b2b715c74e669/app/src/main/java/com/tvmedia/openlist/quark/QuarkApiClient.kt)：列目录、按文件ID获取下载地址、附带Cookie/Referer/User-Agent并处理会话更新。不能把地址当作无需鉴权的永久URL。
- [LocalProxyServer](https://github.com/Shield1st/tvmedia-public/blob/13d43eda1624bd0b95ed8728c20b2b715c74e669/app/src/main/java/com/tvmedia/openlist/proxy/LocalProxyServer.kt)：在电视本机127.0.0.1转接流量，处理Range和请求头，供播放器读取；这类本机适配不需要NAS。

该项目[构建文件](https://github.com/Shield1st/tvmedia-public/blob/13d43eda1624bd0b95ed8728c20b2b715c74e669/app/build.gradle.kts)为minSdk24，不能直接给API22电视安装。源码还用了需要更高API的Java/Android组件，不能只降低数字。其凭据实现加密失败时退回普通preferences，My Cinema应沿用现有API21加密方式并独立保存网盘凭据。项目关于速度、会话长期有效或设备名额的介绍未由本轮账号测试验证，不作为本项目承诺。

### OpenList：参考驱动，区分开放接口与网页登录

[OpenList QuarkOpen驱动](https://github.com/OpenListTeam/OpenList/tree/74320ca6dbde96e546b2e5183bae228a88139bd0/drivers/quark_open)能调用开放接口列目录并获取下载URL，但还需要AppID、签名配置、access/refresh token；默认依赖线上续签服务。[当前续签代码](https://github.com/OpenListTeam/OpenList/blob/74320ca6dbde96e546b2e5183bae228a88139bd0/drivers/quark_open/util.go)的本地续期仍是TODO。因此“有Open驱动”不等于已经找到可直接嵌入、自有应用完全独立授权的官方Android SDK。

[Quark/UC网页驱动](https://github.com/OpenListTeam/OpenList/tree/74320ca6dbde96e546b2e5183bae228a88139bd0/drivers/quark_uc)展示另一条会话和取流路线。My Cinema可借鉴协议分层，保持原生应用架构；无需因此把整套网关服务移到电视。非公开网页接口的变化、会员和服务端返回能力仍需实际验证。

### 官方Skill的可行范围

[夸克官方仓库](https://github.com/quark-clouddrive/quarkclouddrive_offical/tree/a5830d99830c7e8bf46063ca90ac6deb1bbf1f3e)及Skill确有授权、目录、下载能力，但面向Agent与Node.js CLI。本轮未找到可直接用于本项目第三方Android TV应用的公开播放SDK或完整授权接入说明；这不等于认定官方没有其他合作接口。

优先核实自有客户端可使用的官方授权；若采用网页登录路线，先验证API22旧WebView能否加载扫码页、完成登录并持久化。Windows的Chromium登录成功不能代替电视WebView验证。沿用此前决定：不将官方Skill/Node/Agent作为My Cinema电视运行时依赖，也不复用其他项目的应用密钥或令牌。

## 推荐的实现顺序

```mermaid
flowchart LR
    A[电视扫码授权] --> B[夸克目录与文件ID]
    B --> C[关联作品、季集和版本]
    C --> D[临时地址与鉴权请求头]
    D --> E[电视本机数据源适配]
    E --> F[内置播放与遥控器控制]
    F --> G[电视本地续播进度]
```

1. **先证明登录与取流链路。** 使用用户自主授权的会话，读取指定文件夹，选择一部1080p H.264/AAC样片。验证HTTP Range/206、拖动、断线重连、临时URL失效后重新获取与恢复位置。数据库保存稳定文件ID及进度，不把临时URL当永久资源。此阶段不需要完整影片落盘。
2. **对比两种内核后锁定一个。** 优先LibVLC 3.7.7，对照Media3 1.8.1；不先构建复杂双内核系统。检查API22安装/启动、ARMv7包内容、字幕与音轨、CPU、Java/原生内存、缓冲及Surface生命周期。此前收藏界面的64/96MiB堆测试不能直接代表加入播放器后的表现。
3. **接入现有详情页。** 资源/版本/季集选择后播放，保留电影主视觉与原生界面。遥控器确认播放/暂停，左右快进快退，音轨字幕面板、两段返回与焦点恢复；将续播位置按具体文件记录，后续再接下一集与自动连播。收藏、评分和专题不重建。
4. **再补磁盘缓存与可选来源。** 先用有界流式缓冲，测电视可用空间后再做可清理、有配额的本地/外接存储缓存。WebDAV可作为扩展来源，不是用户没有NAS时的必经步骤。

内置播放器可直接使用受控请求头；如需向LibVLC或外部播放器暴露稳定URL，可由电视本机数据源适配或本机代理承接鉴权/地址更新。须处理206、Content-Range和取消，不能假定一个可打开的URL就一定可拖动。代理若采用HTTP，仅绑定回环并使用临时会话标识，不向局域网暴露Cookie。具体方式由取流原型决定，不先引入常驻外部服务。

**老电视能力边界：** minSdk/ABI兼容只证明可安装条件，不证明HEVC、4K、HDR、TrueHD直通或复杂ASS字幕都能流畅运行。首期优先1080p H.264/AAC；其他资源取决于系统MediaCodec与音频能力。若夸克可合法提供云转码，需另验接口与账号权限；否则应选兼容资源版本，不能承诺电视本机完成高质量4K实时转码。

## 是否有媲美PotPlayer的电视播放器

电视上有功能成熟的选择，各有侧重；对本项目应区分现成播放器App与可嵌入的解码库。

| 项目 | 适合什么 | 本轮兼容性核对 |
|---|---|---|
| [VLC Android 3.x](https://www.videolan.org/vlc/download-android.html) | 广泛格式、音轨、字幕与网络播放；老电视优先参考 | 当前3.x源码minSdk17，4.x预览为23；应选正确ARMv7包 |
| [Kodi 21.2 Omega](https://github.com/xbmc/xbmc/blob/21.2-Omega/cmake/platform/android/android.cmake) | 完整家庭影院、影音库与遥控器操作 | 21.2源码minSdk21；当前开发主线为24，不能笼统推荐最新版；相对更重 |
| [mpv-android](https://github.com/mpv-android/mpv-android/blob/3cc4665ed1a38fcaa10b7f400219f21d022d06e9/app/build.gradle) | 高级画质/字幕与参数调整 | 当前源码minSdk23，不能直接满足API22；也不是拿来即可导入的AAR |
| [Just Player](https://github.com/moneytoo/Player/blob/b74285ca8a2fc6cf1ad604e34781a0a07b0384c0/app/build.gradle) | 轻量、遥控器友好的视频播放 | 当前构建minSdk24；README仍写Android6+，按构建文件判断 |
| [Nova](https://github.com/nova-video-player/aos-Video/blob/c4702dc1766a41c3525b16876d750006a702ef36/build.gradle) | 电视影音库、自动资料整理 | 当前6.5.5源码minSdk23；历史兼容版需另行核对 |

若只想选一款现成App给这台API22目标的电视，优先VLC 3.x；想要完整家庭影院再考虑兼容版本Kodi。VLC等负责解码，直接绑定夸克仍需要相应客户端/数据源能力；安装播放器本身不会自动解决账号取流。My Cinema的目标是维持自己的收藏与播放界面，嵌入合适内核。

## 来源、许可与验证范围

[固定仓库版本](../artifacts/research/2026-10-28/tv-playback/sources.json)记录本轮读取的提交。[AAR检查](../artifacts/research/2026-10-28/tv-playback/aar-checks.json)是实际发布包清单/ABI检查，未运行播放器。没有真实夸克登录、视频拖动/字幕测试或长虹实机验收。

TV Media、OpenList采用AGPL；VLC完整应用与LibVLC库的许可证也不同，本轮检查LibVLC 3.7.7的Maven POM为LGPL2.1。当前只研究并引用来源，未复制第三方实现或将其打入My Cinema。后续接入应针对实际库及其组件处理分发要求，不能把仓库介绍或库名称当作兼容/许可结论。
