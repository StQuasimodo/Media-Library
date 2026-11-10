# TV 文件名解析与特别篇匹配修复

实际构建/测试源码：`cb7c3aac75a1219aac0a57f10bf236e9ac1a9af3`。本轮修正现有解析和匹配，不修改收藏/媒体数据库结构、凭据、进度或解码内核；仍为 `0.2.0-alpha.4 / code7` 的源码开发，没有新安装包。

## 修正行为

| 输入 | 修正后的结果 |
|---|---|
| `Paddington.2014.1080p.BluRay.x264.AAC.mkv` | 片名 Paddington、年份2014，音频标记AAC；DD不再命中片名中的字母 |
| `1917.2019.1080p.mkv` | 片名1917、年份2019；单独的`1917.1080p.mkv`保留数字片名、年份未知 |
| `2001.A.Space.Odyssey.1968.2160p.mkv` | 片名2001 A Space Odyssey、年份1968 |
| `Breaking.Bad.S00E01.mkv`，父目录`Season 01` | 明确第0季优先，匹配已收藏的特别篇季，不继承第1季 |
| `Breaking.Bad.E01.mp4`，父目录`Season 00` | 只在明确父目录信息存在时继承第0季；缺少季信息时保持未匹配 |
| `Movie.1920x1080.HEVC.mkv` | 尺寸标记1920X1080，年份未知，不把1920当发行年份 |
| 文件夹`Mr.Robot`、`Movie.2019` | 不再把任意末尾短词或数字当扩展名删除；只剥离已知视频扩展名 |

编码、音频、片源和HDR标记增加词边界，避免截断 AVClub、Remuxer、HDRoom 等普通标题。只在技术后缀前选择有非空标题前缀的最后一个年份；数字片名本身不作为发行年份。季/集信息增加`seasonKnown`、`episodeKnown`标记，明确零与未知分别处理；错误中文数字和超长数字不转换成特别篇。

这些仍是文件名声明，不能充当实际媒体探测或硬解结果。多候选、年份冲突、未知季继续保留未关联；不以第0季作为默认季。

## 既有数据

重新浏览/扫描会更新被读取文件的命名信息；人工关联、人工取消关联及同一文件ID的续播进度保留。已有非空自动关联也继续保留，**不会因修正规则而静默重写旧误关联**；纠正存量项需要后续明确的重新匹配操作。旧JSON没有新增标记仍可读取，无数据库迁移。

## 验证与边界

- 生产Java解析函数的主机探针：29组输入通过；这是JVM检查，不是Android运行结果。
- Windows解析代码使用同一份[20组共享样本](../tests/fixtures/resource-name-cases.json)，相关Vitest共3文件/53项通过；TypeScript检查通过。Windows业务源码未改，未重新打包或运行Windows窗口。
- Android主代码/测试的Java8编译检查通过。新增测试在独立instrumentation APK中读取共享JSON，正式应用不包含测试样本；验证脚本检查这一边界。
- [API22聚焦验证](https://github.com/StQuasimodo/Media-Library/actions/runs/42808340397)通过：29组文件名、9项匹配约束和5项真实SQLite保留检查通过。覆盖人工关联、人工取消、既有自动关联、命名信息更新、进度和重新打开；样本SHA-256与仓库文件一致。
- Gradle/Lint（0错误/18警告）、minSdk21/v1签名/ARMv7与x86打包检查、基础收藏/Keystore/真实界面及遥控器冒烟通过；公开无效Key返回401。测试样本未打入主APK。

CI复用现有API22工作流的`resource_names`选项，保留基础收藏/界面/Keystore冒烟与公开无效Key401检查，跳过本轮未改动的90秒视频及完整取流回归。测试签名仅用于一次性模拟器，不分发APK。真实账号、目标电视、ARMv7运行和4K原盘不在本轮验收范围。

完整预览工作流已接入同一分发脚本和命名检查；该接线未另跑完整播放流程，不冒充新的90秒/重启验证。

[摘要](../artifacts/tv-resource-names-2026-11-10/summary.json) · [构建身份](../artifacts/tv-resource-names-2026-11-10/build.json) · [命名/匹配/SQLite报告](../artifacts/tv-resource-names-2026-11-10/resource-name-report.json) · [基础冒烟](../artifacts/tv-resource-names-2026-11-10/smoke-report.json) · [真实401](../artifacts/tv-resource-names-2026-11-10/network-report.json)。

首个候选流程在补充错误中文数字的负向样本后主动取消。随后[流程42807673798](https://github.com/StQuasimodo/Media-Library/actions/runs/42807673798)通过构建/安装/基础冒烟，但模拟器工具逐行执行多行shell分支，报缺少`fi`，命名测试尚未启动；已改为独立shell分发脚本。后续结果以本报告所列源码为准，不将该失败、取消流程或主机探针写成Android命名验证通过。
