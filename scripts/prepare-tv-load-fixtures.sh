#!/usr/bin/env bash
set -euo pipefail
root=.harness/tv-fixture-private
out=.harness/tv-playback
mkdir -p "$root" "$out"

# Higher bitrate than the original 15 fps smoke fixture. The moving pattern is synthetic.
ffmpeg -hide_banner -loglevel error -y -filter_threads 2 \
  -f lavfi -i 'testsrc2=size=1920x1080:rate=30' -f lavfi -i 'sine=frequency=440:sample_rate=48000' \
  -t 28 -c:v libx264 -threads 3 -preset ultrafast -pix_fmt yuv420p \
  -b:v 24M -minrate 24M -maxrate 24M -bufsize 24M -x264-params nal-hrd=cbr \
  -c:a aac -b:a 128k -movflags +faststart "$root/load-1080.mp4"

ffmpeg -hide_banner -loglevel error -y -filter_threads 2 \
  -f lavfi -i 'testsrc2=size=3840x2160:rate=24' -f lavfi -i 'sine=frequency=440:sample_rate=48000' \
  -t 18 -c:v libx265 -preset ultrafast -pix_fmt yuv420p10le \
  -b:v 45M -minrate 45M -maxrate 45M -bufsize 45M \
  -x265-params 'pools=2:frame-threads=2:hrd=1:strict-cbr=1:filler=1:log-level=error' \
  -c:a aac -b:a 128k -movflags +faststart -tag:v hvc1 "$root/load-4k.mp4"

# Hold bitrate and scene constant while changing resolution on the shared 12 Mb/s link.
for fixture in load-720 load-1080-moderate; do
  size=1920x1080
  if [ "$fixture" = load-720 ]; then size=1280x720; fi
  ffmpeg -hide_banner -loglevel error -y -filter_threads 2 \
    -f lavfi -i "testsrc2=size=$size:rate=30" -f lavfi -i 'sine=frequency=440:sample_rate=48000' \
    -t 28 -c:v libx264 -threads 3 -preset ultrafast -pix_fmt yuv420p \
    -b:v 8M -minrate 8M -maxrate 8M -bufsize 8M -x264-params nal-hrd=cbr \
    -c:a aac -b:a 128k -movflags +faststart "$root/$fixture.mp4"
done

for fixture in load-720 load-1080-moderate load-1080 load-4k; do
  ffprobe -v error -show_entries format=duration,bit_rate,size:stream=codec_name,profile,width,height,pix_fmt,avg_frame_rate \
    -of json "$root/$fixture.mp4" > "$out/$fixture-fixture.json"
done
python3 - <<'PY'
import json
from pathlib import Path

for file, width, codec, fps, min_bitrate in [
    ('load-720', 1280, 'h264', '30/1', 7_000_000),
    ('load-1080-moderate', 1920, 'h264', '30/1', 7_000_000),
    ('load-1080', 1920, 'h264', '30/1', 20_000_000),
    ('load-4k', 3840, 'hevc', '24/1', 35_000_000),
]:
    sample = json.loads(Path(f'.harness/tv-playback/{file}-fixture.json').read_text())
    video = sample['streams'][0]
    assert video['width'] == width and video['codec_name'] == codec and video['avg_frame_rate'] == fps, sample
    if codec == 'hevc':
        assert video['pix_fmt'] == 'yuv420p10le' and video['profile'] == 'Main 10', sample
    bitrate = int(sample['format']['bit_rate'])
    assert bitrate >= min_bitrate, sample
    if file in ('load-720', 'load-1080-moderate'):
        assert bitrate < 9_000_000, sample
PY
