# TV 签名恢复与旧版数据迁移

本文记录旧证书缺失及其迁移实验。用户随后明确授权采用新固定签名；当前密钥、版本、托管限制与安装约束见[新签名说明](TV-FIXED-SIGNING-2026-11-10.md)。以下旧APK、证书和验证结果保持原历史身份。

## 当前结论

安卓签名密钥是开发者给 APK 签名的私人密钥，不是 TMDB Key、夸克登录信息或电视端 Android Keystore。Android API22 要求同一个应用 ID 的新版由原密钥签名，才能覆盖安装并保留原数据。公开证书或 APK 不能反推出私人密钥。

已发布的 `tv-v0.1.0-alpha.3` 原始 APK 为 `My-Cinema-TV-0.1.0-alpha.3-debug.apk`，SHA-256 为 `83e074cba861a3dae1456a1763cee469e737b02f5c7f4a7df2424ce2b93e8bff`。实际签名证书与仓库固定指纹一致：`0e343d7d8d91f931b0350b7c01f87115f2fc7daf6402c0baee8276ced4a9bd44`。它包含 v1 签名，适用于 API21/22。

2026-11-10 检查时，原固定签名缓存不存在；仓库 Secrets 元数据接口返回403，不能据此断言没有任何备份。新增流程在 Actions 内检查约定的 `TV_DEVELOPMENT_KEYSTORE_BASE64` Secret，结果是未配置，原签名尚不可用。工作区已检查范围内也没有原 Keystore。没有生成替代分发密钥，原指纹没有修改。

## 恢复入口

`scripts/prepare-tv-signer.py` 接受已有固定 Keystore，或由 GitHub Actions Secret `TV_DEVELOPMENT_KEYSTORE_BASE64` 恢复它。Secret 内容应为**原 Keystore 文件**的 Base64，仍使用原 alias `androiddebugkey` 和原开发密码；创建新文件不能替代恢复。

恢复顺序：大小和编码校验 → 写入权限600的临时文件 → 确认包含私人密钥 → 导出公开证书并匹配固定指纹 → 原子替换 runner 内固定路径。错误密钥、公钥证书、损坏编码、调用方指纹冲突都被拒绝，既有文件不被错误输入覆盖。错误提示不输出私人内容或 keytool 原始输出。

常规构建和回归复用这一入口；缓存仅作为可选恢复来源，不再自动保存从 Secret 注入的密钥。不要把 Keystore、Base64 或密码写进聊天、Git、日志或 Actions 产物；由持有人在 GitHub 私有 Secret 设置中保存原文件，并另作离线备份。仓库增加 Keystore 文件忽略规则，但忽略规则不能代替妥善保管。

找回原密钥后仍需重新执行原身份的覆盖升级和完整播放回归。流程的“检测任务成功”只表示生成了检查报告，必须读取 `originalSignerReady`，不能把绿色任务视为密钥恢复成功。

## 旧安装只读导出

对可调试的历史预览 APK，提供开发者工具：

```sh
python3 scripts/export-tv-legacy.py --serial <明确的ADB设备序列号> --output <新的备份文件路径.json>
```

需要 Python3、ADB、设备授权，以及 `io.mycinema.tv` 已初始化的数据库。工具先停止旧应用以冻结文件，再用 `run-as` 读取收藏库、可选媒体目录库及已有 SQLite 日志文件。SQLite 检查与日志恢复仅发生在电脑上的私有临时副本；不在源数据库执行 SQL，不安装、不卸载、不清除应用，也不需要 root。导出完成后可以重新打开旧版。

输出为[备份格式2](TV-BACKUP-2026-11-10.md)，保留收藏身份、评分/短评、专题关系、媒体稳定身份、人工关联和进度；生成单独的 SHA-256 与数量清单，已有输出文件拒绝覆盖。库版本、完整性、关系、媒体字段不符合要求时停止；不读取账号凭据文件，不导出未知请求头或临时路由。

备份包含私人收藏与手工分享链接，应保存在私人位置。它不包含 TMDB Key、夸克 Cookie、WebDAV 密码或 Android Keystore。并行新身份不能继承旧身份的 Keystore；迁移后需重新登录。不能复制加密文件来假装完成凭据迁移。

此工具是具备 ADB 条件时的备选入口，不等于已经能在用户电视上导出。没有调试授权或安装的是不可调试包时不能使用。不能为了获得权限而卸载旧版。

## 隔离迁移测试

`-PtvMigrationPreview` 只构建测试身份 `io.mycinema.tv.preview`，显示名称为 `My Cinema · 迁移验证`。默认构建仍是原应用 ID、版本和名称。`-PtvUpgradeTestVersionCode=8` 仅允许与隔离身份同时使用；正式版本仍由原静态版本配置管理。

`.github/workflows/tv-signing-migration.yml` 在一次性 API22 x86 模拟器中安装上述**真实已发布旧 APK**，从原生界面添加收藏、评分和理由，然后验证：

1. 使用只读工具导出格式2，旧库字节哈希不变。
2. 不同签名的同应用 ID 更新被系统拒绝，旧版本和数据保留。
3. 并行测试身份导入后保留收藏和原 ID，旧安装仍在。
4. 为测试身份保存合成加密凭据、人工媒体关联及进度，使用同一临时测试签名从 code7 覆盖升级至 code8，验证全部保留。

临时签名仅用于这个隔离实验，APK、备份正文和密钥都不上传；只保存合成数据的结果、截图与诊断。此实验**不能证明原签名已恢复、原身份升级已成功或电视实机已验收**，也不是新的分发身份决定。正式包的签名与发布门禁继续保留。

## 验证账本

本地：7项签名恢复检查、8项旧库转换检查通过，包含错误密钥不覆盖、公钥不能充当私人密钥、旧格式、手工关联与进度、未知 schema、坏关系与重复输出拒绝；主应用和 instrumentation 的 Java8 编译通过。工作流 YAML、actionlint（关闭可选shellcheck/pyflakes）、shell 语法和差异格式检查通过。

[首轮流程](https://github.com/StQuasimodo/Media-Library/actions/runs/42834702922)完成了构建、Lint（0错误/17警告）、签名关系和测试包身份检查，旧APK在API22启动成功；模拟器未按 `-dpi-device` 设置实际密度，旧版对话框输入框超出可见范围，原生界面播种步骤失败，未执行后续迁移。脚本已沿用现有电视冒烟的 `wm density 160`，并断言实际覆盖值，不修改旧APK来绕开失败。

[第二轮流程](https://github.com/StQuasimodo/Media-Library/actions/runs/42835560364)通过，实际构建与测试源码为 `10403043043609d288c107800317fd2b510b254c`。API22 x86 中，上述4步全部通过：原生旧界面创建的片名、评分9与收藏理由导出后准确保留；异签名覆盖被Android拒绝；并行导入和测试身份 code7→8 升级通过；原库在导出、拒绝安装与并行迁移后均保持原字节哈希。合成 Keystore 凭据、人工关联和45000ms进度在测试身份升级后仍可读。构建、Lint（0错误/17警告）、签名关系及minSdk21检查通过；7项签名与8项转换测试同轮通过。

[原始结果与构建身份](../artifacts/tv-signing-migration-2026-11-10/BUILD.json) · [迁移结果](../artifacts/tv-signing-migration-2026-11-10/summary.json) · [原签名仍未恢复的报告](../artifacts/tv-signing-migration-2026-11-10/original-signer.json) · [升级后原生画面](../artifacts/tv-signing-migration-2026-11-10/upgrade.png)。仓库只保留合成数据的证据，不保存导出正文、安装包或密钥。

没有执行真实账号、长虹实机、ARMv7运行、**原身份覆盖升级**、物理断电或大库性能验收；本轮未重跑90秒播放/系统重启或Windows回归。原签名仍缺失，不能发布可覆盖旧版的新包。并行迁移的原型通过不代表已选择新的长期分发身份。本轮不更改数据库 schema、正式应用身份或版本，不发布安装包。
