# 开发与打包

[返回项目首页](../README.md) · [文档目录](README.md)

## 环境要求

- Windows 10 / 11（x64）
- Node.js ≥ 22（开发与构建时；应用本身由 Electron 自带运行时）
- pnpm 11（仓库使用 hoisted `node_modules`，见 `.npmrc`）

## 常用命令

```powershell
# 1. 安装依赖
pnpm install

# 2. 首次安装若 Electron 二进制未下载（网络受限时），使用可续传脚本：
node scripts/fetch-electron.mjs

# 3. 开发模式（Vite HMR + 主进程热重启）
pnpm dev

# 4. 类型检查 + 构建（dist-electron/ + dist/）
pnpm build

# 5. 自动化测试
pnpm test

# 6. 直接运行已构建版本
pnpm start:prod

# 7. 生成 Windows 安装包（release/）
pnpm package
```

### 网络受限时的说明

- `pnpm install` 会从 npm registry 取包；Electron 二进制默认从 GitHub 下载。若失败，`node scripts/fetch-electron.mjs` 会按 4 MB 分块续传（默认使用 npmmirror 镜像，失败再回退 GitHub），并解压到 `node_modules/electron/dist`。
- 打包时 electron-builder 需要 NSIS 等工具与 Electron 压缩包。若 `github.com` 不可达（此前环境曾出现被解析到 `127.0.0.1` 的情况），可把 `electron-v45.0.0-win32-x64.zip` 放到 `.eb-cache/electron/` 再打包，或设置 `ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/` 与 `ELECTRON_CUSTOM_DIR={{ version }}`。
- `pnpm package` / `pnpm package:dir` 走 `scripts/package.mjs`：它会把 `TMP`/`TEMP` 指到项目内 `.tmp`、把 `.tools` 加进 PATH、补齐 builder 缓存与镜像，因此不再需要手工导出环境变量。

### 安装与故障排查

- **最简单的方式**：双击 `release\INSTALL.cmd`。
  它把临时目录放在安装包旁边（`release\mc-temp`），先写探针确认可写，再直接调用安装器；窗口会保留并打印退出码，不会一闪而过。
- **完全跳过安装器**：双击 `release\RUN-PORTABLE.cmd`，解压到 `release\portable\` 并启动；或手动解压
  `release\My-Cinema-1.1.0-portable-win64.zip`。与安装版共用同一份 userData。
- 命令行等价物：`pnpm install:app` / `pnpm run:portable` / `pnpm doctor`。
- 安装包本体：`release\My-Cinema-1.1.0-Setup.exe`（直接双击可能受系统临时目录影响），按用户安装、不请求管理员权限。
- 应用本身已把 Chromium 的临时文件放进 `%APPDATA%\My Cinema\tmp`，因此系统 TEMP 有问题时应用仍可运行，只有安装器 / 卸载程序（均为 NSIS）受影响。卸载请用「设置 → 应用」或控制面板。
- 其它问题见 [故障排查](TROUBLESHOOTING.md)。

## 架构与验证

Electron 45 主进程负责 SQLite、网络和本机文件，React 19 / TypeScript / Vite 7 渲染界面。使用原生 CSS，不依赖 UI 框架。分层、目录与安全模型见[架构说明](ARCHITECTURE.md)，测试和实际验收状态见[验证与交付](VERIFICATION.md)。历史安装包大小与哈希不能用于判定当前构建产物。


## 发布 GitHub Release

发布前必须遵循[版本与发布规则](VERSIONING.md)：新增功能升 MINOR，修复升 PATCH；每次分发的新内容使用新版本，预览使用独立后缀，不覆盖旧资产。

仓库提供手动触发的 [Windows release 工作流](../.github/workflows/release.yml)，在 Windows runner 上依次执行冻结锁文件安装、测试、构建、真实 Electron 检查、NSIS 与免安装 ZIP 打包。`pnpm-workspace.yaml` 明确允许所需依赖的构建脚本。

产物通过 `scripts/verify-release.mjs` 核对版本、Windows x64 程序与 SQLite 原生模块、主进程/preload/渲染资源后，生成 SHA-256 校验文件并发布。发布前检查会拒绝复用已有 Tag/Release，预览版自动标记 prerelease。版本取自 `package.json`，发布说明位于 [RELEASE-NOTES.md](RELEASE-NOTES.md)。已有同名版本时会停止，不覆盖已发布资产；下次发布应更新版本与说明。

具备仓库权限时可在 GitHub Actions 页面点击 Run workflow，或运行：

```bash
gh workflow run release.yml --ref main
```

安装包未签名；发布成功不代表已在个人电脑上完成安装、缩放和真实账号验收。
