# 夸克取流生命周期：第一阶段

TV 开发版 `0.3.0-alpha.5` / code13。沿用 Java、minSdk21、LibVLC、原签名和现有数据库。本轮实现研究报告中的控制请求调度与临时地址生命周期，电影仍按 Range 流式读取，不增加磁盘电影缓存。

## 已实现

- `QuarkRequestGate` 将电视唯一夸克连接的控制 API 串行调度，启动间隔至少200ms；播放取链优先于浏览、浏览优先于后台扫描。等待任务每5秒提升优先级，避免持续前台操作永久饿死后台。最多64个等待任务，等待上限30秒，取消后移除。正在执行的请求不被抢占。
- 扫描优先级随独立的本机 DAV 目录会话传递；不把优先级或凭据加到 URL。视频字节传输不经过此控制队列，不限制成每秒五个视频分段。
- HTTP429 或明确的业务 status429触发共享冷却。支持数字秒形式 Retry-After，限定1～30秒；其他形式按5秒处理。当前请求报告失败，不循环自动重试。403不解释成429，也不因此重置登录。
- 排队后、实际发送前读取最新登录凭据；响应轮换的 `__puus`、`__pus` 受原有旧值比较保护。未改变加密保存格式、用户选择目录、匹配或播放进度。
- 仅夸克远端原文件 Lease 解析已知 `Expires` 秒数，提前30秒失效，最长保留10分钟；缺失／格式未知时保留最多2分钟。持有期间用单调时钟判断，避免墙上时钟调整改变已计算的有效期。本机代理和外部 DAV 的 Lease 不套用夸克规则。
- `MediaTransfer` 在下一次取段／探测前检查到期，沿用原有每文件锁合并刷新；仍保留401／403后一次重取、闭合Range、版本核对和断流续接。更新地址不改变原文件位置或媒体数据。

这不是账号身份隔离的完整实现：同账号重登／异账号切换仍需可靠身份接口、登录代数和数据归属设计。本轮不新增未经验证的账号标识，也不迁移数据库。

## 验证

`python scripts/test-tv-transport.py` 在JDK环境运行17项生产策略检查；仅有JRE时可加 `--ecj /path/to/ecj.jar`。同一测试类加入现有API22 FeaturesScenario，以便设备侧运行。测试覆盖真实线程排队顺序、排队取消、幂等释放、请求节奏、冷却等待上限和地址有效期。

`PlaybackArchitectureScenario` 增加实际 `MediaTransfer` 的到期换链检查：第一次使用主动到期的Lease，下一次请求刷新，第三次复用有效替代，三次HTTP输出逐字节一致。继续运行既有真实本机代理Range、并发403换链、断流与取消检查。受控协议服务不代表真实夸克账号。

本地17项策略执行、Java主代码／instrumentation编译、现有234项业务测试通过。[完整构建与API22回归43352189375](https://github.com/StQuasimodo/Media-Library/actions/runs/43352189375)通过，实际构建源码 `61fd07b5764ad5d54abaf11fd53acc16bf300cda`。Gradle／Lint、API21/v1签名、ARMv7/x86打包检查通过；API22/x86执行55项功能检查（包括新增17项策略），验证实际MediaTransfer提前换链字节一致与并发403只刷新一次，以及90秒连续播放、定位／暂停／续播、16项备份、同签名升级、500海报、进程与模拟器内核重启。原始报告见[验收证据](../artifacts/tv-quark-stream-lifecycle/BUILD.json)。

APK SHA256为 `1eda1605a3daee7b94ca96f2c8af5219e1f4615f324e09aad450d4c381806fff`，48,800,253字节；已下载并与构建记录及模拟器所测APK哈希核对一致。沿用原固定签名，未发布Release或更新签名feed。真实夸克账号、长虹实机、ARMv7运行与4K原盘未验收，打包包含ARMv7库不等于实机运行通过。

首轮43351591647在并发403检查失败：新增测试先获取两次地址，改变了模拟服务用来指定过期地址的计数，干扰原测试。将主动到期场景移至并发过期场景之后，保持应用逻辑及断言不变，以上述新源码完整重跑通过；首轮失败不计为成功。

## 后续范围

1. 可靠区分同账号重登与切换账号，保持人工匹配和旧进度。
2. Windows控制请求调度、目录快照与增量核对。
3. 云端兼容版本独立PoC：验证自有账号可取得的实际版本、编码、清晰度、HDR、音轨字幕及定位能力。当前仍播放原文件，尚未接入云端转码流。
4. 有界小预读实验与长虹实机验证；不引入整片下载、家用服务器或电视本地转码。

## 参考与边界

参考 OpenList 的 [Quark 链接与请求头分离](https://github.com/OpenListTeam/OpenList/blob/25da9901f50fecc6cb417193680f0f3cfe2ffcdd/drivers/quark_uc/util.go)、OpenStrm 的 [控制请求分通道调度](https://github.com/indown/OpenStrm/blob/d294614ff4d2da410225cb82144090f4b7562335/apps/backend/src/services/throttle.ts)、quarkdrive-webdav 的 [临时地址失效判断](https://github.com/chenqimiao/quarkdrive-webdav/blob/7a88d7f1fa299a6ef75b99d7e5dbc07a717f579e/src/vfs.rs)。采用职责划分与协议经验，本项目独立实现小型 Java 队列与单调时钟策略，不嵌入这些服务，也不复制其实现。
