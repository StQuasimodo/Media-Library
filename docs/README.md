# My Cinema 文档

本目录是项目的权威说明。README 是入口与快速开始；这里记录**要求、设计规则、架构细节与验证状态**，用于后续迭代时不必重新翻阅对话记录。

| 文档 | 内容 | 什么时候看 |
|---|---|---|
| [USAGE.md](USAGE.md) | 安装、TMDB 配置、资源记录、备份与快捷键 | 首次使用应用 |
| [DEVELOPMENT.md](DEVELOPMENT.md) | 环境要求、开发、构建、测试与 Windows 打包 | 从源码开发 |
| [GALLERY.md](GALLERY.md) | 最新界面截图及其验证范围 | 查看产品外观 |
| [QUARK-FOLDERS.md](QUARK-FOLDERS.md) | 官方工具授权、目录读取配置与待验收边界 | 连接指定夸克文件夹 |
| [QUARK-AUTH-RESEARCH.md](QUARK-AUTH-RESEARCH.md) | 授权命令、Agent 与 Windows 限制、应用内账号连接方案 | 开发夸克账号连接之前 |
| [QUARK-VALIDATION.md](QUARK-VALIDATION.md) | 独立运行诊断、真实授权、目录完整性与收藏关联的验收步骤 | 验证夸克连接是否真的可用 |
| [QUARK-WEB-CHECK.md](QUARK-WEB-CHECK.md) | 独立网页登录与目录验证工具、Windows实机操作步骤 | 验证不依赖Skill的网页登录路线 |
| [REQUIREMENTS.md](REQUIREMENTS.md) | 产品范围、功能要求、数据与安全要求、体验要求、验收标准（含状态标记） | 判断某个功能该不该做、是否已完成 |
| [DESIGN.md](DESIGN.md) | 视觉令牌、排版规则、PS5 式聚焦交互、动效、可访问性、组件约定 | 改界面之前 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 分层、IPC 清单、数据库结构与迁移、备份恢复、安全模型、目录树 | 改数据层/主进程之前 |
| [VERIFICATION.md](VERIFICATION.md) | 构建与测试命令、用例与需求的对应关系、截图清单、已知限制 | 交付前、排查回归 |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | 安装报错、打包失败、TEMP 不可用、DNS 污染、数据库异常的处理步骤 | 装不上 / 打包失败时 |
| [AUDIT-2026-10-24.md](AUDIT-2026-10-24.md) | 最近一次前端审计：发现、修复、证据 | 想了解为什么这样写 |
| [REPAIRS-2026-10-24.md](REPAIRS-2026-10-24.md) | 持续修复、视觉调整与实际验证证据 | 跟踪最近修改 |
| [HANDOFF-HISTORY.md](HANDOFF-HISTORY.md) | 此前 DSH 交付与产物记录，明确标记为历史结果 | 查阅交接历史 |

## 维护约定

- 需求变化时**先改 REQUIREMENTS.md**，再改代码；完成一项就把状态标记从 `[ ]` 改为 `[x]`。
- 设计规则变化（令牌、间距、动效时长）必须同步 DESIGN.md，避免代码与规范各行其是。
- 新增 IPC 通道、数据库迁移或目录变化时更新 ARCHITECTURE.md 的对应表格。
- 每次交付前把真实执行结果（测试数量、构建产物、截图）写进 VERIFICATION.md，不写「预计」「应该」。

## 当前状态（2026-10-24）

| 项目 | 状态 |
|---|---|
| 版本 / 数据库 | 1.0.0 / schema v2 |
| 自动化测试 | 最近一次业务测试：8 个文件、82 项通过 |
| 构建与界面 | Windows Release 构建、82项测试、真实 Electron 与包内容验证通过；Linux 诊断检查也已通过 |
| 当前截图 | [界面预览](GALLERY.md)，与最近一次字体调整一致 |
| Windows 发行产物 | [v1.0.0 已发布](https://github.com/StQuasimodo/Media-Library/releases/tag/v1.0.0)；此前 DSH 产物见[历史记录](HANDOFF-HISTORY.md) |
| 待验收 | Windows 安装后的完整桌面、字体与缩放；真实 TMDB 在线链路；夸克真实账号目录读取 |

详细证据见[验证说明](VERIFICATION.md)与[修复记录](REPAIRS-2026-10-24.md)。
