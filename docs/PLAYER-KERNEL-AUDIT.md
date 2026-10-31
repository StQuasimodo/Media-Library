# Android TV 播放器内核审计（第一轮：PoC 选型与差距）

审计日期：2026-10-31 · 目标：PotPlayer 级播放能力 · 阶段：**只做内核 PoC 与差距报告，不改正式播放器**

## 0. 结论摘要

1. **LibVLC 3.7.7 做不到「主副字幕同时显示」。** 这不是配置问题：Java API 只有单条 SPU 选择器（`setSpuTrack(int)`），原生符号表里也只有 `libvlc_video_get_spu / set_spu / get_spu_count / get_spu_description / set_spu_delay`，**没有任何 secondary 字幕概念**（已对真实 AAR 展开核对，见 §2.1）。
2. **mpv 原生支持双字幕**：`--secondary-sid` 会把第二条字幕渲染为 toptitle，另有 `--secondary-sub-pos`、`--secondary-sub-delay`、`--secondary-sub-ass-override` 可独立控制位置与延迟。这是 mpv 相对 LibVLC 的**决定性优势**。
3. **但 mpv-android 上游 minSdk = 23**，高于目标 API 22；且不发布 AAR，需要 NDK 自建 libmpv 并降到 21/22。这是 mpv 路线的主要成本与风险。
4. **本机没有 Android 工具链**（无 JDK、无 SDK、无 adb/模拟器、无 gradle），Maven / dl.google.com / Gradle / Adoptium 均可访问。因此本轮 **无法在本机完成构建、安装与双字幕 PoC**；可执行通道是仓库已有的 GitHub Actions（API 22 模拟器，最近一次 `Android TV API 22 preview #31` 成功）。
5. 建议：**并行做两个 PoC**——LibVLC 能力补齐（便宜，验证外挂字幕/ASS/硬解回退/逐帧）+ libmpv 最小可行验证（昂贵但决定双字幕是否可交付）。PoC 通过前不替换正式播放器。

## 1. 现有工程事实（代码层）

| 模块 | 现状 |
|---|---|
| `PlayerActivity` | 单解码器实例；控制项只有 暂停/播放、±10 秒、音轨/字幕、重新连接、退出；遥控器 左右/确认/菜单 |
| `PlaybackController` | LibVLC 生命周期、`--network-caching=1500`、`media.setHWDecoderEnabled(true,false)`、续播定位、缓冲/暂停/结束/错误状态机、进度落库 |
| `MediaSources` | 只读源解析；夸克 Cookie 存在 `SecretStore`，**不进入媒体记录与播放 Intent** |
| `PlaybackRelay` | 127.0.0.1 回环 HTTP/WebDAV，随机 token + Basic 认证，只允许 GET/HEAD/OPTIONS/PROPFIND，DAV 会话绑定到单个文件 |
| `MediaTransfer` | Range 分段、上游重试、断流恢复、`recoveries/segments` 指标 |
| `QuarkDavManager` / `QuarkDavTree` | 夸克目录 → 电视本机只读 WebDAV |
| 现有 instrumentation | `PlaybackScenario`：合成 1080p H.264/AAC、解码统计（decodedVideo/displayedPictures/decodedAudio）、2 条音轨、1 条内嵌字幕、定位 20s、Activity 重建续播；`QuarkDavScenario`：WebDAV OPTIONS/PROPFIND/GET/HEAD 与网关重启 |

结论：**取流链路与收藏数据层是资产，必须保留**；播放器内核是可替换层。

## 2. 能力证据（可复现）

### 2.1 LibVLC 3.7.7（`org.videolan.android:libvlc-all:3.7.7`，AAR 88.3 MB）

ABI：`arm64-v8a`、`armeabi-v7a`、`x86`、`x86_64`（与本项目 `abiFilters armeabi-v7a, x86` 匹配）。

原生库（`jni/armeabi-v7a/libvlc.so`，38.0 MB）实测：

| 能力 | 证据 | 结论 |
|---|---|---|
| ASS/SSA 渲染 | `ass_renderer_init`、`ass_set_fonts`、`ass_read_memory` 符号存在 | **编译进内核** |
| 文本字幕解码 | `subsdec` 存在 | 支持 |
| 字幕字号/延迟/编码 | `sub-text-scale`、`sub-delay`、`sub-fps`、`sub-autodetect`、`subsdec-encoding` 字符串存在 | 可通过选项设置（**全局**，非按轨） |
| 单字幕轨选择 | `libvlc_video_get_spu / set_spu / get_spu_count / get_spu_description` | 支持 |
| 外挂字幕 | `libvlc_media_player_add_slave`、`libvlc_video_set_subtitle_file` | 原生支持（Java 侧 `addSlave` 存在） |
| **双字幕** | 无 `secondary` 相关符号；`set_spu` 只接受单 id | **不支持** |
| 逐帧 | 原生 `libvlc_media_player_next_frame` 存在，**Java 无绑定** | 需自写 JNI |
| 画面比例/缩放/裁切 | `set_aspect_ratio`、`set_scale`、`set_crop_geometry`、`set_adjust_int` | 原生支持（Java 有 `setAspectRatio`/`setVideoScale`，裁切需 JNI） |
| 章节 | `get_chapter_count`、`set_chapter` | 原生支持（Java 有 `getChapter/setChapter`，`getChapterCount` 缺） |
| 音频延迟 / 均衡器 | `audio_set_delay`、`setEqualizer` | 支持 |
| 硬解开关 | `Media.setHWDecoderEnabled` | 支持开关，**回退需业务层自行判断** |

Java API 实测存在：`setSpuTrack/getSpuTracks/setSpuDelay/addSlave/setAudioDelay/setRate/setAspectRatio/setVideoScale/setVideoTrack/getVideoTracks/getChapter/setChapter/setPosition/setEqualizer/setRenderer`；
实测缺失：`nextFrame`、`setCropGeometry`、`getChapterCount`、`getStats`（统计在 `IMedia` 接口层）。
`interfaces` 包存在 `IMedia`（含 `AudioTrack/SubtitleTrack/VideoTrack/Stats/Slave`），即 3.7.7 已有新接口层，但**字幕模型仍是单轨**。

### 2.2 mpv / mpv-android

| 项 | 实测值 |
|---|---|
| mpv-android `app/build.gradle` | `minSdkVersion 23`、`targetSdk 36`、`compileSdk 36`、Gradle 9.2.1、Kotlin 2.2.21 |
| ABI | `armeabi-v7a`、`arm64-v8a`、`x86`、`x86_64`（四者均配置） |
| 双字幕 | `--secondary-sid` 官方文档确认：第二条字幕渲染为 toptitle |
| 副字幕独立控制 | `--secondary-sub-pos`、`--secondary-sub-delay`、`--secondary-sub-ass-override` 文档确认；`--secondary-sub-font-size/-color` 未在该版本文档出现（字号/颜色走全局 `--sub-*`） |
| 分发形态 | **无 AAR**；libmpv 需用 NDK 源码构建（mpv-android/buildscripts） |

### 2.3 执行环境

| 项 | 结果 |
|---|---|
| 本机 JDK / Android SDK / adb / emulator / gradle | **全部缺失** |
| Maven Central / dl.google.com / Gradle 分发 / Adoptium | 均 200 可达 |
| GitHub Actions | 可读：`Android TV API 22 preview` 最近 #31 成功；仓库已有模拟器流水线 |

## 3. 能力矩阵（对照 PotPlayer 目标）

图例：`✅已实现并实测` · `🟡已实现未实测` · `🔵内核/文档支持但项目未接` · `⚠️设备或API限制` · `❌未实现`

| 目标能力 | 现状 | 依据 | 内核缺口 |
|---|---|---|---|
| 播放/暂停/定位/续播 | ✅ | PlaybackScenario 实跑 | — |
| 多音轨选择 | ✅ | 同上（2 条音轨切换） | — |
| 内嵌字幕选择 | ✅ | 同上（1 条内嵌） | — |
| 外挂字幕 | ❌ | 未接 | LibVLC `addSlave` 可用 |
| ASS/SSA 样式渲染 | 🔵 | libass 已编译进 AAR，未做视觉验证 | 需 PoC 截图证明 |
| 主副字幕同时显示 | ❌ | LibVLC 单 SPU 模型 | **LibVLC 无解**；需 mpv 或自绘第二轨 |
| 主副字幕独立位置/样式/延迟 | ❌ | 同上 | mpv `secondary-sub-*` 部分支持 |
| 字幕编码切换（乱码修复） | 🔵 | `subsdec-encoding` 选项存在 | 需 UI + 选项传入 |
| 图像字幕（PGS/VobSub） | ⚠️ | 未验证解码器是否包含 | 需实测 |
| 硬解/软解自动选择与回退 | 🟡 | 仅 `setHWDecoderEnabled(true,false)` 固定开启 | 需按解码失败事件回退并记录真实路径 |
| 显示真实解码路径/分辨率/帧率/码率 | ❌ | 未实现 | LibVLC `IMedia.Stats`/`VideoTrack` 可读 |
| 倍速播放 | 🔵 | `setRate` 存在 | 需 UI |
| 逐帧 | ❌ | Java 无绑定，原生有 | 需 JNI |
| 章节 | 🔵 | `getChapter/setChapter` | 需 UI 与章节探测 |
| A-B 区间循环 | ❌ | 内核无原生 A-B | 业务层轮询实现（两内核皆可） |
| 下一集/自动连播 | ❌ | 未实现 | 业务层 |
| 画面比例/缩放/裁切/旋转 | 🔵 | `setAspectRatio/setVideoScale`；裁切需 JNI | 部分需 JNI |
| 播放信息面板 | ❌ | 未实现 | 依赖统计接口 |
| 遥控器完整操作 | 🟡 | 有 左右/确认/菜单 | 需扩展长按/快进快退档位/字幕音轨直达 |
| 音频延迟/均衡器 | 🔵 | `setAudioDelay/setEqualizer` | 需 UI |
| 夸克取流/断流恢复/续播 | ✅ | QuarkDavScenario + MediaTransfer | 改造时不得破坏 |

## 4. 差距评估

**LibVLC 路线的硬缺口只有一个：双字幕。** 其余目标（外挂字幕、ASS、倍速、章节、逐帧、比例、音频延迟、均衡器、统计）都能通过补齐 Java 绑定/UI 实现。
**mpv 路线补齐双字幕**，代价是：自建 libmpv（NDK/Gradle 9/Kotlin，API21 降级补丁）、包体、1 GiB 内存下的稳定性、以及重写播放器 UI 适配层（VLCVideoLayout → mpv 的 SurfaceView 渲染）。

**若「主副字幕同显」是硬需求（任务书写明目标包含它），LibVLC 单内核无法交付，必须走 mpv 或"LibVLC + 自绘第二字幕轨"两条路之一。** 自绘方案需要外挂 ASS 解析 + 叠加渲染 + 时间轴同步，工作量不低于 mpv 适配，且会引入自有字幕渲染器维护成本。

## 5. PoC 计划（可执行）

本机无工具链，PoC 在 GitHub Actions 的 API 22 模拟器上执行（复用 `android-tv.yml`），产物为截图 + `report.json`。

### P0-A · LibVLC 能力补齐（1–2 天）

| # | 验证项 | 方法 | 通过标准 |
|---|---|---|---|
| A1 | 外挂 SRT/ASS 加载 | `MediaPlayer.addSlave(Media.Slave.Type.Subtitle, uri, true)` 指向 WebDAV 同目录字幕 | 字幕显示，截图可见 |
| A2 | ASS 样式保真 | 播放带样式的 ASS，截图对比位置/字体/颜色 | 样式生效，非纯文本 |
| A3 | 双字幕可行性 | 依次设两条 SPU 轨，观察是否互斥 | 记录"互斥/仅一条"结论 |
| A4 | 硬解 → 软解回退 | 先 `setHWDecoderEnabled(true,true)`，制造解码失败后重建为 `false`，读 `IMedia.Stats` | 回退后能继续播放并记录真实路径 |
| A5 | 逐帧 | JNI 调 `libvlc_media_player_next_frame` | 单帧前进且画面更新 |
| A6 | 统计面板数据 | 读 `VideoTrack`（宽高/帧率）+ `Stats`（解码/显示帧） | 数据与文件属性一致 |
| A7 | 图像字幕 | VobSub/PGS 样本 | 记录支持/不支持 |

### P0-B · libmpv 最小可行（3–5 天，决定选型）

| # | 验证项 | 方法 | 通过标准 |
|---|---|---|---|
| B1 | API22 可安装 | 自建 libmpv（minSdk 21）+ 最小 Activity，`assembleDebug` 后装 API22 x86 | 安装并启动不崩 |
| B2 | ARMv7 原生库 | 同一构建产出 `armeabi-v7a` so，`ndk` 检查符号 | so 可加载（模拟器用 x86 验证逻辑，v7a 仅构建验证） |
| B3 | 1080p H.264/AAC | 复用现有合成样本 | 解码/显示/声音正常 |
| B4 | 双字幕 | `--secondary-sid=2` + 两条 SRT/ASS | **同屏两条**，位置/延迟独立可调 |
| B5 | 定位/暂停恢复 | `seek` + pause/resume | 时钟推进、画面更新 |
| B6 | 与夸克链路对接 | 播放 `http://127.0.0.1:<port>` + Basic 头 | 通过回环网关正常取流 |

### 决策门槛

- B4 通过且 B1/B6 稳定 → 采用 mpv，进入迁移设计。
- B4 通过但 B1/B6 不稳定（内存/API22 兼容）→ 保留 LibVLC，双字幕降级为「主字幕 + 自绘副字幕」备选方案再做评估。
- B4 不通过 → 维持 LibVLC，按 §3 补齐其余能力。

## 6. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| libmpv 在 API22/ARMv7 上不稳定 | 播放器不可用 | 先在模拟器压测 90 分钟 + 断流恢复，再上实机 |
| 1 GiB 内存下的软解 10-bit/HEVC | 卡顿/被杀 | 测试矩阵覆盖，硬解优先，超限拒绝并提示 |
| 自建 libmpv 的构建链（NDK/Gradle 9） | 维护成本 | 固定构建镜像与版本，CI 缓存 ndk |
| 双字幕 UI 复杂度 | 交互回归 | 复用现有遥控器焦点模型，先做面板再做快捷键 |
| 改造破坏夸克网关 | 播放全挂 | 保留 `PlaybackRelay/MediaTransfer` 接口，仅替换内核适配层 |

## 7. 本轮明确未验证

- 真实长虹电视、真实夸克账号、真实 TMDB Key。
- HEVC/10-bit/MPEG-2/VP9、多声道 AC3/DTS、PGS/VobSub 的实际解码。
- 硬解/软解在真实 GPU 上的切换效果与功耗。
- libmpv 的任何构建与运行（本机无工具链，尚未执行）。

以上均为**未验收**，不以本文档或模拟器结果替代。
