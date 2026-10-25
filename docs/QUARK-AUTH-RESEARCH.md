# 夸克账号连接：官方能力核验与实现方案

核验日期：2026-10-25（香港时间）。本次实际读取官方仓库、公开安装配置与分发包，静态检查 CLI；没有安装 Skill、执行 CLI、登录账号或访问用户网盘。

## 结论

账号授权、用户信息与目录读取有官方实现可参考，但目前的官方 Skill CLI 不能直接视为 My Cinema 的通用桌面 SDK。现有工程缺少授权服务和账号状态，此外还存在 Agent 环境识别与 Windows 支持范围两个接入前提。

推荐先确认官方支持的独立桌面应用接入方式，再实现“关联账号 → 官方授权 → 显示账号 → 选择目录 → 自动读取”。不能把选择工具路径当作关联账号完成，也不能通过伪装成其他 Agent 解决识别限制。

## 本次核验的证据

官方仓库读取时的 main：`a5830d99830c7e8bf46063ca90ac6deb1bbf1f3e`。以下固定链接记录本次文档版本；分发接口独立更新，不保证与 Git 提交一一对应。

| 来源 | 已确认内容 | 限制 |
|---|---|---|
| [官方 README](https://github.com/quark-clouddrive/quarkclouddrive_offical/blob/a5830d99830c7e8bf46063ca90ac6deb1bbf1f3e/README.md) | 浏览器 OAuth、账号信息；平台表列 Windows WSL 支持、原生 Windows 不支持 | 不能据此宣称普通 Windows 已兼容 |
| [授权文档](https://github.com/quark-clouddrive/quarkclouddrive_offical/blob/a5830d99830c7e8bf46063ca90ac6deb1bbf1f3e/skills/quarkclouddrive/references/auth.md) | `login`、`get-user-info`、`unauthorize`；重复有效授权可能返回 `-118` | `get-user-info` 包含两个请求，失败不一定代表账号退出；需区分网络与鉴权错误 |
| [文件操作文档](https://github.com/quark-clouddrive/quarkclouddrive_offical/blob/a5830d99830c7e8bf46063ca90ac6deb1bbf1f3e/skills/quarkclouddrive/references/file-ops.md) | `browse --parent-fid <FID> --all` 可列全部直接子项，不递归；完整清单需读 artifact | 已有 provider 可复用，但真实账号协议仍未联调 |
| [安装脚本](https://github.com/quark-clouddrive/quarkclouddrive_offical/blob/a5830d99830c7e8bf46063ca90ac6deb1bbf1f3e/skills/quarkclouddrive/install.sh) | 包含 CYGWIN/MINGW/MSYS 分支 | 与 README 的原生 Windows 支持表存在差异，脚本分支不等于完整功能支持 |
| [Windows 反馈 #9](https://github.com/quark-clouddrive/quarkclouddrive_offical/issues/9) | 社区提出 Windows 版本需求，本次读取时无回复 | 用户反馈，不能替代官方兼容性结论 |
| [Agent 识别反馈 #4](https://github.com/quark-clouddrive/quarkclouddrive_offical/issues/4) | 社区反馈 `-104` 无法识别 Agent 环境 | 本次分发代码中也存在对应检查，不只是个别使用者描述 |

公开配置接口 `https://open-api-drive.quark.cn/agent/v1/skill_config` 携带随机 `req_id` 后返回版本 `1.0.25`，下载地址为 `https://pdds.quark.cn/download/stfile/eekkigineefiegmgo/quarkclouddrive-1.0.25.zip`。

本次通过保留 TLS 校验的 HTTPS 下载，仅在 `/tmp` 做静态检查。ZIP 大小 289229 字节，SHA-256 为 `56c34e9a9313ae29d39475b4ff9da9e92fbfd59699bf5843e3382e54434fffb8`。此为本次自行计算的指纹，不是官方签名或独立供应链认证。未把分发包加入仓库。

静态检查 `scripts/quark-drive.cjs` 发现：

- CLI 版本字串为 `1.0.25-876f30d`，内含 SDK 实现；不是只有登录外壳。
- 在命令执行前识别受支持的 Agent，识别失败会拒绝继续；列表不包含 My Cinema。因此独立桌面程序不能直接套用当前 CLI 的身份与配置机制。
- 分发代码的浏览器登录分支使用授权页面与 page-code 轮询；授权文档仍描述本地授权服务器。具体流程应以受支持接口和真实测试为准，不能提前固定为本地回调或 PKCE。
- 包中可见授权页、用户信息与令牌更新实现，但发现地址或 SDK 代码不代表 My Cinema 获得独立接入资格；不能复制其内置身份或签名材料作为自己的客户端凭据。

本次没有确认一个面向个人 Windows 桌面应用、可自助注册客户端并完整公开接入契约的渠道。不能把“未确认”写成“官方一定不提供”。

## 路线选择

| 路线 | 对用户的体验 | 前提与判断 |
|---|---|---|
| 独立官方 API / SDK | 应用内点关联，在系统浏览器授权，返回后显示账号 | 首选。需官方支持的客户端身份、授权/续期/撤销契约和 Windows 兼容方式；不依赖 Skill 运行时 |
| 官方工具桥接 | 应用管理工具并发起官方授权，隐藏手动选脚本步骤 | 需明确允许独立应用调用，并解决 Agent 识别及 Windows 支持；会增加运行时依赖，与之前不依赖 Skill 的偏好存在取舍 |
| WSL 桥接 | 要求用户安装并维护 WSL | 仅作为可选实验环境，不适合作为当前 Windows 产品默认方案 |
| Cookie / 非公开网页接口 | 可另做网页登录与会话维护 | 不作为本轮方案；改变既定接入边界，且不是已经验证可直接替换的官方授权路线 |

官方接入前需要明确：个人非商业桌面应用能否接入；客户端是否需要服务端密钥；支持哪些回调或授权完成机制；目录列表与续期接口；身份和配置隔离方式；运行时再分发条件。仓库 Apache-2.0 许可不能代替服务端接入资格，也不能自动覆盖分发包全部条款。

## 应用内实现

### 账号入口

设置页改为“夸克网盘”，显示 `未连接 / 授权中 / 已连接 / 授权过期 / 状态暂不可用`。未连接时提供“关联夸克账号”；连接后显示接口实际提供的昵称和账号标识，提供“选择影视文件夹”“重新授权”“管理授权”。账号探活失败时保留已有记录，不把网络错误当成用户已退出。

授权只能由用户点击发起；支持取消、超时和重新尝试。授权中使用真实中间状态，成功后查询用户信息并验证目录读取。浏览器完成操作不等于本地已保存凭据。失败时保留具体原因，不循环登录。若受支持协议需要手动授权码，只允许粘贴到应用内专用输入框，不发到聊天或写入日志。

“解除本机连接”和“撤销官方授权”需要区分。官方 `unauthorize` 返回操作指引/页面，不代表服务端已经解绑；不能点一下就显示“授权已撤销”。不要用会影响其他应用的共享配置或卸载命令处理普通断开。

### 代码落点

| 现有文件 | 所需改动 |
|---|---|
| `electron/main/services/quark/provider.ts` | 保留目录与完整结果校验；在受支持官方接口确定后提供替换实现 |
| 新增 `electron/main/services/quark/auth.ts` | 授权生命周期、账号探活、超时/取消、鉴权与网络错误分类 |
| `electron/main/services/quark/library.ts` | 将工具已选择与账号已连接区分；清单按稳定来源账号隔离，换账号不展示原账号目录 |
| `src/shared/quark.ts` | 增加连接状态与可公开账号资料，不暴露令牌 |
| `electron/main/ipc.ts`、`electron/preload/index.ts` | 增加连接、取消授权等待、刷新账号状态及授权管理入口；固定 IPC 白名单 |
| `src/renderer/components/QuarkFolderPanel.tsx` | 去掉正常流程中的脚本文件选择，呈现账号卡片与目录选择 |

直接 API 路线的凭据由主进程管理，在 Windows 使用 safeStorage/DPAPI，排除日志、数据库导出及备份。若走 CLI 桥接，其凭据由官方工具管理，不能假称它们自动获得了应用的 DPAPI 保护；先验证独立配置与凭据存储支持。

### 目录与影视关联

第一阶段只贯通真实授权与目录读取。随后新增来源账号、选定目录、远端文件与收藏作品之间的稳定关联，必要时单独做数据库迁移与备份恢复测试。

- 远端身份使用官方返回的账号与文件 ID，不用文件名作为主键。
- 按片名/年份/季集归并，再查询 TMDB；有歧义进入待确认队列，同一剧集的多集不能变成多部电影。
- 同步保持幂等，不覆盖评分、短评与专题；网络失败或文件缺失不自动删除个人收藏。
- 网盘文件不必有分享链接，不能为了兼容原有手动资源字段而编造分享地址。

## 开发顺序与验收

1. 确认官方独立应用接入与 Windows 支持，得到可用契约或明确限制；这是当前最先要解决的阻碍。
2. 在普通 Windows 上验证授权、用户信息、超过5条的完整目录读取、重启后再次读取；无需 WSL，也不冒用其他 Agent。
3. 将已验证流程接进主进程、IPC与设置页，覆盖取消、超时、过期、网络失败、账号切换与凭据保存失败。
4. 完成 TMDB 匹配、季集归并、增量关联，验证重复同步和用户记录保护。

本次交付是资料核验与实现设计，没有把账号连接或 Windows 官方工具兼容标记为完成，也没有修改应用业务代码。

## 细读官方 Skill 后的调用明细

再次读取 `SKILL.md`、`auth.md`、`file-ops.md`、`file-search.md` 及安装/卸载脚本，得到以下工程结论。这里是研究官方契约，没有安装或启用该 Skill，也不执行文档中的登录、卸载、分享等操作。

### Skill 与运行时分离

`SKILL.md` 是给 Agent 的操作指令；命令由下载包中的 `scripts/quark-drive.cjs` 执行。桌面接入不需要把大模型加入 My Cinema，也不能把 Markdown 当成可导入的 SDK。真正的桥接应位于 Electron 主进程，以固定参数启动受支持 CLI，渲染进程只调用白名单 IPC。

官方安装脚本会检测 Node、获取远端版本、下载并覆盖 scripts/文档，还可能清理旧全局命令。因此不能在用户每次打开设置时无提示执行整份安装脚本。若允许桌面集成，应明确安装与更新入口、版本及运行时来源；官方文档面向 Agent 的安装约定不等于桌面软件的自动更新契约。

### 最小命令集

以下为文档语法示意，不是本次已执行的命令。适用前提仍是运行环境与身份得到官方支持。

| 用户动作 | 官方命令 | 应用如何处理 |
|---|---|---|
| 关联账号 | `node scripts/quark-drive.cjs login` | 单独的长任务，显示授权中，等待浏览器操作；支持取消，不套用现有目录查询的固定60秒超时 |
| 确认账号 | `node scripts/quark-drive.cjs get-user-info` | 解析真实昵称与账号资料，不通过文件存在或工具路径来判断已连接 |
| 浏览根目录 | `node scripts/quark-drive.cjs browse --parent-fid 0 --all` | 过滤目录条目作为文件夹选择器，保留完整FID |
| 读取指定目录 | `node scripts/quark-drive.cjs browse --parent-fid <FID> --all` | 读取成功artifact的完整JSONL，再按用户选择递归调用；不能只使用最多5条预览 |
| 管理授权 | `node scripts/quark-drive.cjs unauthorize` | 展示官方返回的解绑指引，由用户在夸克App确认；之后重新检查状态 |

`get-user-info` 的会员和用户信息请求须同时成功，故其网络失败不能直接解释为凭据过期。`login` 返回 `-118` 可能表示现有授权有效，不能自动再登录或当成授权失效。`logout` 在官方文档中用于卸载清理，不可拿来替代普通账号管理按钮。

登录文档与1.0.25分发实现存在本地服务器/页面轮询的描述差异。桥接应让官方CLI管理完整授权过程，不能在My Cinema中先造一个未经验证的回调协议。若CLI不提供可用的授权开始事件或链接，应要求受支持的接口扩展，而不是抓取任意stdout并把其中内容直接展示。

### 现有工程还缺什么

已有 `quark:status` 返回的是本地工具路径、读取状态和缓存，不会检查账号是否已授权。已有 `chooseTool` 只是文件选择器；这就是用户看不到账号关联入口的原因。

需要新增连接状态与真实账号资料，以及 `connect / cancelConnect / refreshConnection / manageAuthorization` 等IPC。现有目录扫描只接受已建立的连接，换账号时必须隔离文件夹和清单。官方工具自身配置与My Cinema的 `quark-source.json` 是两套数据；前者的凭据不能通过复制配置或伪装Agent来复用。

正常使用流程应为：关联账号 → 浏览器授权 → 验证用户信息 → 选择目录 → 完整扫描 → 文件名归并 → TMDB匹配/确认 → 关联收藏。最后两步仍是My Cinema的业务，不会因安装Skill自动获得。

### 当前真正需要验证的适配点

Agent检查是分发CLI中的本地识别逻辑；静态发现这一点不等于已经证明服务端禁止所有独立桌面应用。也不能据此断言必须重新申请一整套OAuth客户端。应先确认官方是否支持自定义应用/Agent标识，或愿意提供面向桌面的兼容入口，再选择原样CLI、官方适配版本或独立SDK。

官方运行时包含Windows浏览器打开与设备标识处理分支，但README并未承诺原生Windows可用。需要在无Codex/DSH等Agent环境变量的普通Windows进程中验证，而不能用开发环境里偶然识别为现有Agent的成功结果代替。通过这些前置验证后，再实现账号入口，避免发布一个只会弹出“无法识别Agent”的按钮。
