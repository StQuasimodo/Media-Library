# My Cinema 文档

本目录是项目的权威说明。README 是入口与快速开始；这里记录**要求、设计规则、架构细节与验证状态**，用于后续迭代时不必重新翻阅对话记录。

| 文档 | 内容 | 什么时候看 |
|---|---|---|
| [USAGE.md](USAGE.md) | 安装、TMDB 配置、资源记录、备份与快捷键 | 首次使用应用 |
| [VERSIONING.md](VERSIONING.md) | 应用版本、预览编号、Tag 与发布检查规则 | 打包或向用户分发前 |
| [ANDROID-TV.md](ANDROID-TV.md) | API21/22原生电视端、独立收藏、遥控器与后续WebDAV/播放计划 | 开发或安装电视预览 |
| [DEVELOPMENT.md](DEVELOPMENT.md) | 环境要求、开发、构建、测试与 Windows 打包 | 从源码开发 |
| [GALLERY.md](GALLERY.md) | 最新界面截图及其验证范围 | 查看产品外观 |
| [QUARK-MATCHING.md](QUARK-MATCHING.md) | 自动目录匹配、资源规格识别、增量关联、升级与验收边界 | 使用1.2预览版自动整理网盘影视 |
| [QUARK-FOLDERS.md](QUARK-FOLDERS.md) | 官方工具授权、目录读取配置与待验收边界 | 连接指定夸克文件夹 |
| [QUARK-AUTH-RESEARCH.md](QUARK-AUTH-RESEARCH.md) | 授权命令、Agent 与 Windows 限制、应用内账号连接方案 | 开发夸克账号连接之前 |
| [QUARK-VALIDATION.md](QUARK-VALIDATION.md) | 独立运行诊断、真实授权、目录完整性与收藏关联的验收步骤 | 验证夸克连接是否真的可用 |
| [QUARK-WEB-CHECK.md](QUARK-WEB-CHECK.md) | 应用内网页登录、预览下载、目录验收与早期独立工具记录 | 验证不依赖Skill的网页登录路线 |
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

## 当前状态（2026-10-26）

| 项目 | 状态 |
|---|---|
| 版本 / 数据库 | beta.2 rev3修订，应用版本仍1.2.0-beta.2 / schema v4；正式版1.1.0 / schema v2 |
| 自动化测试 | v1.2.0-beta.2：13个文件、142项通过，含系列分类、自然排序、目录增量及v2/v3→v4迁移 |
| 构建与界面 | Windows构建、包校验、真实Electron、受控自动匹配、无菜单复制快捷键、网页登录隔离和加密兼容检查通过 |
| 当前截图 | [界面预览](GALLERY.md)，含Windows自动匹配、文件规格与系列筛选展示 |
| Windows 发行产物 | [1.2.0-beta.2 rev3修订版](https://github.com/StQuasimodo/Media-Library/releases/tag/v1.2.0-beta.2)已发布，真实安装器取消快捷方式/记忆选择检查通过；Latest保留1.1.0 |
| 待验收 | 个人电脑完整升级、字体与缩放；真实TMDB带Key在线匹配；夸克真实账号目录与会话重启 |

详细证据见[验证说明](VERIFICATION.md)与[修复记录](REPAIRS-2026-10-24.md)。
