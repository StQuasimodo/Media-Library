#!/usr/bin/env bash
set -euo pipefail
out=.harness/mpv-candidate
# Repeated cues distinguish a missing subtitle feed from a single cue missed during a seek.
python3 - "$out" <<'PYFIXTURE'
import pathlib, sys
out = pathlib.Path(sys.argv[1])
for name, text in [('main.srt', 'PRIMARY ENGLISH'), ('secondary.srt', 'SECONDARY FRENCH')]:
    with (out / name).open('w') as f:
        for i in range(80):
            def ts(seconds):
                return f'{seconds // 3600:02}:{seconds // 60 % 60:02}:{seconds % 60:02},000'
            f.write(f'{i + 1}\n{ts(i)} --> {ts(i + 1)}\n{text}\n\n')
PYFIXTURE
ffmpeg -hide_banner -loglevel error -f lavfi -i 'color=c=black:s=1920x1080:r=15:d=90' -f lavfi -i 'sine=frequency=440:duration=90' -i "$out/main.srt" -i "$out/secondary.srt" -map 0:v -map 1:a -map 2 -map 3 -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -c:s srt -metadata:s:s:0 language=eng -metadata:s:s:1 language=fra -attach /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf -metadata:s:t mimetype=application/x-truetype-font -shortest -y "$out/sample.mkv"
sha256sum "$out/sample.mkv" > "$out/sample.sha256"
