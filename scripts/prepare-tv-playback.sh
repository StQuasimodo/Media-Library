#!/usr/bin/env bash
set -euo pipefail
root=.harness/tv-fixture-private
cat > "$root/sample.srt" <<'SUBTITLE'
1
00:00:00,000 --> 00:00:40,000
My Cinema controlled playback test
SUBTITLE
ffmpeg -hide_banner -loglevel error -y -f lavfi -i 'testsrc2=size=1920x1080:rate=15' -f lavfi -i 'sine=frequency=440:sample_rate=48000' -f lavfi -i 'sine=frequency=880:sample_rate=48000' -i "$root/sample.srt" -t 180 -map 0:v -map 1:a -map 2:a -map 3:s -c:v libx264 -profile:v baseline -pix_fmt yuv420p -preset ultrafast -crf 34 -c:a aac -b:a 64k -c:s mov_text -metadata:s:a:0 language=eng -metadata:s:a:1 language=zho -metadata:s:s:0 language=eng -movflags +faststart "$root/sample.mp4"

# Separate synthetic static fMP4 HLS VOD; no account or real movie is involved.
mkdir -p "$root/cloud"
ffmpeg -hide_banner -loglevel error -y -i "$root/sample.mp4" -map 0:v:0 -map 0:a:0 -c copy -f hls -hls_playlist_type vod -hls_time 6 -hls_segment_type fmp4 -hls_fmp4_init_filename init.mp4 -hls_segment_filename "$root/cloud/segment-%03d.m4s" "$root/cloud/media.m3u8"
