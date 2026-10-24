# 夸克指定目录读取：官方方案与当前实现

> 2026-10-25 补充核验：官方分发 CLI 存在受支持 Agent 环境识别，My Cinema 不在识别列表；README 的 Windows 支持表与安装脚本分支也有差异。现有桥接不能视为已支持独立 Windows 应用。账号接入前提、证据与开发方案见[账号连接核验](QUARK-AUTH-RESEARCH.md)。

## 产品边界更新

2026-10-24，用户明确将原先“仅手动记录分享链接”扩展为“自动读取我夸克网盘指定文件夹中的影视资源”。本功能读取云端目录元数据，不要求上传本地视频。

当前完成：选择本机授权工具 → 浏览并选择云端目录 → 可选递归读取 → 展示视频清单与片名/年份/季集线索 → 可选启动时重新读取。原有收藏、专题、评分、分享链接记录继续保留。没有改变数据库结构。

**尚未完成：真实账号联调、TMDB自动匹配、把云端文件稳定关联到收藏作品，以及基于该关联的增量入库。** 当前不会把每集电视剧或同名版本自动写成独立电影，也不会伪造分享链接。界面明确标注清单尚未入库。

## 官方资料核验

核验来源：

- [夸克官方仓库](https://github.com/quark-clouddrive/quarkclouddrive_offical)
- [官方 Skill 文档](https://github.com/quark-clouddrive/quarkclouddrive_offical/blob/main/skills/quarkclouddrive/SKILL.md)
- [官方授权说明](https://github.com/quark-clouddrive/quarkclouddrive_offical/blob/main/skills/quarkclouddrive/references/auth.md)
- [官方目录与文件操作](https://github.com/quark-clouddrive/quarkclouddrive_offical/blob/main/skills/quarkclouddrive/references/file-ops.md)
- [完整结果协议](https://github.com/quark-clouddrive/quarkclouddrive_offical/blob/main/skills/quarkclouddrive/references/file-search.md)

公开安装配置接口 `https://open-api-drive.quark.cn/agent/v1/skill_config` 在携带req_id后返回成功，版本为1.0.25，分发地址为 `https://pdds.quark.cn/download/stfile/eekkigineefiegmgo/quarkclouddrive-1.0.25.zip`。本轮仅核验了官方文档和分发元数据，未安装、执行官方工具或授权账号；不把这些结果当作目录读取成功。版本和分发信息可能变化，应以官方当前页面为准。

官方文档确认：

- 浏览器OAuth授权；不需要应用接收密码或Cookie。
- `browse --parent-fid <完整FID> --all` 获取指定目录的全部直接子项，**不自动递归**。
- stdout的result只预览最多5条；全部记录在artifact指向的JSONL中。缺少完整artifact或分页失败，不能以预览代替。
- FID需保留完整原值调用。文档规定的本地去重指纹为最后一个非空`|`尾串，大小写敏感；不用文件名或hash当文件身份。
- 某些字段或查看链接可能不存在，不应自行猜测或生成。

这是My Cinema调用用户本机独立官方工具的兼容桥接，不代表My Cinema取得了夸克独立应用OAuth客户端资质，也没有把官方Skill重新打包进安装器。未采用逆向Cookie接口、OpenList或WebDAV。

## 在Windows上启用

1. 按上述官方仓库说明独立安装并完成浏览器OAuth授权。不要把密码、Cookie、Token或授权码发送到本项目聊天中。
2. 在My Cinema「设置 → 夸克文件夹」选择已安装的`quark-drive.cjs`。选择的是可执行工具，不是待上传的影视文件；工具须来自可信的官方安装。
3. 点击“选择云端文件夹”，逐层进入目标目录，选择是否包含子目录，以及是否在启动时读取。
4. 点击“读取此文件夹”，检查清单中的完整文件名、目录位置及识别线索。

My Cinema只执行browse读取命令，不调用上传、下载、分享、移动、改名或删除。实际OAuth授权范围由夸克决定，可能比应用扫描的单个目录更大；请在夸克端核对和管理授权。本应用的目录限制不等于服务端授予了目录级最小权限。

如果工具尚未安装、未授权、授权过期或接口行为与公开文档不同，界面会报告读取失败；不自动调用login，不绕过授权，也不反复尝试账号操作。本轮尚不能远程完成用户Windows端的安装和授权。

## 本地状态与范围

- `userData/quark-source.json`：工具路径、选定目录、递归与自动读取设置；无账号凭据。
- `userData/quark-inventory.json`：上次成功清单，可从网盘重建，不是收藏数据库。
- 每次查询在独立临时工作目录落盘，结束后清理；artifact必须位于本次目录的browse子目录中，禁止读取外部任意文件或跨目录结果。
- 每次最多200个目录、32层、20000条目录项；超过上限失败并建议缩小范围，不把部分结果称为全量。每个CLI调用超时60秒；用户可取消。
- 成功后原子替换清单。失败或取消保留同一范围的上次成功清单；改变目录或递归范围时不展示旧范围缓存。
- UI在全量清单上过滤，最多展示100个匹配条目，并明确展示总匹配数与当前展示数。
- 数据库备份/JSON导出仍针对个人收藏；不包含这份可重建的目录缓存，也不包含官方工具的授权配置。
- 启动时自动读取仅在用户明确选定目录并启用该项后运行。不会默认扫描全盘。

## 验证范围

`tests/quark.test.ts` 验证完整结果协议、预览截断、防越界、分页不完整、FID去重、授权错误与notice、真实子进程调用、目录范围、递归循环、取消、失败保留旧结果、范围切换、启动读取、无扩展名视频、中文与英文文件名线索。CLI契约测试使用可控替身，**不是官方真实账号请求**。

真实Electron检查命令：

```bash
pnpm build
pnpm test:desktop --headless --no-sandbox --quark-fixture --artwork-dir .harness/artwork
```

该命令在独立测试userData中安装一个仅用于验收的假CLI，检查真实preload、IPC、子进程、目录选择和清单渲染，报告中标记`quarkFixture:true`；不连接真实网盘。`--no-sandbox`仅为当前隔离Linux云环境诊断参数，不修改产品窗口的sandbox配置，不代表Windows验收成功。

## 下一步验收与入库设计

先用已授权官方工具验证一个小的真实影视目录：范围正确、超过5条完整读取、子目录、中文名、季集、授权过期和重复读取。收到实际响应差异后调整适配器，不能以模拟响应宣布真实兼容。

随后设计稳定的源目录/远端文件ID与作品关联：高置信度匹配TMDB后导入，同一作品多个版本及多集归并；歧义进入待确认队列；同步不覆盖评分/短评，不因云端暂时不可见而删除个人收藏。届时若需数据库迁移，必须先备份并覆盖迁移/恢复测试；本轮不提前建立未经实际联调验证的关联schema。
