# 夸克云端播放能力检查

本文记录 alpha.6 只读阶段的历史验收。alpha.7 增加的手动 HLS 试播、独立进度及边界见 [HLS PoC](TV-QUARK-HLS-POC.md)；以下旧阶段的 `cloudPlaybackVerified=false` 不代表新阶段已验证或未验证。

TV开发版 `0.3.0-alpha.6` / code14。承接[请求调度与地址生命周期](TV-QUARK-STREAM-LIFECYCLE.md)，先接通云端版本能力检查，尚未切换播放源。

## 使用

连接夸克并选择影视文件夹，进入视频文件的操作菜单，选择「检查云端播放版本」。列表展示服务端档位、标称像素尺寸与准备状态；选中后查看视频编码、帧率、码率、音频编码和声道，以及 HLS／fMP4／MP4 协议。

资料标注为服务端报告，不等同于解码器实测。例如服务端档位为4k、尺寸却为1920×1080时同时展示两者，不用档位推导尺寸。缺失或异常字段显示未标注，不凭文件名补造。账号不可用、未完成、缺少地址等状态分别显示；缺少整个版本列表则作为响应异常，不冒充没有版本。

此入口目前用于检查，不能点击后假装已播放云端版本。原文件播放、人工关联、进度与数据库结构保持原样。

## 链路与隐私

`MediaSources.cloudVersions` 先核对文件属于当前挂载范围，再通过既有加密会话请求 `/file/v2/play/project`。请求列出所需档位与 `fmp4_av,m3u8` 格式，沿用同一夸克请求队列、冷却和取消范围。不会改名、移动、转存或删除云端文件，也不请求视频数据。

`QuarkCloudVersions` 解析有界候选，校验地址格式以辅助识别协议后丢弃URL，仅返回不可变的安全摘要；不将地址放入Intent、数据库、备份、UI或日志。检查失败保留原文件入口和登录配置。请求格式参考[OpenList Quark 驱动](https://github.com/OpenListTeam/OpenList/blob/25da9901f50fecc6cb417193680f0f3cfe2ffcdd/drivers/quark_uc/util.go#L139)与[响应字段](https://github.com/OpenListTeam/OpenList/blob/25da9901f50fecc6cb417193680f0f3cfe2ffcdd/drivers/quark_uc/types.go#L140)，不是夸克独立应用官方SDK承诺。

## 验证计划与当前边界

新增共享 JVM／API22 的19项元数据检查，以及真实应用API适配和原生菜单的协议夹具回归。夹具覆盖HLS、fMP4、未就绪、权限不足、空列表、越过挂载范围拒绝，以及查询不发生视频取流、不写入地址、不改变已有进度。

本地19项云端摘要检查、Java主程序／instrumentation编译、现有234项业务测试通过。[构建与API22完整回归43390405180](https://github.com/StQuasimodo/Media-Library/actions/runs/43390405180)的第2次尝试通过，构建源码为 `5bf74c61238e67242f5d4b5147e8b633b976de49`。Gradle／Lint、固定签名、API21/v1与ARMv7/x86打包检查通过；API22/x86执行74项功能检查（含新增19项），真实原生入口与API适配验证通过，原文件90秒播放、Range／换链、定位／续播、备份／升级与进程／模拟器重启回归通过。

已下载APK并核对BUILD、实际所测APK和下载字节哈希一致：SHA256 `1853dccccdceea44ed3fd6416974a27bb8b1cddc6437f3b84e3fde89537fc692`，48,804,092字节。[构建身份](../artifacts/tv-quark-cloud-inspection/BUILD.json)、[云端检查与原文件回归](../artifacts/tv-quark-cloud-inspection/quark-dav.json)、[实际API22界面截图](../artifacts/tv-quark-cloud-inspection/cloud-versions.png)保留原始证据。未发布Release或更新自动更新feed。

预备运行43389296691在补齐完成状态提示后主动取消。43389575855在旧的续播检查失败：旧测试的定位等待只有时间下界，缺少落入目标区域的验证；增强为目标附近时钟、新画面与暂停稳定后再验证数据库和新Activity续播，未更改生产播放器逻辑，也未移除原断言。随后43390405180第1次尝试在依赖准备步骤超时、尚未进入模拟器；同源码重试后完整通过。失败与取消均不计为通过。

测试返回由独立HTTPS服务控制，不是用户的真实夸克响应。没有真实账号、长虹实机、ARMv7运行和云端版本解码结论；`cloudPlaybackVerified`明确为false。

下一阶段在此基础上做独立HLS／fMP4播放PoC：处理播放列表、相对URL、初始化段、子资源鉴权、临时地址刷新及时间轴定位，并核对音轨、字幕与HDR。未证明协议闭环前，不将云端URL交给现有原文件Range传输器，不默认降级画质。
