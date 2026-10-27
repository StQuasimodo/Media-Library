# My Cinema 电视端

电视端按2026-10-27确认的方向独立管理收藏，不依赖Windows在线或云端数据库。当前为原生Android开发预览，源码在[android-tv](../android-tv)，保留Windows工程与数据结构。是否完成构建和实机验证，以本文末尾的交付记录为准。

## 兼容目标

用户提供的[电视交接对话](https://chatgpt.com/share/6ae05284-fab0-83ec-9a2b-824a8f816dec)记录：长虹55D2S、Hi3751V553、Android 5.1.1 / API 22、32位armeabi-v7a。交接记录曾有Android4.4等推测，较新的二进制取证摘要明确写为API22；本轮以该摘要为目标，没有连接用户电视或重新取证固件。

- minSdk **21**，targetSdk 35；单APK、**v1签名**。当前纯Java与平台组件，无`.so`，适用于32位ARM，不需要64位系统。
- 不使用系统WebView、Electron或要求API23+的界面框架。原生视图、SQLite、HTTPS、Android Keystore均按API21设计。
- 深色令牌沿用Windows版；首页宽幅主视觉与横向海报、焦点联动、独立季背景、详情、专题、想看与设置按遥控器操作。
- 返回键退回应用内上一页，首页返回询问退出；不接管Home键、不改默认桌面、不要求ADB或刷机。
- 图片后台下载/采样解码，位图内存缓存上限8MiB，海报墙复用单元格，首页轨道最多24部。后续视频缓存会单独设置空间配额。

## 首个预览的范围

- 电视独立配置TMDB Key / Read Access Token；验证后加密保存。API21/22使用Keystore RSA包裹随机AES/HMAC密钥，不退回明文。凭据不可读时保留文件并提示重新配置。
- 电影/剧集搜索、资料确认、选择单季/多季或整剧、手动建档、图片缓存；复用`<seriesId>:season:<N>`身份与电影/电视剧隔离规则。季背景取本季单集剧照，缺失则使用本季海报。
- SQLite本地收藏、个人评分/状态/收藏理由/短评、系列筛选与组内序号排序、自定义专题和资源记录、元数据刷新、删除及本机备份恢复。
- 同一TMDB身份重复导入复用收藏；批量导入部分失败保留完成项，剩余季可重试；刷新不覆盖个人记录与手工系列。
- 本机备份是收藏JSON，图片仍在应用图片目录，TMDB凭据不进入备份。恢复前另存当前收藏，关系校验/事务失败保留原库。卸载会清除应用私有数据；跨设备导出/图片打包后续补齐。

首个预览**尚未等同Windows全部功能**：夸克账号连接/目录自动匹配、跨设备图片包等仍待移植。影视库保留七种排序及年份/状态/系列筛选；开启系列聚合时组内序号优先。首版不播放、不下载视频，不显示没有实现的播放按钮。

## 后续播放阶段

1. 在电视上配置WebDAV地址与授权，读取目录，确认与已有收藏/季集的关联。夸克不应被假定有原生WebDAV，需要实际可用的电脑、NAS或网盘网关提供服务。无需因此引入云端账号系统。
2. 先验证一部1080p H.264/AAC的真实资源，检查HTTPS、Range拖动、重连、授权过期、音轨字幕；再决定合适的API21播放器组件及版本。
3. 增加详情播放、版本/季集选择、进度、续播与下一集。缓存方案包含空间上限、完整性、失败恢复和清理，不把整片下载到内存。
4. 检查Hi3751V553实际MediaCodec能力。minSdk兼容不等于所有HEVC/4K/HDR资源都能流畅播放；需要时通过WebDAV服务侧转码或提供兼容版本。WebDAV本身不负责转码。

## 构建与验证

JDK17、Android SDK35、build-tools35.0.0；Gradle8.11.1 Wrapper与分发SHA-256已固定。无第三方Android运行时依赖。

```bash
cd android-tv
./gradlew lintDebug assembleDebug assembleDebugAndroidTest
```

[Android TV API 22 preview工作流](../.github/workflows/android-tv.yml)构建后核对minSdk、v1签名、DEX035与无原生库；随后在API22 x86模拟器安装应用和独立测试APK，运行SQLite、Keystore与遥控器界面验证。测试数据只在测试APK中，正式应用首次启动为空收藏。模拟器通过不等于长虹固件、遥控器、中文输入法、真实网络/TMDB和解码已经验收。

初期交付为`0.1.0-alpha.1` **debug开发预览**，签名有效但不是生产签名。工作流缓存开发签名以便连续测试，缓存不是永久签名托管；进入长期使用的beta前须配置固定的私有发布签名及备份，不能承诺更换签名后覆盖升级。不要用开发签名作为长期正式发行方案。

## 交付记录

开发中，尚未记录APK构建/API22模拟器成功或长虹实机验证结果。

参考：[Android TV遥控器导航](https://developer.android.com/training/tv/start/navigation)、[播放器设备与版本支持](https://developer.android.com/media/media3/exoplayer/supported-devices)。播放器依赖以接入时的具体版本及其manifest为准，不预先承诺最新版支持API21。
