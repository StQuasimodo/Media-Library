#!/usr/bin/env bash
set -euo pipefail
root=.harness/tv-fixture-private
python3 - "$root" <<'PYFIXTURE'
import pathlib, sys
root=pathlib.Path(sys.argv[1])
for filename,text in [('sample.srt','PRIMARY ENGLISH'),('secondary.srt','SECONDARY FRENCH')]:
    with (root/filename).open('w') as out:
        for index in range(36):
            def stamp(sec): return f'{sec//3600:02}:{sec//60%60:02}:{sec%60:02},000'
            out.write(f'{index+1}\n{stamp(index*5)} --> {stamp((index+1)*5)}\n{text}\n\n')
PYFIXTURE
ffmpeg -hide_banner -loglevel error -y -f lavfi -i 'testsrc2=size=1920x1080:rate=15' -f lavfi -i 'sine=frequency=440:sample_rate=48000' -f lavfi -i 'sine=frequency=880:sample_rate=48000' -i "$root/sample.srt" -i "$root/secondary.srt" -t 180 -map 0:v -map 1:a -map 2:a -map 3:s -map 4:s -c:v libx264 -profile:v baseline -pix_fmt yuv420p -preset ultrafast -crf 34 -c:a aac -b:a 64k -c:s mov_text -metadata:s:a:0 language=eng -metadata:s:a:1 language=zho -metadata:s:s:0 language=eng -metadata:s:s:1 language=fra -movflags +faststart "$root/sample.mp4"
