# 版本与发布规则

[开发与打包](DEVELOPMENT.md) · [当前发布说明](RELEASE-NOTES.md)

## 版本编号

`package.json` 的 `version` 是应用版本的唯一来源。安装包、免安装 ZIP、应用「关于」与 GitHub Tag 必须一致，Tag 使用 `v<version>`。本轮从 `1.0.0` 更新为 `1.1.0`，数据库仍为 schema v2。

| 变更 | 编号 | 示例 |
|---|---|---|
| 向后兼容的修复、排版或打包修正 | PATCH | `1.1.0 → 1.1.1` |
| 向后兼容的新增功能 | MINOR，PATCH归零 | `1.0.0 → 1.1.0` |
| 破坏兼容性的变更 | MAJOR，其余归零 | `1.1.0 → 2.0.0` |
| 向用户提供的预览包 | 下一目标版本加 `alpha.N`、`beta.N` 或 `rc.N`，N从1递增 | `1.1.1-beta.1 → 1.1.1-beta.2 → 1.1.1` |

- **每次分发含新内容的安装包或预览包，先更新版本号。** 普通源码提交不必升版；已发布的相同产物可以重复下载。
- 不得用同一个版本号发布不同内容，不覆盖既有 Tag、Release 或其资产。此前多个 `1.0.0` Actions 预览属于历史遗留，从本规则起停止复用。
- 未发布的失败构建可在相同源码上重试。分发过的预览包若改动内容，必须递增预览编号；正式版不沿用预览后缀。
- 本项目维护一条发布线，新版本须高于已发布版本。预览用 GitHub prerelease，不设为 Latest；正式版设为 Latest。
- 应用版本与数据库 schema 独立。升版不代表迁移数据库；保持 appId、productName、userData 和凭据格式稳定，除非有经过验证的迁移方案。

## 发布步骤

1. 检查 Git 状态，保留已有修改。确定 PATCH / MINOR / MAJOR 或新的预览编号，修改 `package.json`。
2. 更新 [RELEASE-NOTES.md](RELEASE-NOTES.md)，写明变化与未完成的验收。更新当前使用说明；历史报告保留原版本和哈希。
3. 提交并推送源码。记录构建 commit；Tag 必须指向该 commit，不把后续文档提交冒充构建源码。
4. 运行 [Windows release](../.github/workflows/release.yml)。流程先执行 `scripts/check-release-version.mjs`，阻止复用已有 Tag/Release，检查版本递增与编号格式。
5. 测试、类型检查、构建、真实 Electron 和 Windows 加密凭据兼容检查通过后，打包并核对包内版本/资源/原生模块，生成 `SHA256SUMS.txt`。
6. 发布安装包、免安装 ZIP 和校验文件，记录工作流、commit、下载链接与真实结果。构建成功不等于个人电脑或真实 TMDB/夸克账号验收成功。

常规打包和发布脚本都从 `package.json` 读取版本，不手工改名旧安装包。当前 pnpm 锁文件不记录根包版本，单纯升版无需重写依赖锁文件。

仅构建 Actions 集成预览时使用 [Integrated Quark preview](../.github/workflows/integrated-preview.yml)，它要求预览后缀并检查已有 Tag/Release。Actions 产物不自动创建版本占位 Tag；维护者仍须为已分发的新预览递增编号，不能靠重复运行绕过规则。

## 交付文件

以 `1.1.0` 为例：`My-Cinema-1.1.0-Setup.exe`、`My-Cinema-1.1.0-portable-win64.zip`、Tag `v1.1.0`。`INSTALL.cmd` 和 `RUN-PORTABLE.cmd` 自动引用当前版本；SHA-256 必须来自本次实际打包产物。
