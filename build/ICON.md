# My Cinema 应用图标

2026-10-26 按用户指定图案更换：胶片、山景与星空。

- 原图：[用户提供的 ChatGPT 分享](https://chatgpt.com/s/m_6ade298c95dc8191817f4d0790231ea3)。`icon-source.png` 为取到的1254×1254 PNG原图，保留完整画面，不裁剪、不重绘。
- `python scripts/make-icon.py` 使用 Pillow 生成1024px `icon.png`、16/24/32/48/64/128/256px图像与多尺寸 `icon.ico`。
- Windows程序/快捷方式与NSIS安装器使用 `icon.ico`；Electron窗口图标一并打包进应用。发布校验核对打包后的图标与构建输入一致。
