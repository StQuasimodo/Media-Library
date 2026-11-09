#!/usr/bin/env bash
set -euo pipefail
out=.harness/mpv-candidate
cat > "$out/main.srt" <<'SRT'
1
00:00:00,000 --> 00:01:20,000
PRIMARY ENGLISH
SRT
cat > "$out/secondary.srt" <<'SRT'
1
00:00:00,000 --> 00:01:20,000
SECONDARY FRENCH
SRT
ffmpeg -hide_banner -loglevel error -f lavfi -i 'color=c=black:s=1920x1080:r=15:d=90' -f lavfi -i 'sine=frequency=440:duration=90' -i "$out/main.srt" -i "$out/secondary.srt" -map 0:v -map 1:a -map 2 -map 3 -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -c:s srt -metadata:s:s:0 language=eng -metadata:s:s:1 language=fra -shortest -y "$out/sample.mkv"
sha256sum "$out/sample.mkv" > "$out/sample.sha256"
