# 电视媒体源与内置播放

2026-10-28用户授权开始实现。当前开发版本`0.2.0-alpha.4` / code7（alpha.1是此前客户端原型），Windows仍为1.2.0，电视收藏库schema仍为1。这里记录开发代码，尚未创建新Release；开发APK及完整验证见[本轮架构优化验证](TV-PLAYBACK-ARCHITECTURE-VALIDATION-2026-10-29.md)，模拟器通过不等同真实账号可用。

## 夸克转WebDAV（alpha.2）

用户澄清需要电视本机把夸克转换为WebDAV，而不是自行准备外部服务。新增本机只读WebDAV：连接夸克 → 选择指定文件夹 →「将此文件夹转换为WebDAV影视源」→ 浏览/扫描/播放。目录查询走本机PROPFIND，视频GET/HEAD由同一服务读取夸克；播放器自动使用生成的地址，无需NAS、电脑或OpenList服务器。

只导出选中目录及其子目录，支持OPTIONS、PROPFIND Depth0/1、GET、HEAD、Range206；写入/删除等操作拒绝。仅监听127.0.0.1，临时本机账号密码不等于夸克Cookie；在媒体源页可查看连接。应用退到后台后停止服务，回到应用按需重启，文件夹选择保留；不作为局域网或后台常驻服务。稳定文件ID和相对路径保存于媒体目录，临时端口、密码和CDN URL不写入收藏。

本机转换、界面选择与转换后播放已通过[API22完整验证](TV-QUARK-WEBDAV-VALIDATION-2026-10-28.md)；真实夸克账号及旧WebView扫码仍未验证。alpha.1的[旧验证报告](TV-PLAYBACK-VALIDATION-2026-10-28.md)不能代替转换服务验收。

## 使用路径

影视库「媒体源」或设置「媒体源 · 夸克 / WebDAV」：

- **夸克**：打开官方网页登录，手机扫码后选「检查并保存登录」。实际读取根目录成功才加密保存会话；旧系统WebView无法加载时显示失败，不绕过证书。目录与取流使用网页接口，非官方Android播放SDK，真实账号、服务限制及旧WebView扫码仍需验收。
- **WebDAV**：填写已有服务的目录地址、用户名和密码；验证PROPFIND后加密保存。允许匿名账户。HTTPS使用系统证书，不绕过TLS。HTTP需在界面确认明文连接风险，仅适合可信局域网。夸克网址本身不是WebDAV地址；电视直连夸克使用上文的内置网关，无需外部网关。
- 浏览文件夹，记住目录后下次从这里开始；选择「扫描此文件夹并匹配收藏」递归读取，最多200目录、16层、5000视频。未完整读取不写入该次批量扫描；浏览时已读取的记录保留。扫描不会删除旧记录，不自动新增TMDB作品，不修改网盘文件。
- 根据片名/原名与季号唯一匹配已有收藏；年份冲突、缺少季号或多候选保留未关联。支持手动关联/改关联，文件也可直接播放。识别SxxExx、中文季集及画质、编码、音轨、HDR、片源标记；识别结果是文件名声明，不是实际媒体探测。
- 关联文件出现在作品详情「播放资源」，按集号排列。内置LibVLC播放，音轨/内嵌字幕选择，前后10秒、遥控器播放暂停，本机续播。返回先隐藏控制面板，再返回可确认退出。尚未加入外挂字幕选择、自动连播、全片下载或磁盘缓存。

媒体源加密文件、文件ID关联及续播单独存放，TMDB凭据路径与密钥别名保持原样。收藏JSON备份当前不包含新的媒体源关联/进度，更不包含账号凭据；卸载仍会删除本机数据。断开媒体源会清除该源凭据、关联和进度，收藏保留。

## 实现

- `MediaSources`：夸克分页与取流；WebDAV Depth1/XML，拒绝跨域/越界href，限制响应与目录大小，不回显凭据或服务端原始响应。
- `MediaBrowserActivity`：原生遥控器目录浏览，ListView复用行，后台扫描与事务关联。
- `MediaCatalog`：新增独立SQLite文件，稳定文件身份与续播；原收藏库无需迁移。
- `PlaybackRelay`：127.0.0.1只读HTTP/DAV协议、挂载范围和临时鉴权，最多3路工作线程及有限队列。内置播放器另有仅供本文件GET/HEAD的鉴权，退出/重连撤销并取消相应请求；临时URL/密码/CDN地址不进收藏或Intent。
- `MediaTransfer`：通过Provider获取短期地址，每文件锁合并过期地址刷新；夸克顺序4MiB闭合Range、64KiB流式转发，保留正确全长，HEAD经1字节GET探测、尾部Range和首段/后续段核对。单个响应最多续接两次，每次取流请求401/403最多更新一次地址；跨源不带鉴权、HTTPS不降级。无全片内存或磁盘缓存。
- `NetworkScope`：连接尝试和每个HTTP请求的真实Call/响应体取消，覆盖目录、取流API及视频读取；不只取消Future。
- `PlaybackController`：LibVLC3.7.7、状态快照、恢复位置、暂停意图、静音准备及按会话处理回调。只有最新连接解析完成才创建解码器；缓冲完成回到播放，结束归零、退出释放。夸克直接连接本机DAV，外部WebDAV保持原转发方式，网络缓存1500ms。
- `PlayerActivity`：原生界面、遥控器/轨道菜单及进度存储回调；[架构图与参考来源](TV-PLAYBACK-ARCHITECTURE.md)。

API21仍为安装下限，ARMv7用于目标电视、x86用于模拟器；该预览不包含arm64/x86_64。媒体源可显式配置HTTP，因此manifest允许明文流量，其他内置TMDB/夸克端点固定HTTPS。旧电视的TLS/账号扫码和实际硬件解码不能由minSdk声明证明。

## 验证

新增独立测试APK场景：受控HTTPS WebDAV/夸克协议、账号错误/越界拒绝、凭据隔离、403地址更新、精确Range字节、真实LibVLC 1080p H.264/AAC解码、双音轨/内嵌字幕、定位、遥控器暂停与续播。样片由FFmpeg生成，测试数据不打入正式应用；CA/hosts只在明确选中的一次性API22模拟器内安装，不改用户电视或应用TLS策略。

Java源码及测试源码编译检查通过。Gradle/Lint、APK签名/ABI和API22模拟器完整回归已在开发提交通过；当前alpha.4最终源码与报告见[本轮验证](TV-PLAYBACK-ARCHITECTURE-VALIDATION-2026-10-29.md)；alpha.3[播放稳定性验证](TV-PLAYBACK-STABILITY-2026-10-28.md)及alpha.1[原验证](TV-PLAYBACK-VALIDATION-2026-10-28.md)保持历史结果。真实夸克账号、官方扫码、长虹ARM解码/声音/遥控器、4K/HEVC/HDR/直通未验收。不承诺旧电视实时转码或所有格式流畅。

## 第三方与重新链接

LibVLC `org.videolan.android:libvlc-all:3.7.7`：未修改的Maven AAR，LGPL-2.1；[发布源](https://repo.maven.apache.org/maven2/org/videolan/android/libvlc-all/3.7.7/)、[JNI源码与构建](https://code.videolan.org/videolan/libvlcjni)、[VLC内核源码](https://code.videolan.org/videolan/vlc)。分发前仍须完整核对该AAR对应的JNI/内核及贡献模块源码和许可，不把调研中其他应用的GPL/AGPL代码复制进本项目。

OkHttp3.12.13/Okio1.15.0及传递AndroidX/Kotlin依赖按其Apache-2.0许可。许可文本与说明打入`assets/licenses`，媒体源页提供入口。项目不限制用户为调试库修改进行逆向分析；应用代码可从仓库获取，用JDK17/SDK36按[构建说明](ANDROID-TV.md)重新构建。替换LibVLC时修改Gradle依赖为兼容替代AAR或本机构建版本，再重建APK、以自己的签名安装；不要覆盖原签名并冒充原作者版本，先保留本机数据。当前仍为开发验证，不自动发布为正式稳定电视版。
