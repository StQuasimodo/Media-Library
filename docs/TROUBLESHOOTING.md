# 故障排查

先跑一次环境检查，它能覆盖大多数「装不上 / 打不开 / 构建失败」的问题：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\check-environment.ps1
```

---

## 1. 安装时报 “error writing temporary file, please make sure your temp folder is valid”

**来源**：NSIS 安装器在启动时必须把自己的解包内容写进 `%TEMP%`。这条消息不是 My Cinema 应用报的，而是安装器外壳报的。**已在本机复现并验证**：同一台机器上，`TEMP` 指向受限目录时安装器在初始化阶段即失败；把 `TEMP` 固定到可写目录后，静默安装返回 `exit 0` 并正常落盘。

**双击即用的解法**（不用记命令）：

```text
release\INSTALL.cmd          ← 双击这个，不是 Setup.exe
```

它做了三件事，全部是为了不依赖系统环境：

1. 在**安装包旁边**创建 `release\mc-temp` 作为临时目录（同一卷，谁能打开安装包谁就能写），不再使用 `%TEMP%` 或 `%LOCALAPPDATA%`；
2. 先写一个探针文件验证可写；失败就直接告诉你哪个目录不可写，而不是让安装器报临时文件错误；
3. 直接调用安装器（不再用 `start` 派生），窗口保持打开并打印退出码，失败信息不会一闪而过。

**完全跳过安装器**：

```text
release\RUN-PORTABLE.cmd     ← 双击这个
```

解压到**安装包旁边的** `release\portable\`（约 4 秒），并同样把 TEMP 指向 `release\mc-temp`。

**如果仍然报错**：新窗口会停在 `pause` 并打印「temporary folder / exit code」。请把这几行发我，它能直接定位是目录不可写、被安全软件拦截，还是安装器自身的其它失败。

**原因**（按常见程度）

1. 安装器继承的临时目录不可写——包括 `%TEMP%` 被重定向、目录被删、ACL 被改坏；
2. 启动它的进程（IDE / 沙箱 / 受限宿主动作）对 `%LOCALAPPDATA%` 没有写权限，而旧版启动器把临时目录放在那里；
3. 安全软件拦截未签名安装器向临时目录写入 DLL/插件。

> 应用本身已经把 Chromium 的临时文件改到 `%APPDATA%\My Cinema\tmp`，所以**系统 TEMP 有问题时应用仍能运行**，只有安装器与卸载程序（都是 NSIS）会受影响。卸载建议用「设置 → 应用」或控制面板。

---

## 2. 打包时报 “!tempfile: Unable to create temporary file!”

`electron-builder` 调用 NSIS 编译安装包时同样需要可写的 `%TEMP%`。

现在不需要手工设置：用打包脚本即可，它会把 `TMP`/`TEMP` 指到项目内的 `.tmp`，并自动补好 `pnpm` 与镜像配置。

```powershell
pnpm package        # 安装包 + 免安装 zip
pnpm package:dir    # 只生成 release/win-unpacked
```

如果确实在手工调用 `electron-builder`，请先：

```powershell
$env:TMP = "D:\Media_Library\.tmp"; $env:TEMP = $env:TMP
$env:PATH = "D:\Media_Library\.tools;$env:PATH"
```

---

## 3. 打包时报 `connect ECONNREFUSED 127.0.0.1:443`

`github.com` 被解析到了本机（DNS 污染）。三种解法，任选其一：

1. 把 `electron-v45.0.0-win32-x64.zip` 放进 `.eb-cache/electron/`，electron-builder 会直接使用；
2. 设置镜像：`ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/` 与 `ELECTRON_CUSTOM_DIR="{{ version }}"`；
3. 运行 `pnpm electron:fetch` 先把 Electron 二进制下载到 `node_modules/electron/dist`。

---

## 4. `node_modules` 里没有 Electron 二进制

`pnpm install` 被跳过了 postinstall，或下载中断：

```powershell
node scripts/fetch-electron.mjs
```

该脚本按 4 MB 分块续传，优先 npmmirror，失败回退 GitHub，解压后写入 `path.txt`。

---

## 5. 应用启动提示“无法启动 My Cinema / 数据库文件已损坏”

- 数据库**不会被删除或覆盖**；先备份 `%APPDATA%\My Cinema\` 整个目录。
- 打开应用数据目录：设置页 →「数据目录 → 打开」。
- 用「设置 → 从备份恢复」选择 `backups\*.db`；恢复前会自动生成 `pre-restore-*` 快照，失败会回滚。
- 如果版本升级后打不开，可能是数据库版本较新：错误信息会提示 `NEWER_SCHEMA`。

---

## 6. 应用窗口无法创建 / 打开后立即退出

这是当前开发机的已知限制（Electron 在 `BrowserWindow` 阶段崩溃），与安装包无关。详见 `docs/VERIFICATION.md` 的「已知限制」。在普通 Windows 桌面会话中双击安装版或免安装版即可验证。

---

## 7. 元数据搜索提示「尚未配置 TMDB API Key」

设置页填入 TMDB 的 v3 Key 或 v4 读取令牌，点「保存并验证」（会真实请求一次 TMDB）。没有 Key 时除在线搜索外的功能全部可用。

---

## 8. 日志与诊断

- 日志：`%APPDATA%\My Cinema\logs\app.log`（滚动 2 MB，密钥与提取码已脱敏）。
- 设置页可直接打开数据目录、备份目录、图片缓存目录、日志目录。
- 提交问题时请附上：`check-environment.ps1` 的输出、日志末尾 50 行、以及出错截图。
