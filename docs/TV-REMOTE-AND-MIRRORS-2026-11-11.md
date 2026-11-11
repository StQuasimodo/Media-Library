# 电视遥控与内置更新镜像（2026-11-11）

## 遥控器操作

| 场景 | 操作 |
|---|---|
| 浏览收藏 | 方向键移动、确认打开；返回恢复之前的海报/文件夹位置 |
| 搜索、整理与媒体源 | 菜单键打开快捷操作；屏幕上的按钮仍可操作，不依赖实体遥控器一定提供菜单键 |
| 评分/观看状态 | 详情直接选择；评分以0.5分步进，取消不修改，可清除评分。原编辑表单仍支持9.2等自定义评分和长文本 |
| 搜索 | 可选择已有收藏片名或最近12次搜索；可清空本机历史。系统具备语音服务时显示语音搜索；没有服务则保留键盘 |
| 整理影视宇宙 | 默认一项选中同一系列的所有季，可切换逐部选择；直接采用建议名称或已有文件夹，只有自定义名称需要输入 |
| 输入框 | 方向键聚焦不自动弹键盘，按确认后输入；API Key、长篇短评、未收录片名等仍需输入 |
| 播放面板 | 播放时5秒无操作自动隐藏，暂停/错误时保留；上下唤出，左右在隐藏时定位，长按节流并加大步长 |
| 播放确认/媒体键 | 隐藏时确认暂停并显示面板，再次确认继续；播放/暂停专用键表达明确状态，连续按不应反转 |
| 返回/退出 | 播放中先隐藏面板，再返回出现退出确认，默认继续播放；主界面退出确认默认取消 |

常用操作按钮加强焦点轮廓，聚焦时滚入可见区域。没有更换播放器内核、数据库、媒体源身份或凭据格式。

语音通过系统RecognizerIntent启动，没有内置录音/识别服务；老电视是否有服务、遥控器麦克风和实际识别效果仍须实机验收。API22自动化允许焦点API定位待测控件，之后发送实际方向、确认、返回和菜单事件；实体遥控器与系统语音另行验收。

## 内置更新镜像

| 名称 | 地址 | 说明来源 |
|---|---|---|
| GH-Proxy | https://gh-proxy.com/ | 站点主页提供GitHub Release/raw代理说明，引用WJQSERVER-STUDIO/ghproxy项目 |
| GHFast | https://ghfast.top/ | 站点主页明确支持Release、archive与raw.githubusercontent.com，运营方页面标记为stilleshan |
| ghproxy.net | https://ghproxy.net/ | 站点主页展示代理用法，并链接hunshcn/gh-proxy实现 |

这是国内用户常用的GitHub公开代理类型，不是GitHub官方服务，不以这些项目星标数证明站点访问量或国内各运营商速度。查阅时[hunshcn/gh-proxy](https://github.com/hunshcn/gh-proxy)约9073星，[WJQSERVER-STUDIO/ghproxy](https://github.com/WJQSERVER-STUDIO/ghproxy)约737星，均不能当作第三方站点的安全背书。

两端使用同一份[预设列表](../src/shared/data/update-mirrors.json)，提供自动、指定站点、仅GitHub与自定义HTTPS。新配置默认自动；保留已有自定义或明确的仅GitHub设置。自动模式先访问GitHub，失败再按表顺序尝试，单请求有界超时。内置镜像只用于公开更新清单/安装包，不代理TMDB、夸克账号或视频。

本轮在云网络中逐站请求项目TV签名清单，三个均200并通过生产验签器；请求已发布APK前1024字节，三个均206且与原始APK一致。[原始探测结果](../artifacts/research-2026-11-11/update-mirror-probes.json)。只验证短请求，不冒充中国家庭网络测速或整包下载验收。安装时始终验证完整文件大小/哈希；电视额外验证包名、版本、现有签名。镜像损坏或伪造清单不能绕过校验。

## Windows1.3.0-beta.2验证

[Windows完整发布42960339011](https://github.com/StQuasimodo/Media-Library/actions/runs/42960339011)通过，源码`4060956694f0aff17b414b7066d1e172301d80bd`。18文件/203项测试、类型检查、生产构建、真实Windows Electron（非无头、sandbox启用）、下拉选择GHFast/保存/恢复自动模式、原图库/收藏/匹配流程、旧加密凭据兼容及实际安装器快捷方式检查通过。

[发布安装器](https://github.com/StQuasimodo/Media-Library/releases/tag/v1.3.0-beta.2)122950354字节，SHA256`8815e142e3d9358482ab7c12abc9f5f11d0106283b9018b98bb7c366f8dbb973`；[身份记录](../artifacts/releases/v1.3.0-beta.2/BUILD.json) · [窗口报告](../artifacts/releases/v1.3.0-beta.2/mirror-ui-report.json)。截图中的版本45来自隔离测试驱动运行的Electron版本，实际安装产物为1.3.0-beta.2，包内版本与打包应用加密凭据验证另外检查。

## 老Android的HTTPS兼容

第一次API22公开访问中，GHFast通过，另外两站出现SSLHandshakeException。补齐更新客户端的ISRG Root X1/X2、GTS Root R4后，构建`45d9626919d25a62a6e8a7ef8e9bc1b6c6e16ec4`的实际API22请求中，三个镜像均完成HTTPS与签名清单验证；同轮24项遥控/选择/证书检查和完整播放回归通过，旧收藏脚本的焦点路径仍需调整，因此该次完整流程没有标记为成功或发布。

这三个是CA发布者的公开根证书，原始来源和固定SHA256见[随包说明](../android-tv/app/src/main/assets/update-roots/NOTICE.txt)。兼容信任只用于API21–23的更新HTTP客户端：先验证系统链，再验证额外公开根链，主机名仍用OkHttp默认验证。不修改系统信任库，不用于TMDB、夸克或播放器，不把应用更新签名证书作为TLS根。API22测试确认其他自签名证书仍被拒绝。清单RSA签名和安装包完整哈希额外保持强制。

## 最终TV0.3.0-alpha.2验证

[完整API22构建42965415679](https://github.com/StQuasimodo/Media-Library/actions/runs/42965415679)通过，应用与测试驱动源码均为`e729178bb4edee5a02f57dc56fafc5236298c234`。Gradle/Lint、API21/v1签名/ARMv7+x86包检查、真实API22 x86的52次遥控按键/26项检查通过，包括单个筛选结果一次确认打开、8.5评分、观看状态、焦点恢复、整系列批量选择及建议命名、镜像选择保存。快捷流程没有输入文字；系统语音与实体遥控器未验收。

三个预设均以实际更新HTTP客户端从API22完成公网HTTPS请求和清单验签；其他自签名证书被拒绝。播放面板自动隐藏、隐藏确认键只切换一次、左右定位和独立播放/暂停键通过。原LibVLC真实解码、90秒连续播放、Range/临时地址/断流/重连/取消回归通过；备份、504条收藏/500张海报路径滚动、进程与模拟器重启保留数据通过。已发布alpha.5原包覆盖安装至code10的加密凭据/目录/关联/进度检查通过。

APK48790053字节，SHA256`94b7c1ecbfa3f710b3eee42699eb45ee7b4ed0c5b1e632010e651c23aaa87c1f`；证书仍为be6ca662…，保留原应用ID、数据库和凭据结构。[身份记录](../artifacts/releases/tv-v0.3.0-alpha.2/BUILD.json) · [按键/公网镜像结果](../artifacts/releases/tv-v0.3.0-alpha.2/remote-report.json) · [播放结果](../artifacts/releases/tv-v0.3.0-alpha.2/playback-report.json) · [收藏/重启汇总](../artifacts/releases/tv-v0.3.0-alpha.2/regression-summary.json)。本轮没有Windows解码改造、mpv迁移或4K实机验收。

开发中保留了失败结果：首轮多选测试的辅助焦点没有改变原生列表选中行；后续旧收藏脚本仍按原入口直接找输入框，或把已聚焦时的ACTION_FOCUS=false当成失败。改为检查实际选中行并发送方向/确认事件，按新入口进入详情与资源区。另一次固定两秒的定位断言在模拟器负载下提前失败，改为有界等待实际播放时钟及显示帧。最终完整流程重新执行通过，没有将这些中间失败构建发布。
