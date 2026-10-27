# 验证与交付

## Android TV 0.1.0-alpha.1（2026-10-27）

原生Android电视开发预览，构建源码`9725ff7bb83e46342843b543a48f5db7bc82f3bb`，独立本地数据库v1，不更改Windows schema v4或应用版本。[完整流程](https://github.com/StQuasimodo/Media-Library/actions/runs/40472208972)成功：JDK17/SDK35构建、Lint（0错误/6警告）、minSdk21、v1签名、DEX035及无原生库检查通过。APK在真正的API22 x86 Android模拟器安装启动，非网页模拟。

独立测试APK验证空库首启、真实Keystore RSA/AES/HMAC加密与存储重建、受控TMDB搜索/季资料/缺图语义、真实SQLite的导入去重、个人数据保留、系列1/2/10排序、专题资源关系、备份恢复事务失败回滚及数据库关闭重开；实际方向键更新首页标题/背景、确认进入详情、内容操作初始焦点、返回浏览，以及影视库/专题/想看/设置页面通过。另用故意无效、非秘密的Key访问真实TMDB，确认收到401，真实Key成功导入仍未验证。图片为测试占位/合成背景，没有把在线图片加载或真实网盘账号标成通过。

早期流程遇到SDK旧tools包移除、API22截图的虚拟/物理尺寸限制，以及首个方向键仅取得焦点的问题；均已修复。最终截图也移除了模拟器手机系统的一次性全屏教学覆盖，未修改用户设备。

APK为debug签名开发预览，大小1,408,352字节，SHA-256为`6e204ffbc5ded844b4c5790834960427ed4257fac7e6849e2b8cf88176568e11`。发布通过GitHub runner复用原始已验证字节，本地上传接口401没有重新打包或替换产物；Tag固定在构建源码。开发签名、应用私有备份与实机验收限制详见[电视说明](ANDROID-TV.md)。WebDAV、网盘目录自动匹配、视频播放尚未实现/移植到电视。

[开发预览下载](https://github.com/StQuasimodo/Media-Library/releases/tag/tv-v0.1.0-alpha.1) · [构建身份](../artifacts/releases/tv-v0.1.0-alpha.1/BUILD.json) · [签名检查](../artifacts/releases/tv-v0.1.0-alpha.1/apk-signature.txt) · [模拟器报告](../artifacts/releases/tv-v0.1.0-alpha.1/emulator-report.json) · [真实401报告](../artifacts/releases/tv-v0.1.0-alpha.1/network-report.json) · [截图](GALLERY.md)。长虹55D2S实机安装、中文输入、真实Key、升级/电视重启与解码仍待验收。

## beta.2 rev4 修订：展开菜单与分季背景（2026-10-27）

修订源码`04467141826a858397fe8bafb341e05349266de2`，应用版本仍为`1.2.0-beta.2`、schema v4。[Windows完整流程](https://github.com/StQuasimodo/Media-Library/actions/runs/40422141453)成功：13文件/145项测试、类型检查、构建、真实Electron窗口、DPAPI旧版凭据兼容、包内容及实际NSIS安装器选择检查通过。原Tag及此前17项发布资产的ID、大小和哈希均保持不变；新增6项rev4资产已从公开Release下载，大小、SHA-256与独立校验文件及BUILD记录一致。Latest仍为1.1.0。

真实Windows界面验证展开菜单的深色表面与浅色文字、鼠标展开与Escape关闭、不同季剧照独立缓存及显示、缺少季剧照时使用本季海报。额外单元检查覆盖旧共用背景刷新替换/清除、个人评分短评保留及重启持久化、图片下载失败保留缓存，以及整剧/电影原有背景逻辑。Linux真实Electron诊断也通过，使用headless与no-sandbox参数，仅代表该环境的诊断结果。

界面验证采用受控TMDB/目录响应、占位海报与不同颜色的合成季剧照，不能替代真实账号验收。另从TMDB公开季页面核对《绝命毒师》第一、二季的不同单集剧照，两个w1280图片地址均返回HTTP 200、JPEG、1280×720；这是公开页面/CDN验证，没有使用真实API Key。个人电脑升级、真实Key搜索导入与账号目录仍待验收。

[下载rev4安装包](https://github.com/StQuasimodo/Media-Library/releases/download/v1.2.0-beta.2/My-Cinema-1.2.0-beta.2-rev4-Setup.exe) · [摘要](../artifacts/releases/v1.2.0-beta.2/rev4/summary.json) · [构建身份](../artifacts/releases/v1.2.0-beta.2/rev4/BUILD-rev4.json) · [SHA-256](../artifacts/releases/v1.2.0-beta.2/rev4/SHA256SUMS-rev4.txt) · [Windows界面报告](../artifacts/releases/v1.2.0-beta.2/rev4/quark-sync-desktop-report.json) · [安装器报告](../artifacts/releases/v1.2.0-beta.2/rev4/installer-report.json) · [公开图片核对](../artifacts/releases/v1.2.0-beta.2/rev4/public-season-image-check.json)。已有季收藏可通过「更多操作 → 刷新资料」更新旧背景，详见[使用说明](USAGE.md)。

## beta.2 rev3 修订：系列分类与海报聚合（2026-10-26）

继续按本轮合并beta.2的要求发布`rev3`资产，应用版本仍为`1.2.0-beta.2`。修订源码`acf7b788e63745e10f2079303a27ee8dd04863b2`；原Tag和此前11项资产保留且哈希一致。新的6项资产大小和SHA-256均与下载的保留文件及独立校验文件一致，Latest仍为1.1.0。

[Windows完整构建与发布流程](https://github.com/StQuasimodo/Media-Library/actions/runs/40317376963)成功：13文件/142项测试、类型检查、构建、真实Electron、凭据兼容、包内容及实际安装器选择检查通过。验证包括电影1/2/10自然排列、整剧与1至6季相邻、系列筛选、旧电影官方系列补充、资料编辑保存自定义系列、仅修改序号保持原系列身份，以及刷新外部资料后保留手工顺序。单元检查还覆盖罗马/中文序号、无编号首部归组、相似片名不误合并、网络失败暂停补充与上下文关闭后禁止旧任务落库。Linux真实Electron受控界面也通过。

schema v4只新增可空的`films.series_json`保存系列元数据；v3升级前生成一致快照，测试确认保留原记录。若从v2直接升级，保存的是v2快照。旧应用不能直接打开v4，回退前须保留新库并使用升级前快照。个人电脑完整升级及真实TMDB Key在线识别仍待验收，UI/API边界验证使用受控数据。

[下载rev3安装包](https://github.com/StQuasimodo/Media-Library/releases/download/v1.2.0-beta.2/My-Cinema-1.2.0-beta.2-rev3-Setup.exe) · [摘要](../artifacts/releases/v1.2.0-beta.2/rev3/summary.json) · [构建身份](../artifacts/releases/v1.2.0-beta.2/rev3/BUILD-rev3.json) · [SHA-256](../artifacts/releases/v1.2.0-beta.2/rev3/SHA256SUMS-rev3.txt) · [界面报告](../artifacts/releases/v1.2.0-beta.2/rev3/quark-sync-desktop-report.json) · [安装器报告](../artifacts/releases/v1.2.0-beta.2/rev3/installer-report.json)。

## beta.2 rev2 修订：普通搜索选择季（2026-10-26）

应用户明确要求并入beta.2，应用版本保持`1.2.0-beta.2`。修订源码为`c18d0ab5dfe01a756cce34ad9b45f2020c87278d`；原Tag仍指向`c25e4cec60649095510e98e7de6643f774f6e694`，原5个发布文件均保留且哈希一致。新增文件带`rev2`后缀，独立的BUILD记录和校验文件注明实际修订来源。Latest仍为1.1.0。

[Windows完整流程](https://github.com/StQuasimodo/Media-Library/actions/runs/40302566818)第2次尝试成功：12文件/133项测试、类型检查、构建、真实Electron、凭据兼容、安装包内容和实际安装器选择验证通过。第一次因夸克官方登录页就绪超时而停止，尚未进入新季选择场景；相同源码重试后通过。

真实UI/IPC受控链路使用《绝命毒师》样例，验证展开五季及特别篇、单季确认、多季导入、已收藏禁选、原评分保留、整剧收藏及缺失季转手动表单；还验证批量第一个季成功、下一季请求失败时保留完成项，只重试剩余季。图片和API响应均为测试夹具，不代表真实账号在线验收。Linux真实Electron诊断也通过。

[下载修订安装包](https://github.com/StQuasimodo/Media-Library/releases/download/v1.2.0-beta.2/My-Cinema-1.2.0-beta.2-rev2-Setup.exe) · [交付摘要](../artifacts/releases/v1.2.0-beta.2/rev2/summary.json) · [构建身份](../artifacts/releases/v1.2.0-beta.2/rev2/BUILD-rev2.json) · [校验文件](../artifacts/releases/v1.2.0-beta.2/rev2/SHA256SUMS-rev2.txt) · [界面报告](../artifacts/releases/v1.2.0-beta.2/rev2/quark-sync-desktop-report.json) · [安装器报告](../artifacts/releases/v1.2.0-beta.2/rev2/installer-report.json)。已下载并核对全部6个修订资产的大小和SHA-256。数据库仍为schema v3；真实Key在线导入与个人电脑完整升级仍待验收。

## v1.2.0-beta.2 分季收藏（2026-10-26）

[测试版下载](https://github.com/StQuasimodo/Media-Library/releases/tag/v1.2.0-beta.2)已发布，构建源码和Tag为`c25e4cec60649095510e98e7de6643f774f6e694`，数据库保持schema v3。[Windows完整发布流程](https://github.com/StQuasimodo/Media-Library/actions/runs/40292153664)成功，包含12文件/131项测试、类型检查、生产构建、真实Electron、凭据兼容、打包与实际安装器选择检查。Linux真实Electron受控界面检查亦通过。

新增验证覆盖同剧两季独立分组和收藏、季接口的海报/简介/首播年份、季条目刷新、真实UI手动创建缺失作品并关联、无需Key建档、增量复用，以及旧整剧分组拆分时保留忽略和查询。旧关联和个人字段保留；将原整剧关联改为独立季收藏须按季点「更改匹配」。

已下载保留产物并核对全部5项GitHub资产大小与SHA-256，校验文件一致。安装包122931269字节，SHA-256 `1643be7a976db70a29a4d57d7ac753ba415ae4cb850b7a6b3ded808032cfa99a`。Latest仍为1.1.0。

[交付摘要](../artifacts/releases/v1.2.0-beta.2/summary.json) · [自动匹配/分季报告](../artifacts/releases/v1.2.0-beta.2/quark-sync-desktop-report.json) · [安装器报告](../artifacts/releases/v1.2.0-beta.2/installer-report.json) · [校验文件](../artifacts/releases/v1.2.0-beta.2/SHA256SUMS.txt)。目录与TMDB响应为受控数据，真实账号、真实Key在线匹配和个人电脑完整升级仍待验收。TMDB缺少的作品/季可手动建档，并未新增其他元数据来源。

## v1.2.0-beta.1 测试版交付（2026-10-26）

[Release与下载](https://github.com/StQuasimodo/Media-Library/releases/tag/v1.2.0-beta.1)已发布为预览版，Latest仍为1.1.0。构建与Tag固定在 `a944fe63fcd1b68d634f1a42743821e9d8d71efa`，后续仅修复安装器自动化驱动和补充交付记录，未替换已构建文件。

[Windows原构建](https://github.com/StQuasimodo/Media-Library/actions/runs/40214555684)的12文件/127项测试、类型检查、完整构建、真实Electron与preload/SQLite、网页登录隔离、真实Windows加密跨版本读取、安装包和图标内容检查均通过。独立的受控目录/TMDB链路通过UI完成选目录、递归、候选确认、导入、缓存、重复保护、电影/剧集ID隔离、增量关联、失踪文件与失败扫描保护。窗口无原生菜单，标准复制快捷键在Windows实际窗口通过。此处是接口边界受控验证，不是个人账号在线验证。

原构建在安装器UI检查中超时：报告显示仍停留在选项页、未写入程序，UIAutomation的Invoke未推进原生按钮。改用实际按钮的Windows原生命令通知后，[保留产物验证与发布流程](https://github.com/StQuasimodo/Media-Library/actions/runs/40215672824)成功，复用同一安装包完成以下检查：

- 实际NSIS窗口的“创建桌面快捷方式”可以取消，安装结束不创建桌面入口，开始菜单入口保留。
- 重装记住取消选择；显式启用可创建正确目标的快捷方式，再次禁用可移除。
- 安装后的`app.asar`与已校验免安装包一致。

再次下载保留产物并核对全部5个GitHub发布资产的大小、SHA-256和校验文件，全部一致。[交付范围与摘要](../artifacts/releases/v1.2.0-beta.1/summary.json)、[校验文件](../artifacts/releases/v1.2.0-beta.1/SHA256SUMS.txt)、[安装器报告](../artifacts/releases/v1.2.0-beta.1/installer-report.json)、[桌面报告](../artifacts/releases/v1.2.0-beta.1/desktop-report.json)、[自动匹配报告](../artifacts/releases/v1.2.0-beta.1/quark-sync-desktop-report.json)、[凭据复读](../artifacts/releases/v1.2.0-beta.1/report-restart-new.json)、[截图](GALLERY.md)。

安装包122930398字节，SHA-256 `ddbf1024f7fb2aa6570ad003d679b09c7853b8528e44aecb0bc538fc41f95440`。schema v2升级到v3前自动保存一致快照，旧版不能直接打开v3库。真实夸克账号、真实Key在线匹配、个人电脑完整升级及字体/缩放仍待验收；加密检查使用合成值，不读取个人凭据。

## v1.1.0 正式交付（2026-10-25）

[v1.1.0 Release](https://github.com/StQuasimodo/Media-Library/releases/tag/v1.1.0)已发布并设为 Latest。构建源码为 `cadfcecc4c8630abe8895e609bdfea880826cb00`，数据库仍为 schema v2。Windows 的94项测试、类型检查、生产构建、真实 Electron/preload/SQLite、夸克官方窗口与匿名鉴权、v1.0.0→v1.1.0 真实加密凭据兼容检查和安装包内容校验均通过。凭据检查使用合成值，个人安装与真实 TMDB/夸克账号仍待验收。

[原构建流程](https://github.com/StQuasimodo/Media-Library/actions/runs/40189670556)在打包和校验后因 PowerShell 发布参数展开错误失败；修正为 Node 参数数组。云环境上传接口返回401，runner对历史提交的Release创建返回403；随后核对固定Tag并取消不必要的目标提交参数，[保留产物发布流程](https://github.com/StQuasimodo/Media-Library/actions/runs/40190610384)成功。发布复用原文件，未重新打包或替换旧版资产。

已再次核对全部5个GitHub资产的SHA-256与保留文件相符，并确认旧版本号和错误预览版本会被发布前检查拒绝。[交付范围及资产摘要](../artifacts/releases/v1.1.0/summary.json)、[校验文件](../artifacts/releases/v1.1.0/SHA256SUMS.txt)、[桌面报告](../artifacts/releases/v1.1.0/desktop-report.json)、[版本检查记录](../artifacts/releases/v1.1.0/version-guard.json)、[新版凭据读取](../artifacts/releases/v1.1.0/report-read-new.json)、[重启复读](../artifacts/releases/v1.1.0/report-restart-new.json)。

安装包：`My-Cinema-1.1.0-Setup.exe`，121228626字节，SHA-256 `355b22990b167896864c7e24405c700a08af2f540ad3ac52abc6d2572473b800`。历史1.0.0预览与早期交付记录保留在下方，不代表当前版本。

## API Key 更新后状态排查（2026-10-25）

用户报告更新后需要重新配置 API；尚未确认本机是状态为未配置，还是仅输入框为空，也未确认其他收藏/设置是否保留。代码检查发现旧 `CredentialStore` 将缺失、解密失败、系统存储暂不可用都变成 null，并缓存到进程退出；这是已修复的独立问题，不能据此认定它就是用户本机的原因。

当前源码只缓存成功读取的密钥，区分 configured/missing/unavailable/unreadable，失败时保留原文件，可在设置中重试；导入界面的提示同步调整。已配置时明确说明密钥不回显、空输入框无需重填。数据目录、凭据版本1格式、safeStorage 和 SQLite schema 均未改变。

本地94项测试、类型检查、构建与真实 Electron 检查通过。[Windows流程](https://github.com/StQuasimodo/Media-Library/actions/runs/40188705823)的94项测试、真实 Electron 与加密跨进程验证也通过：使用稳定版 `48c306f` 的原始 CredentialStore 保存合成密钥，在另一个目录的新 Electron 外壳中读取并替换，再启动新进程复读。这里使用真实 Windows safeStorage 和隔离 profile；没有使用个人 API Key、登录 TMDB，也不等同于 NSIS 安装升级验收。此次未复现正常升级丢失密钥，用户本机旧配置是否可读取仍未确认。

[下载含修复的 Windows 集成预览版](https://github.com/StQuasimodo/Media-Library/actions/runs/40188705823/artifacts/12597288041)（安装包与免安装 ZIP，源码 `a630553`）。打包、包内容校验和上传均成功；未覆盖稳定版 Release。

证据：[范围记录](../artifacts/research-2026-10-25/credential-upgrade/summary.json)、[旧版写入](../artifacts/research-2026-10-25/credential-upgrade/report-write-old.json)、[新版读取并替换](../artifacts/research-2026-10-25/credential-upgrade/report-read-new.json)、[重启复读](../artifacts/research-2026-10-25/credential-upgrade/report-restart-new.json)、[真实桌面报告](../artifacts/research-2026-10-25/credential-upgrade/desktop-report.json)、[SHA-256](../artifacts/research-2026-10-25/credential-upgrade/SHA256SUMS.txt)。安装包 SHA-256 为 `c37a5209dcec4620d063c0b95277fc12edec0cd7e194a5b463b5f4961983ccc7`。

在 Windows 安装依赖后可复跑：`node scripts/check-credential-upgrade.mjs`。这会构建隔离测试外壳，报告只含检查阶段与布尔结果，不上传凭据或 Local State。

## 夸克应用内整合（2026-10-25）

源码已加入「设置 → 夸克网盘」的官方网页登录、目录连接检查、逐层浏览和断开本机会话。[Windows 集成预览流程](https://github.com/StQuasimodo/Media-Library/actions/runs/40187475255)的90项测试、类型检查、完整构建与真实 Electron/preload/SQLite 检查已通过；集成官方登录窗口可打开，匿名目录返回需要登录，远端页面无业务桥接与 Node require。源码为 `0b3b0e1`。Linux 的真实 Electron 界面检查也已通过，使用独立夹具和显式 headless/no-sandbox 诊断参数；Windows 检查未使用这些诊断参数。真实账号目录访问、实际会话重启、递归同步与 TMDB 自动入库未验证或未完成。

安装包、免安装 ZIP 与包内容校验均通过，[下载集成预览产物](https://github.com/StQuasimodo/Media-Library/actions/runs/40187475255/artifacts/12596621235)。[Windows 原始桌面报告](../artifacts/research-2026-10-25/windows-integrated-quark-desktop.json)、[交付范围记录](../artifacts/research-2026-10-25/integrated-preview.json)、[SHA-256](../artifacts/research-2026-10-25/integrated-preview-SHA256SUMS.txt)、[账号入口截图](../artifacts/review-2026-10-25/quark-integrated-windows.png)。安装包哈希为 `ba5f55e2035885e4ab11bea92f4a13498379d4d6ea79dc2c69058ee66b59c938`。这些预览产物没有覆盖稳定版 Release。

## Windows Release（2026-10-25）

[v1.0.0 已发布](https://github.com/StQuasimodo/Media-Library/releases/tag/v1.0.0)，构建来源为 `48c306f63ad6f8ea441355b564d812b5110964de`。[Windows 流程](https://github.com/StQuasimodo/Media-Library/actions/runs/40114969102)的日志确认：82项测试通过，完整构建、真实Electron/preload/SQLite检查与包内容验证通过；安装包与免安装ZIP上传完成。GitHub资产的SHA-256与发布的校验文件一致。

这证明Windows runner上的运行和打包链路，不代替个人电脑上的安装、字体/缩放与真实TMDB/夸克账号验收。安装包未签名。该稳定版没有应用内账号入口；上方的新入口属于后续源码与预览构建。

## 1. 命令

```powershell
pnpm typecheck              # tsc --noEmit
pnpm test                   # vitest run（当前13文件 / 142用例；1.1.0为94用例）
pnpm build                  # 类型检查 + 主进程打包 + 渲染层构建
pnpm package                # 安装包 + 免安装 zip（自动处理 TMP / PATH / 镜像）
pnpm package:dir            # 只生成免安装目录 release/win-unpacked
pnpm ui:shots               # 无头渲染截图到 artifacts/screenshots（含 seeded 场景）
node scripts/run-ui-harness.mjs --empty   # 空收藏状态截图
powershell -File scripts/check-environment.ps1   # 临时目录 / 数据目录 / 构建链体检
```

前置：`pnpm install` 后若 Electron 二进制缺失，执行 `pnpm electron:fetch`（分块续传 + 镜像回退）。

打包不再需要手工设置环境变量：`scripts/package.mjs` 会把 `TMP`/`TEMP` 指到项目内 `.tmp`、把 `.tools` 加入 PATH（并处理 Windows 上 `PATH`/`Path` 大小写陷阱）、补齐 `ELECTRON_BUILDER_CACHE` 与镜像，然后调用 electron-builder，最后用 `Compress-Archive` 生成免安装 zip。

若 `github.com` 不可达（本机曾解析到 127.0.0.1），把 `electron-v45.0.0-win32-x64.zip` 放进 `.eb-cache/electron/`，或设置 `ELECTRON_MIRROR` + `ELECTRON_CUSTOM_DIR`。

---

## 2. 测试用例对应关系

| 需求 | 用例（`tests/`） |
|---|---|
| 收藏增删改 | `library.test.ts`：导入后读取详情、编辑个人字段、删除条目清理关联 |
| 元数据与个人数据隔离 | `library.test.ts`：刷新外部资料后评分/笔记/资源不变 |
| 专题增删改 | `library.test.ts`：创建、重命名、删除；同名拒绝 |
| 一作品多专题 | `library.test.ts`：同一 entry 加入两个专题，重复加入幂等 |
| 一作品多资源 | `library.test.ts`：两条资源、provider 均为 quark、状态默认未检查 |
| 删除资源不删作品 | `library.test.ts`：删除后详情与条目仍存在 |
| 重启后可读 | `persistence.test.ts`：关库重开后收藏、专题、资源、提取码仍在 |
| 备份 / 恢复 | `persistence.test.ts`：备份 → 新增数据 → 恢复 → 回到备份时状态；非法文件被拒且数据不变 |
| 重复导入 | `library.test.ts`：同一 TMDB id 第二次导入返回 `duplicate`，索引唯一 |
| 超时 / 无结果 | `metadata.test.ts`：TimeoutError → TIMEOUT；空结果 → `[]` 与 `NO_RESULTS` |
| 鉴权 / 限流 / 镜像回退 | `metadata.test.ts`：401、429、双域名回退、JWT 走 Authorization |
| 图片失败 | `library.test.ts` + `security.test.ts`：500 时导入成功并带警告；非图片类型被拒；同 URL 只下载一次 |
| 非法链接 | `security.test.ts`：`file:`、`javascript:`、`ftp:`、非 URL 均拒绝；`isQuarkHost` 防 `quark.cn.evil.com` |
| 密钥不入日志 | `security.test.ts`：API Key、提取码、JWT 在日志中被替换为 `[redacted]` |
| 搜索/筛选/排序 | `library.test.ts`：标题/原名/笔记搜索、年份/状态/专题筛选、年份与评分排序、`%` `_` 转义 |
| 路径穿越 | `security.test.ts`：`../`、绝对路径、非法哈希均返回 null |
| 损坏数据库 | `persistence.test.ts`：返回 `CORRUPT` 且文件未被改写 |

窗口缩放与视觉状态由截图验证（第 4 节），不属于单元测试范围。

---

## 3. 构建产物

| 产物 | 路径 | 大小 | SHA-256 |
|---|---|---|---|
| 安装包 | `release/My-Cinema-1.0.0-Setup.exe` | 115.59 MB | `8621E609…2E9B` |
| 免安装版 zip | `release/My-Cinema-1.0.0-portable-win64.zip` | 161.83 MB | `1B41B233…E209` |
| 免安装目录 | `release/win-unpacked/My Cinema.exe` | 383.7 MB / 139 文件 | — |
| 渲染层 | `dist/index.html` + `dist/assets/*` | 约 380 KB |
| 主进程 / preload | `dist-electron/main.cjs` / `preload.cjs` | 111 KB / 3 KB |
| 图标 | `build/icon.ico`（7 个尺寸） | — |

安装包内已核对：`dist` 资源哈希与本地构建一致；`app.asar.unpacked/node_modules/better-sqlite3/prebuilds/win32-x64.node` 存在。

---

## 4. 界面验证方式

本机无法创建 Electron 窗口（`BrowserWindow` 阶段以 `STATUS_BREAKPOINT` / `ACCESS_VIOLATION` 崩溃，`--no-sandbox`、`--disable-gpu`、`--single-process`、关闭硬件加速、offscreen 均无效；`electron --version` 以 Node 模式正常）。

因此界面验证使用 `scripts/ui-harness.ts`：

1. 用**真实**数据层与服务层（同一个 `openLibraryDatabase` / `LibraryService` / `ImageCache`）在临时目录建库并导入作品、专题、资源；
2. 通过 HTTP 提供**真实**的 `dist/` 产物，用极薄的 `window.cinema` 适配层替代 preload 传输；
3. 用无头 Edge（Chromium）在 1280 / 1440 / 1920 下截图。

与发行版的差异只有传输层；React 组件、CSS、业务规则完全一致。

### 截图清单（`artifacts/screenshots/`）

| 文件 | 验证内容 |
|---|---|
| `01-home` | 首页主视觉 + 聚焦轨道 |
| `01b-home-focus-3` | 聚焦第 4 部：背景、标题、简介、评分同步切换 |
| `02-library` | 影视库工具栏与 6 列网格 |
| `03-film-detail` | 详情页主视觉、操作收敛、分区排版 |
| `03b-detail-no-images` | 无海报/背景图时的占位与渐变主视觉 |
| `04-collections` | 专题卡片墙 |
| `05-collection-detail` | 专题内作品与移除操作 |
| `06-watchlist` | 想看队列与快速改状态 |
| `07-settings` | 设置四区块 |
| `08-library-1280` / `08b-home-1280` | 1280 宽度布局 |
| `09-library-1920` / `09b-home-1920` | 1920 宽度布局（主视觉铺满） |
| `11-empty-home` / `12-empty-library` / `13-empty-home-1280` | 空收藏状态 |

---

## 5. 当前验证结论

2026-10-24 Linux 云环境重新验证；此前 Windows 打包结果不视为本轮重新构建。真实 Electron 截图使用独立 SQLite 夹具、本地缓存图片和显式诊断参数，详见 [修复记录](REPAIRS-2026-10-24.md)。

| 检查 | 结果 |
|---|---|
| `tsc --noEmit` | 通过，0 错误 |
| `vitest run` | 82 / 82 通过 |
| `build.mjs` | 通过 |
| `electron-builder --win` | 本轮未执行；历史报告通过 |
| 安装包内容核对 | 本轮未执行；历史报告通过 |
| 截图巡检 | 当前真实 Electron 截图覆盖首页、影视库、详情、专题、想看及设置，含小窗口、空态和无图 |
| Electron 窗口启动 | Linux 无显示器诊断模式通过；Windows 交互桌面待验收 |
| TMDB 带 Key 的在线搜索 | **未验证**（无凭据） |
| 安装器静默安装 | **未验证**：本会话无交互桌面，`Setup.exe /S` 在初始化阶段不返回（已确认未写入注册表 / 开始菜单 / 安装目录，无残留）。免安装 zip 已核对结构完整（含 `My Cinema.exe`、`app.asar`、better-sqlite3 原生二进制） |

---

## 6. 已知限制

1. Linux 已运行真实 Electron BrowserWindow；Windows 安装后的交互桌面、字体与缩放仍需验收。
   - 若双击安装包报 `error writing temporary file`，是 NSIS 无法写入 `%TEMP%`：运行 `scripts/check-environment.ps1` 或改用免安装 zip。应用自身已把 Chromium 临时目录改到 `%APPDATA%\My Cinema\tmp`，不受该问题影响。
2. 没有可用 TMDB API Key：只验证了请求可达与 401 错误映射，未验证成功搜索。
3. 仅 Windows x64；无自动更新。
4. JSON 导出为单向归档，不支持回灌（恢复请用数据库备份）。
5. 安装包包含 better-sqlite3 的多平台预编译二进制（约 5 MB 冗余），不影响运行。
