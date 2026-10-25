# 夸克网页登录会话验证工具

这是与正式My Cinema分开的实验工具，验证“官方网页登录 → 本机会话 → 只读目录访问”。不依赖Skill、Codex或DSH，不改正式版数据库、配置或收藏，不生成分享链接、不自动导入TMDB。

## 自动验证结果（2026-10-25）

[Windows构建与检查](https://github.com/StQuasimodo/Media-Library/actions/runs/40156521106)全部完成：90项测试、原型类型检查、打包后本地控制界面/preload/IPC、官方登录页面与登录文字、匿名目录要求登录、远端无Node/本地桥接、测试Cookie跨进程持久化均通过。构建源码为`a9354c0`。

[下载Windows验证工具产物](https://github.com/StQuasimodo/Media-Library/actions/runs/40156521106/artifacts/12584364978)（需登录GitHub；产物内包含便携ZIP和SHA-256文件）。[本地界面报告](../artifacts/research-2026-10-25/windows-quark-web-packaged-local.json)、[初次网页检查](../artifacts/research-2026-10-25/windows-quark-web-write.json)、[重启检查](../artifacts/research-2026-10-25/windows-quark-web-read.json)。所有报告明确标注真实账号未验证。

第一次Windows尝试等待整页加载超时；调整为有界的可信顶层DOM和登录文字检查后通过，未跳过TLS验证。当前Linux云环境的Electron有NSS/证书问题，在线检查未通过；Linux本地界面、类型检查与90项测试通过。Windows结果不能被描述为真实账号授权成功。

## 在Windows上验证

1. 从 [Quark web session validation构建记录](https://github.com/StQuasimodo/Media-Library/actions/workflows/quark-web-check.yml)下载便携验证工具产物。解开产物中的`My-Cinema-Quark-Web-Check-Windows.zip`，运行`My Cinema Quark Check.exe`。
2. 点击“打开夸克官方登录页”，在官方网页完成自己的正常登录或扫码；验证码、授权码、Cookie和Token不需要发给任何人。
3. 回到验证工具，点击“检查目录访问”。只有真实目录接口返回成功且结构合法，才显示“目录接口已验证可访问”；网页打开或浏览器登录界面消失不算成功。
4. 点击“读取当前文件夹”，进入一个已有的小影视目录。核对文件名、视频数量和子目录，尤其验证超过5项时未被截断。程序只读当前目录；进入子目录需点击，尚未实现自动递归同步。
5. 关闭工具与登录窗口，再重新打开工具并“检查目录访问”。这一步验证自己的真实登录会话是否可在重启后使用。
6. 可导出诊断结果，仅包含检查状态、请求次数、完成目录次数和时间，不含Cookie、账号、文件名或目录路径。请描述哪一步成功或报错，不要上传登录资料目录。

程序数据保存在独立的`%APPDATA%\My Cinema Quark Check`，与正式应用的`My Cinema`目录分离。使用Chromium专用持久会话，不读取日常浏览器配置。不擅自延长服务端Cookie有效期，因此真实重启验收仍必需。

## 已实现的边界

- 本地控制窗口和远端官方网页分离，远端不开Node集成、不加载本地preload，不暴露业务IPC，启用sandbox/contextIsolation。
- 官方网页顶层导航与弹窗仅允许HTTPS夸克域名；不接管或绕过验证码/风控，不接受其他协议。
- 目录请求固定到`drive-pc.quark.cn`的只读GET路径，通过专用Electron Session携带会话，自动接收服务端Cookie更新；不向本地界面传递Cookie或原始接口响应。
- 未登录`401/31001`与网络错误、访问限制分开处理；空的`account/info`成功响应不作为登录成功证据。
- 每个目录最多100页/10000项。缺页、重复FID、数量变化、超限或中途失败时不展示部分成功清单。界面只展示前200项，并显示完整读取总量。
- 不复制OpenList源代码、不引入其运行时；接口适配是本项目独立实现。网页会话路线不等于官方SDK承诺的长期接口，兼容性仍需维护。

## 自动验证与个人账号验收的区别

新增8项协议测试覆盖HTTP鉴权、访问限制、固定请求目标、分页、异常清单及导航边界。Windows工作流先启动打包后的便携程序，验证本地界面、preload和IPC，再上传工具；随后独立请求匿名目录接口，检查官方页面登录文字、远端没有Node/本地桥接、专用Session隔离，并在重启Electron后检查合成测试Cookie的持久化。

本地程序检查与网页网络检查分开记录。即使官方页面在CI网络中不可达，已通过本地启动检查的工具也可保留供个人电脑验证；网络检查仍会明确失败，不会被标成通过。下载前应查看当前构建的实际检查结果。

合成Cookie使用`.invalid`域名，值不是任何登录凭据，不发送到网络。CI不会扫码或登录，也不保存登录页截图/二维码。**自动检查通过不代表真实账号的目录读取或登录持久化通过。** 只有用户在本机完成上面第2至5步，才可推进正式应用的账号连接入口。

## 从源码运行

```powershell
node scripts/quark-web-check.mjs
```

Windows构建便携目录：

```powershell
node scripts/quark-web-check.mjs --package
```

类型检查配置位于`tools/quark-web-check/tsconfig.json`。该原型不改变正式应用打包内容与稳定版Release。
