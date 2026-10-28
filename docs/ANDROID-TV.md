# My Cinema 电视端

电视端按2026-10-27确认的方向独立管理收藏，不依赖Windows在线或云端数据库。当前为原生Android开发预览，源码在[android-tv](../android-tv)，保留Windows工程与数据结构。是否完成构建和实机验证，以本文末尾的交付记录为准。

## 兼容目标

用户提供的[电视交接对话](https://chatgpt.com/share/6ae05284-fab0-83ec-9a2b-824a8f816dec)记录：长虹55D2S、Hi3751V553、Android 5.1.1 / API 22、32位armeabi-v7a。交接记录曾有Android4.4等推测，较新的二进制取证摘要明确写为API22；本轮以该摘要为目标，没有连接用户电视或重新取证固件。

2026-10-27用户另附照片，直接可见55D2S系列、`ZLH85Gi-V1.00144-EMMC`、编译时间`2026-07-24 19:08:09`、TVOS版本30及TCON `V1.0-CEDS-55-20180801-V553`。照片没有显示Android版本、内存或CPU ABI；TVOS 30不能据此认定为Android API30。API22/armeabi-v7a仍属于交接记录中的兼容目标，未由这张照片独立确认。不归档照片中的MAC、条码等设备标识。

- minSdk **21**，targetSdk 35；单APK、**v1签名**。当前纯Java与平台组件，无`.so`，适用于32位ARM，不需要64位系统。
- 不使用系统WebView、Electron或要求API23+的界面框架。原生视图、SQLite、HTTPS、Android Keystore均按API21设计。
- 深色令牌沿用Windows版；首页宽幅主视觉与横向海报、焦点联动、独立季背景、详情、专题、想看与设置按遥控器操作。
- 返回键退回应用内上一页，首页返回询问退出；不接管Home键、不改默认桌面、不要求ADB或刷机。
- 图片后台下载/采样解码，位图内存缓存上限8MiB，海报墙复用单元格，首页轨道最多24部。后续视频缓存会单独设置空间配额。

## 首个预览的范围

- 电视独立配置TMDB Key / Read Access Token；验证后加密保存。API21/22使用Keystore RSA包裹随机AES/HMAC密钥，不退回明文。凭据不可读时保留文件并提示重新配置。
- 电影/剧集搜索、资料确认、选择单季/多季或整剧、手动建档、图片缓存；复用`<seriesId>:season:<N>`身份与电影/电视剧隔离规则。alpha.3起背景改为高清横版图库变体，海报限定明确简体/大陆地区或英文，替代首张单集剧照规则；详见[图片说明](ARTWORK.md)。
- SQLite本地收藏、个人评分/状态/收藏理由/短评、系列筛选与组内序号排序、自定义专题和资源记录、元数据刷新、删除及本机备份恢复。
- 同一TMDB身份重复导入复用收藏；批量导入部分失败保留完成项，剩余季可重试；刷新不覆盖个人记录与手工系列。
- 本机备份是收藏JSON，图片仍在应用图片目录，TMDB凭据不进入备份。恢复前另存当前收藏，关系校验/事务失败保留原库。卸载会清除应用私有数据；跨设备导出/图片打包后续补齐。

首个预览**尚未等同Windows全部功能**：夸克账号连接/目录自动匹配、跨设备图片包等仍待移植。影视库保留七种排序及年份/状态/系列筛选；开启系列聚合时组内序号优先。首版不播放、不下载视频，不显示没有实现的播放按钮。

## 后续播放阶段

2026-10-28用户确认家里没有NAS或常开电脑，希望电视独立连接夸克。后续主线改为电视直连，WebDAV保留为可选来源；当前只完成[官方与GitHub调研](TV-PLAYBACK-RESEARCH-2026-10-28.md)，尚未接入播放代码。

1. 先核实自有客户端可使用的夸克授权与取流方式，在API22验证电视扫码、目录读取与文件ID关联。官方Skill仍不作为电视运行时依赖；Windows Chromium登录不能代替旧电视WebView验收。
2. 验证1080p H.264/AAC样片的HTTPS、Range拖动、重连、地址过期续接与字幕音轨。优先对比LibVLC 3.7.7与Media3 1.8.1；新版Media3需要API23，不能直接提高最低版本排除旧电视。
3. 接入详情播放、版本/季集选择、电视本地进度与续播，再做下一集及可选自动连播。保留现有收藏界面和业务，账号/取流与解码分开。
4. 先使用有界流式缓冲，再测空间做有配额、可恢复和可清理的磁盘缓存；WebDAV后续可选，不要求新增外部网关。
5. 检查Hi3751V553实际MediaCodec与音频能力。minSdk兼容不等于HEVC/4K/HDR、TrueHD直通或复杂字幕都能流畅播放。优先选择兼容资源；夸克云转码须另验接口与账号能力，不承诺电视本地4K实时转码。

## 构建与验证

JDK17、Android SDK35、build-tools35.0.0；Gradle8.11.1 Wrapper与分发SHA-256已固定。无第三方Android运行时依赖。

```bash
cd android-tv
./gradlew lintDebug assembleDebug assembleDebugAndroidTest
```

[Android TV API 22 preview工作流](../.github/workflows/android-tv.yml)构建后核对minSdk、v1签名、DEX035与无原生库；随后在API22 x86模拟器安装应用和独立测试APK，运行SQLite、Keystore与遥控器界面验证。测试数据只在测试APK中，正式应用首次启动为空收藏。模拟器通过不等于长虹固件、遥控器、中文输入法、真实网络/TMDB和解码已经验收。

当前交付为`0.1.0-alpha.3` **debug开发预览**，签名沿用alpha.2，支持从alpha.2覆盖升级。alpha.1默认Keystore未被成功缓存，其签名无法恢复；**alpha.2及后续不能直接覆盖alpha.1**。alpha.1已有收藏时请保留原安装，不要直接卸载；卸载会同时清除本机备份。开发签名不是生产签名。

alpha.2显式使用CI路径`~/.android/mycinema-tv-debug.keystore`，由独立准备任务共享；[固定公开证书指纹](../android-tv/development-signing.sha256)为`0e343d7d8d91f931b0350b7c01f87115f2fc7daf6402c0baee8276ced4a9bd44`，缓存缺失时拒绝生成替代签名。缓存不是永久签名托管；进入长期使用的beta前须配置固定的私有发布签名及备份，并补齐可导出备份。不要用开发签名作为长期正式发行方案。

## 交付记录

2026-10-27：[0.1.0-alpha.3开发预览](https://github.com/StQuasimodo/Media-Library/releases/tag/tv-v0.1.0-alpha.3)，[直接下载APK](https://github.com/StQuasimodo/Media-Library/releases/download/tv-v0.1.0-alpha.3/My-Cinema-TV-0.1.0-alpha.3-debug.apk)。构建源码`e6ddcafa9283043d918f43cc08e2d1affcbf1fc9`，1,411,567字节，SHA-256 `83e074cba861a3dae1456a1763cee469e737b02f5c7f4a7df2424ce2b93e8bff`。[原始构建及完整API22验证](https://github.com/StQuasimodo/Media-Library/actions/runs/40527056050)通过，发布后下载三个资产均与原产物逐字节一致。使用同剧高清横版图库及简体/英文海报筛选；已有收藏通过刷新换图，来源语言不明确时回退英文。[选图规则](ARTWORK.md) · [公开产物检查](../artifacts/releases/tv-v0.1.0-alpha.3/public-assets.json)。

[720p/96MiB与1080p/64MiB矩阵](https://github.com/StQuasimodo/Media-Library/actions/runs/40527516571)均通过，所测APK与公开版本哈希相同。720p首次模拟器重启时失联，单独重试后通过；RAM均1GiB，没有验证512MiB整机RAM。[本轮完整报告](ARTWORK-VALIDATION-2026-10-27.md)。

2026-10-27：[0.1.0-alpha.2开发预览](https://github.com/StQuasimodo/Media-Library/releases/tag/tv-v0.1.0-alpha.2)，[直接下载APK](https://github.com/StQuasimodo/Media-Library/releases/download/tv-v0.1.0-alpha.2/My-Cinema-TV-0.1.0-alpha.2-debug.apk)。原始构建源码`0fbd2f9a1a1607fd2ca939bfe6383ca3ce762d65`，1,408,770字节，SHA-256 `ad849e0631b3ae1aa9ed1ce3479c9b3b10d086c50116aaadaeb5cf97a983118a`。公开下载的三个资产与保留产物逐字节一致。

[构建及基线验证](https://github.com/StQuasimodo/Media-Library/actions/runs/40479193401)、[720p/1080p最终回归](https://github.com/StQuasimodo/Media-Library/actions/runs/40481063751)通过。两个配置均为API22、1GiB RAM，实际应用堆上限分别96/64MiB；504条收藏、500个不同图片缓存键、九组界面业务、杀进程与内核重启后的持久化通过。矩阵APK与交付APK哈希相同。受控HTTPS服务完成成功导入链路，真实公共API仅验证无效Key的401，未使用真实账号。[详细验证与边界](TV-VALIDATION-2026-10-27.md) · [交付摘要](../artifacts/releases/tv-v0.1.0-alpha.2/summary.json) · [截图](GALLERY.md)。

本轮修复季选择后焦点丢失、专题删除后编辑框残留及开发签名缓存路径；没有变更Windows版本或数据结构。512MiB整机RAM未验证，模拟器参数曾被自动提升，不能宣称已覆盖。

以下为alpha.1历史交付记录，保留原始来源与哈希：

2026-10-27：[0.1.0-alpha.1开发预览](https://github.com/StQuasimodo/Media-Library/releases/tag/tv-v0.1.0-alpha.1)，[直接下载APK](https://github.com/StQuasimodo/Media-Library/releases/download/tv-v0.1.0-alpha.1/My-Cinema-TV-0.1.0-alpha.1-debug.apk)。构建源码`9725ff7bb83e46342843b543a48f5db7bc82f3bb`，原始APK为1,408,352字节，SHA-256 `6e204ffbc5ded844b4c5790834960427ed4257fac7e6849e2b8cf88176568e11`。

[完整构建/API22验证](https://github.com/StQuasimodo/Media-Library/actions/runs/40472208972)通过：Lint为0错误/6项警告，APK签名/DEX/兼容声明检查、API22真实Keystore与SQLite重开、受控TMDB语义、遥控器焦点/确认/返回及各主页面检查均通过。真实TMDB HTTPS请求收到无效测试Key的401响应，证明该模拟器能到达API；不等于真实Key成功搜索导入。

首次初始化因已移除的SDK tools包中断；后续修复API22虚拟尺寸截图限制、触摸模式的初始焦点及全屏/详情焦点。早期通过的构建未作为本次交付来源，最终以以上固定源码和原始产物为准。截图来自API22模拟器，使用受控收藏、占位海报及合成背景；APK本身不含这些数据。[界面预览](GALLERY.md) · [构建身份](../artifacts/releases/tv-v0.1.0-alpha.1/BUILD.json) · [模拟器报告](../artifacts/releases/tv-v0.1.0-alpha.1/emulator-report.json) · [真实401报告](../artifacts/releases/tv-v0.1.0-alpha.1/network-report.json)。

用户交接中的安装通道为 **信号源 → 媒体中心 → U盘 → APK**。首次安装后，在「设置」独立配置TMDB，回到影视库「添加作品」；剧集选择季后导入。方向键选择、确认进入、返回退回浏览，首页返回询问退出。

待长虹实机验收：原厂安装器、中文输入法、遥控器/overscan、真实Key导入与缓存、真实电视重启后的持久化，以及后续媒体解码。模拟器杀进程与内核重启检查已在alpha.2通过。测试没有连接或修改用户电视。开发签名和本机备份的限制见上文，长期beta使用前须补齐固定发布签名与可导出备份。

参考：[Android TV遥控器导航](https://developer.android.com/training/tv/start/navigation)、[播放器设备与版本支持](https://developer.android.com/media/media3/exoplayer/supported-devices)。播放器依赖以接入时的具体版本及其manifest为准，不预先承诺最新版支持API21。
