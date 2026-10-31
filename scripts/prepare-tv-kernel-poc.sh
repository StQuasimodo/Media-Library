#!/usr/bin/env bash
# Generates the kernel-PoC sample and pushes it into the app's own external
# files directory (the manifest declares no storage permission, and API 22
# grants an app access to that path without one).
set -euo pipefail
case "$(adb get-serialno)" in emulator-*) ;; *) echo 'Disposable emulator required.' >&2; exit 1;; esac
test "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" = 22

out=.harness/tv-kernel-poc
mkdir -p "$out"

cat > "$out/zh.srt" <<'SRT'
1
00:00:00,000 --> 00:00:12,000
主字幕：这是简体中文字幕测试

2
00:00:12,000 --> 00:00:24,000
主字幕：第二段时间轴同步检查
SRT

cat > "$out/en.ass" <<'ASS'
[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Top,Arial,44,&H00FFE0A0,&H000000FF,&H00101010,&H80000000,0,0,0,0,100,100,0,0,1,2,0,8,40,40,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:12.00,Top,,0,0,0,,{\pos(640,90)}Secondary ASS line: style check
Dialogue: 0,0:00:12.00,0:00:24.00,Top,,0,0,0,,{\pos(640,90)}Secondary ASS line: second cue
ASS

# 1080p H.264 + AAC, 30 s, faststart: same class of stream the real pipeline carries.
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i 'testsrc2=size=1920x1080:rate=24' \
  -f lavfi -i 'sine=frequency=440:sample_rate=48000' \
  -t 30 -map 0:v -map 1:a \
  -c:v libx264 -profile:v baseline -level 4.0 -pix_fmt yuv420p -preset ultrafast -crf 30 \
  -c:a aac -b:a 96k -movflags +faststart "$out/sample.mp4"

adb shell mkdir -p /sdcard/Android/data/io.mycinema.tv/files/mc-poc
adb push "$out/sample.mp4" /sdcard/Android/data/io.mycinema.tv/files/mc-poc/sample.mp4
adb push "$out/zh.srt" /sdcard/Android/data/io.mycinema.tv/files/mc-poc/zh.srt
adb push "$out/en.ass" /sdcard/Android/data/io.mycinema.tv/files/mc-poc/en.ass
adb shell ls -l /sdcard/Android/data/io.mycinema.tv/files/mc-poc | tee "$out/pushed.txt"
ffprobe -hide_banner -loglevel error -show_entries stream=codec_name,width,height -of default=noprint_wrappers=1 "$out/sample.mp4" | tee "$out/ffprobe.txt"
