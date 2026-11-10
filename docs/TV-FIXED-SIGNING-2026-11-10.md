# TV 新固定签名（2026-11-10）

用户明确授权改用新签名，尚未实机测试，不再等待恢复旧签名。开发版本升为 **0.2.0-alpha.5 / code8**；Windows版本、数据库schema和应用ID `io.mycinema.tv` 保持不变。尚未发布新安装包。

## 当前身份

- 新证书 SHA-256：`be6ca6625b1cc4457d0e016fe8c7b300cd0285cf2cee0ae9ac9e8ed79a8249ad`，见当前 `android-tv/development-signing.sha256`。
- RSA3072，固定私有 Keystore；只在这次明确换签时生成，不在每次构建时生成。
- 旧alpha.2/alpha.3证书：`0e343d7d8d91f931b0350b7c01f87115f2fc7daf6402c0baee8276ced4a9bd44`，存档为 `android-tv/legacy-development-signing.sha256`。历史Tag、APK和证据不修改。

新签名不能覆盖旧签名的同应用ID安装。新用户可全新安装；若旧安装已有数据，先使用旧版可用的备份或[只读导出工具](TV-SIGNING-MIGRATION-2026-11-10.md)，确认备份有效后再迁移。账号登录信息不迁移。不把新证书签出的包描述成可保留旧安装直接升级。

## 私有存储与当前限制

新 Keystore 已写到本环境的仓库外私有目录，目录权限700、文件权限600；Base64配置文件与 Keystore 同样私有。它们没有进入Git、日志或Actions产物。**这只是本环境保存，不等于长期备份已经完成。** 必须在环境回收前将原文件保存在私人位置，并配置GitHub Actions Secret。

约定Secret名称为 `TV_DEVELOPMENT_KEYSTORE_BASE64`。本轮读取GitHub Secrets公钥接口返回 `403 Resource not accessible by integration`，通过 `gh secret set` 保存也失败；当前连接无此管理权限。因此尚未完成远端托管，常规固定签名构建继续拒绝缺失密钥，不生成替代签名。

仓库设置入口：<https://github.com/StQuasimodo/Media-Library/settings/secrets/actions/new>。Name填写上述名称；Secret填写私有配置文件内容。仅在GitHub受保护设置中保存，不把内容发到聊天或提交Git。

有相应权限的本机GitHub CLI也可使用：

```sh
python3 scripts/upload-tv-signing-secret.py --keystore <私有Keystore文件路径>
```

脚本先确认私人密钥和当前固定指纹，仅通过stdin将Base64交给 `gh secret set`，不把正文放进命令参数或错误输出。上传失败不修改本地密钥或指纹。

## 构建与发布约束

常规构建、独立签名准备和回归均从Secret恢复固定密钥，删除原签名缓存读取；不把缓存当作托管，也不自动保存密钥到缓存。作业结束清除runner上的密钥文件。恢复脚本继续核对私人密钥、证书指纹和调用方期望值，缺失或不匹配立即失败。

这份密钥后续跨alpha、beta与正式版本继续使用。关闭debuggable、调整构建类型不要求换签；不能为了进入beta再生成另一份密钥。之后的身份变化仍需明确授权和迁移方案。

包校验在固定签名模式核对实际APK证书；code8起发布脚本还要求 `pinnedSignerVerified=true`。原有API21/v1、ARMv7/x86、精确原包字节与完整API22播放回归门禁保留。只有新密钥托管就绪、实际候选包完整回归通过，才可发布预览。

旧版导出/并行迁移实验改用存档指纹校验历史APK，测试身份仍显式使用code7→8，避免随正式开发版本变化而误判。该实验的临时测试签名始终不作分发签名。

## 验证记录

新私人密钥已通过实际 keytool 检查；使用历史APK的临时副本做签名可用性检查，apksigner以minSdk21验证v1/v2通过，证书等于新固定指纹。该副本没有交付，不能当成新版本构建或Android运行结果。

本机尝试获取SDK36失败，sdkmanager无法获取远端清单，未声称本机完成新应用构建。新固定签名的API22安装、同签名升级、完整播放与目标电视运行仍待验证；远端构建还需先完成受保护Secret配置。

[Actions验证](https://github.com/StQuasimodo/Media-Library/actions/runs/42841694886)通过，实际源码 `9d7205de9db14cea4d185fb05bcb15da4442874a`：18项工具检查、SDK36下Gradle构建/Lint（0错误/17警告）、API22历史旧APK导出/异签名拒绝/并行导入/测试身份code7→8升级通过。测试密钥仅用于实验；这个通过结果不表示新固定密钥已托管或已在Android运行。

[构建身份](../artifacts/tv-fixed-signing-2026-11-10/BUILD.json) · [密钥本机检查](../artifacts/tv-fixed-signing-2026-11-10/LOCAL-CHECK.json) · [API22结果](../artifacts/tv-fixed-signing-2026-11-10/summary.json) · [本次作业的Secret未就绪报告](../artifacts/tv-fixed-signing-2026-11-10/active-signer.json)。没有生成新的Release或上传私人密钥。下一步为Secret配置后运行 `Android TV API 22 preview` 完整候选流程；固定签名包通过原播放/收藏回归后，才能从原始产物发布。
