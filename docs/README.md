# My Cinema 文档

本目录是项目的权威说明。README 是入口与快速开始；这里记录**要求、设计规则、架构细节与验证状态**，用于后续迭代时不必重新翻阅对话记录。

| 文档 | 内容 | 什么时候看 |
|---|---|---|
| [REQUIREMENTS.md](REQUIREMENTS.md) | 产品范围、功能要求、数据与安全要求、体验要求、验收标准（含状态标记） | 判断某个功能该不该做、是否已完成 |
| [DESIGN.md](DESIGN.md) | 视觉令牌、排版规则、PS5 式聚焦交互、动效、可访问性、组件约定 | 改界面之前 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 分层、IPC 清单、数据库结构与迁移、备份恢复、安全模型、目录树 | 改数据层/主进程之前 |
| [VERIFICATION.md](VERIFICATION.md) | 构建与测试命令、用例与需求的对应关系、截图清单、已知限制 | 交付前、排查回归 |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | 安装报错、打包失败、TEMP 不可用、DNS 污染、数据库异常的处理步骤 | 装不上 / 打包失败时 |
| [AUDIT-2026-10-24.md](AUDIT-2026-10-24.md) | 最近一次前端审计：发现、修复、证据 | 想了解为什么这样写 |

## 维护约定

- 需求变化时**先改 REQUIREMENTS.md**，再改代码；完成一项就把状态标记从 `[ ]` 改为 `[x]`。
- 设计规则变化（令牌、间距、动效时长）必须同步 DESIGN.md，避免代码与规范各行其是。
- 新增 IPC 通道、数据库迁移或目录变化时更新 ARCHITECTURE.md 的对应表格。
- 每次交付前把真实执行结果（测试数量、构建产物、截图）写进 VERIFICATION.md，不写「预计」「应该」。

## 当前状态（2026-10-24）

| 项目 | 值 |
|---|---|
| 版本 | 1.0.0 |
| 数据库 schema | v2 |
| 自动化测试 | 4 个文件 / 49 个用例，全部通过 |
| 安装包 | `release/My-Cinema-1.0.0-Setup.exe`（115.59 MB） |
| 免安装版 | `release/My-Cinema-1.0.0-portable-win64.zip`（161.83 MB） |
| 界面截图 | `artifacts/screenshots/` 共 16 张 |
| 未验证项 | Electron 窗口启动、TMDB 带 Key 的在线搜索、安装器静默安装（见 VERIFICATION.md） |
