# TV 目录浏览的取消与生命周期修复

修复源码：`1247c06d46f167f6fbd22fa3732783d1f95c5fcc`。仍为 `0.2.0-alpha.4 / code7` 的源码开发，未分发新安装包；Windows 版本、收藏数据库结构、凭据格式和播放进度格式不变。

## 修复内容

- `MediaBrowserActivity` 的每个目录/扫描/配置任务持有独立 `NetworkScope`；重新渲染、确认取消或销毁时先关闭请求和本机目录会话，再中断 Future。任务固定本次目录输入，过期回调按代数和作用域身份丢弃。页面销毁/正在退出后不再提交任务，旧按钮和目录列表也不再触发操作。
- `MediaSources` 将同一作用域用于原始夸克读取和外部 WebDAV；启用夸克 DAV 时继续传至 `QuarkDavManager` 的定位、PROPFIND 以及结果路径验证，挂载前验证也接受任务取消。
- 只关闭本机 HTTP 客户端不能及时停止服务端正在等待的夸克请求。因此目录查询使用独立临时会话，仅授权指定目录的 PROPFIND；作用域关闭时同时撤销该会话及其上游请求。会话不能 GET 视频或查询其他路径，完成后立即撤销。
- `NetworkScope` 可清理其拥有的会话，在锁外执行清理以避免跨所有者锁等待。取消目录任务不会关闭共享 DAV 服务或其他播放会话，也不会把正常取消写成共享的取流故障。
- 批量扫描仍先收集完整结果再事务写入，逐项和提交前检查取消；已有手工关联和进度保留。正常同签名升级的数据路径没有变化。

## 验证

[API22 完整验证流程](https://github.com/StQuasimodo/Media-Library/actions/runs/42801559632)通过，构建/运行源码为上面的 `1247c06`。Gradle 构建、Lint（0错误/18警告）、minSdk21/v1签名/ARMv7和x86库检查、真实API22 x86运行及收藏/进程/模拟器重启回归均通过。本地主代码与测试代码的 Java 8 编译、Python 测试服务语法检查也通过。测试使用合成协议与媒体，不代表真实账号或ARMv7运行验收。

新增 `BrowserLifecycleScenario` 使用受控 HTTPS 服务的十秒阻塞响应，要求显式取消后两秒内读取线程退出，而不是只取消 Future；以下检查均通过：

1. 原始夸克目录、外部 DAV、本机 DAV 三条路径均真正进入阻塞后取消；本机路径还检查服务端工作线程和请求归零。
2. 取消目录后，独立视频会话仍能得到正确的 64 字节 Range 响应；共享挂载继续运行。
3. 目录会话拒绝 GET 和其他路径，完成/关闭后鉴权返回401。
4. 实际界面启动递归扫描，在阻塞中销毁 Activity；检查请求和工作线程及时结束，旧按钮不再提交，原文件关联和进度不变。
5. 同轮保留原有 LibVLC 原生播放、断流/过期、暂停重连、90秒播放、收藏及进程/模拟器重启回归。

本次原始夸克、外部DAV和本机DAV的取消观测分别为 **1/0/1毫秒**；这是单次测试的毫秒分辨率读数，不是设备性能或所有请求的时延承诺。LibVLC连续播放观测90,373毫秒，时钟推进90,501毫秒、显示1,284帧，重连保留倍速通过。

[交付摘要](../artifacts/tv-browser-lifecycle-2026-11-10/summary.json) · [构建身份](../artifacts/tv-browser-lifecycle-2026-11-10/build.json) · [播放与新取消断言](../artifacts/tv-browser-lifecycle-2026-11-10/playback-report.json) · [DAV/90秒/重连回归](../artifacts/tv-browser-lifecycle-2026-11-10/quark-dav-report.json)。收藏及重启回归由成功流程和日志中的各阶段通过结果确认；该次上传没有保留其独立JSON，后续工作流已扩大报告收集范围，不将此补充冒充新一次运行。

测试保留一个横屏 MainActivity 作为浏览器下层页面，消除测试持有旧旋转实例的假设；生命周期保护由生产代码实现，新增测试明确销毁正在扫描的页面，不把横屏测试安排本身称为修复。

此验证工作流使用一次性 debug 签名，仅上传测试报告/日志，不提供安装包或发布 Release，不代表原固定分发签名已恢复。真实夸克账号、旧 WebView、长虹 ARMv7 和 4K 原盘均不在本次验收范围。

## 分发签名的独立诊断

读取[失败流程](https://github.com/StQuasimodo/Media-Library/actions/runs/42617123853)中 signing job 的实际日志，确认依次出现 `Cache not found for input keys: my-cinema-tv-development-signing-v2` 和 `Cached development signing key is missing. Restore it; generating a replacement is refused.`。2026-11-10查询该缓存，`total_count=0`。因此该次失败原因是密钥缓存缺失，不能继续笼统称为缓存或指纹问题。

这不证明所有地方都没有原密钥备份。当前 GitHub 集成访问仓库 Actions Secrets 元数据返回403，无法判断那里是否另有备份；本轮没有修改 Secrets、签名身份或现有 Release。后续分发前仍须恢复原身份或先制定可验收的数据迁移方案。
