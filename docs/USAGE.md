# 安装与使用

[返回项目首页](../README.md) · [文档目录](README.md)

## Windows 安装

需要 Windows 10 / 11 x64。若已有构建好的发行产物，可运行 `release/INSTALL.cmd`，或使用 `release/RUN-PORTABLE.cmd` 启动免安装版。源码仓库不保证包含这些产物；自行构建见[开发与打包](DEVELOPMENT.md)。安装失败见[故障排查](TROUBLESHOOTING.md)。

## 配置 TMDB

1. 到 <https://www.themoviedb.org/settings/api> 免费申请 API Key（v3 Key 或 v4 读取令牌均可）。
2. 应用内「设置 → 影视元数据」粘贴 Key，点「保存并验证」——会真实请求一次 TMDB 后才保存。
3. 「添加影视作品 → 搜索 TMDB」输入片名，从真实结果中挑选，确认后才会写入本地。

实现要点：

- 请求地址优先 `https://api.tmdb.org/3`，失败自动回退 `https://api.themoviedb.org/3`（部分网络只放行其一）。
- 超时 12 秒；401 → Key 无效；429 → 限流；404 → 无此资料；网络错误与超时分别给出中文提示。
- 中文简介为空时自动回退一次英文，避免详情页空白。
- 导入时同步下载海报（w500）与背景图（w1280）到本地缓存；**下载失败不会导致导入失败**，界面会提示「图片未能缓存」。
- 「刷新 TMDB 资料」只更新外部字段与图片，评分、笔记、收藏理由、专题、夸克资源都不受影响。

本产品使用 TMDB API，但未获得 TMDB 的认可或认证。

## 夸克资源

原有分享资源记录仍支持：资源名称、分享链接（http/https）、可选提取码、清晰度 / 版本 / 字幕 / 音轨、备注、状态（未检查 / 可用 / 不可用）。

- 应用**不会**访问、解析、下载或验证链接，也不会自动把状态标成「可用」。
- 「复制链接」写入剪贴板；「打开」经协议校验后交给系统默认浏览器。
- 删除一条资源只删除该记录，作品与收藏条目保持不动。

目前没有应用内“关联夸克账号”的登录或授权入口。“选择授权工具”是选择已在外部完成授权的本机工具，不是账号登录。自动读取指定云端文件夹需要独立安装并授权夸克官方工具，配置步骤和当前边界见[夸克目录接入](QUARK-FOLDERS.md)。当前支持读取视频清单与识别文件名线索，尚未完成 TMDB 自动入库与作品关联，真实账号链路待验收。

## 数据与备份

所有可变数据位于 Electron 的 `userData` 目录（默认 `%APPDATA%\My Cinema`），**升级应用不会清理数据**：

```
%APPDATA%\My Cinema\
├─ library.db            SQLite 数据库（影视资料 / 收藏 / 专题 / 夸克资源 / 设置）
├─ library.db-wal        WAL 日志
├─ images\               海报与背景图缓存（数据库只存相对路径）
│  ├─ poster\<2位散列>\<sha1>.png
│  └─ backdrop\...
├─ backups\              手动备份与恢复前的自动快照（pre-restore-*.db）
├─ exports\              JSON 导出
├─ logs\app.log          运行日志（已脱敏，滚动 2 MB）
├─ credentials.json      safeStorage 加密后的 TMDB API Key
└─ window-state.json     窗口尺寸 / 位置
```

- 卸载程序**不会**删除上述目录（`deleteAppDataOnUninstall: false`）。需要彻底清除时请手动删除该目录。
- 图片缓存丢失不影响收藏：数据库只保存相对路径，界面会自动回退为排版式占位图，重新获取元数据即可再次缓存。
- 备份可用 `VACUUM INTO` 生成一致性快照；恢复前会自动把当前数据库另存为 `pre-restore-*.db`，恢复失败自动回滚。
- 日志中的 API Key、JWT、`?pwd=` / `access_code=` 参数以及已登记的提取码都会被替换为 `[redacted]`。

夸克源配置与可重建清单另存于 `quark-source.json` 和 `quark-inventory.json`，不包含在收藏数据库备份内；官方工具独立管理授权。

## 快捷键

| 快捷键 | 行为 |
|---|---|
| `Ctrl K` | 打开 / 关闭全局搜索（作品 + 页面跳转，支持 ↑↓、Enter） |
| `Ctrl F` | 跳转影视库并聚焦搜索框（在输入框内不抢占） |
| `Ctrl I` | 打开「添加影视作品」（在输入框内不抢占） |
| `Esc` | 关闭弹窗、搜索面板 |
| `Tab` / `Enter` | 在弹窗内循环焦点；Enter 激活当前操作 |
