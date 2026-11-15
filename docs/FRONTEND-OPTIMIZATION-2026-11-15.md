# 双端前端优化与验收记录

本报告记录合并前的前端验收；随后发布的beta.6与TV alpha.11安装包身份、签名、覆盖升级和下载校验见[双端交付记录](RELEASE-2026-11-15.md)。

本轮按2026-11-14的14项前端审计实施，延续 `docs/DESIGN.md`，采用已加载的 Impeccable harden/layout/craft-floor 指导。保持花体品牌、现代无衬线片名、克制深色与冰蓝焦点；保留原有路由、SQLite、TMDB、夸克和播放控制接口，无数据库迁移、框架替换或新安装包发布。

## 实际改动

| 审计项 | 实施情况 | 主要文件 |
|---|---|---|
| F01 输入与弹窗焦点 | 打开生命周期不依赖内联回调；读取最新关闭回调；过滤隐藏／禁用控件，最上层弹窗处理Tab/Escape，关闭还原触发器 | `components/primitives.tsx` |
| F02 无名称链接 | 想看和专题选择器补作品名称，避免重复无意义Tab停点；网格保留正常链接语义 | `pages/WatchlistPage.tsx`、`pages/CollectionDetailPage.tsx` |
| F03 图片上文字 | 提升轨道标题／计数、返回与收藏数量文字；增加局部对比保障，保留大幅画面 | `styles/home.css`、`styles/gallery.css` |
| F04 海报墙 | 紧凑页题与常用工具行；筛选按需展开，低频整理收入菜单，功能保留 | `pages/LibraryPage.tsx`、`styles/gallery.css` |
| F05 浏览连续性 | 会话内按历史条目保留筛选／排序／视图／滚动／焦点，最多40项；详情按来源返回；想看移除行后选择邻近操作 | `components/AppShell.tsx`、`components/BrowseLink.tsx`、`lib/browseMemory.ts`、`lib/useBrowseState.ts` |
| F06 设置锚点 | 区块预留112px滚动边距，避开88px固定导航 | `styles/gallery.css` |
| F07 减少动效 | 保留前一轮脚本轨道滚动修复；网格方向键也遵守系统及应用设置 | `components/Track.tsx`、`lib/posterNavigation.ts` |
| F08 混排基线 | 文件夹与单片共用2:3槽位、两行标题区及元信息；不添加名称括号。网格方向键/Home/End，快速反向取消旧滚动 | `pages/LibraryPage.tsx`、`styles/gallery.css`、`lib/posterNavigation.ts` |
| F09 字级 | 去重复英文装饰eyebrow；body15px、常用meta12.5px；评分常显，电影类型去重复徽标，保留剧集区分；保持28px花体品牌 | `components/PageHeading.tsx`、`components/primitives.tsx`、`styles/` |
| F10 字段错误 | Field产生稳定ID，关联hint/error、aria-invalid及alert；专题空名／重复名定位到名称，保留描述 | `components/primitives.tsx`、`pages/CollectionsPage.tsx` |
| F11 专题遮罩 | 独立局部层叠上下文与专题遮罩，隔离电影详情fixed样式；电影滚动模糊保留 | `pages/CollectionDetailPage.tsx`、`styles/gallery.css` |
| F12 TV 页面目的 | 默认舒适海报密度，可遥控切紧凑；片名16sp、按钮16sp、辅助信息至少14sp；首页上轨道／下作品；专题封面拼贴；想看为编号队列并支持快捷状态 | `android-tv/.../MainActivity.java` |
| F13 TV 播放面板 | **部分完成**：dp间距、实际时间／时长、可聚焦时间轴、左右定位／确认暂停恢复和可见焦点；音轨／字幕菜单复用既有内核能力 | `android-tv/.../PlayerActivity.java` |
| F14 合成预算 | 保留上一轮移除全墙常驻will-change、限定详情参数节点及背景合成提示。目标GPU、500作品新版本压力、低端实机仍待专项验收 | `styles/components.css`、`styles/gallery.css` |

系列归类算法、图库挑选规则、解码器／双字幕内核、本轮没有修改。F08的“墙内明确组起点”尚未新增：文件夹视图负责整理，原同系列聚合仍保留。F13不代表达到PotPlayer全部功能。

## 可重复验证

- `npm run build`：TypeScript及生产构建通过。
- `npm test`：21个文件、250项通过，其中7项新增弹窗／字段语义和浏览记忆回归。
- 独立临时SQLite + 实际Chromium/CDP：46项检查通过：浏览历史、持续中文输入、错误关联、上下文返回、快速方向键、想看焦点、设置锚点和七页面四组窗口尺寸；另有13项方向键压力检查通过，覆盖0/5/35/100ms快速反向和减少动效。原始结果和前后截图保存在共享目录 `mycinema-frontend-optimization-2026-11-15/`。
- 1440×900默认墙：首排 y≈278.5px，对照审计基线481.7px，提前约203px；同为六列，没有用缩小海报达到目标。筛选展开时自然下移。
- 原有31项浏览器动效回归通过，包括快速导航中断、稳定命中区域、详情滚动、减少动效与三组窗口。
- Android应用、instrumentation APK、lintDebug实际构建通过。新增测试使用独立图片资产和SQLite，执行后恢复数据及偏好；素材仅进入测试APK。

Windows与API22的最终结果见下方追加记录。测试使用受控网盘协议和媒体源，不代表真实夸克账号、TMDB/Fanart图库或长虹电视实机验收。

## 验收边界

Windows Electron与Linux Chromium分别记录，API22/x86模拟器与ARMv7长虹实机分别记录。没有用户设备连接，仍不能保证真电视观看距离、overscan、系统字体缩放、4K原盘、HDR、硬解或GPU帧率。本轮不把单轨字幕选择写成主副字幕，也不把文件名编码写成实际解码路径。

原始 `/workspace/Media-Library` 三个未提交文件保留。本轮在独立持久工作树中实施并推送到 `fix/smooth-motion`，继续使用草稿PR #3评审。


## 原生验证记录

API22首轮 `43669479072` 已实际通过181项功能（含新增8项前端、31项动效）、25项备份和原生播放／夸克DAV链路。播放报告确认时间轴遥控定位、暂停、恢复，并在定位后继续显示新帧。整套运行最终因收藏回归仍寻找原工具栏“添加作品”失败；已将操作改为真实遥控器路径“更多操作 → 添加作品”，不删除原断言。后续 [43670279253](https://github.com/StQuasimodo/Media-Library/actions/runs/43670279253) **完整成功**，源提交 `cbbf543`，最终分支Android源码与之无差异。181项功能、25项备份、播放／DAV、12项完整收藏回归、进程重启和设备重启均通过；500额外作品滚动也包含在收藏回归中。API22/x86模拟器结果不外推到ARMv7真实电视。

Windows最终运行 [43670609009](https://github.com/StQuasimodo/Media-Library/actions/runs/43670609009) **整套成功**，源提交 `a484732`。两组实际Electron窗口smoke分别包含39／70条记录（包括截图），覆盖原生深色下拉、连续输入、弹窗焦点、浏览与同步、分季图库、系列归类、字段编辑、刷新及更新设置；无沙箱禁用。真实Windows DPAPI三阶段旧凭据实现写入／新版异路径读取／新版重启均通过，未使用真实Key。此前失败来自旧入口与直接修改hash复用历史key；测试现优先实际导航，并保留所有原数据断言。

浏览器与TV截图均为独立样本收藏。TV的4张真实海报用于画面验收，样本手动共用一张背景；不用于判断用户作品的背景季份准确性。所有采样在同一Chromium前台顺序执行，避免多个标签页竞争焦点造成假失败。


## 最终渲染检查与剩余工作

同一前台Chromium顺序通过46项七页面／四尺寸交互检查、13项快速反向滚动、31项原动效、4项加载／错误／重试／空库，共94项。专题轨道给焦点环保留6px内边距，实际首链接与轨道边界间距6px。Impeccable最终七页面扫描六页无信号；首页留下1条嵌套封面“贴边”信号，结合上述实际测量和截图复核，没有据此继续改变已对齐的封面布局。扫描数量不是合规认证。

仍待目标设备确认：Windows系统缩放／真实GPU、长虹远距离文字、overscan、多DPI／字体缩放和4K/HDR；F13主副字幕、解码路径及高级播放功能仍归播放器专项。F08墙内组起点提示尚未增加。保持这些边界，不标为全部完成。
