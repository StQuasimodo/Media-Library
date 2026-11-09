#!/usr/bin/env bash
set -euo pipefail
out=.harness/mpv-4k
collect(){ adb logcat -d > "$out/logcat-$depth.txt" 2>&1 || true; adb pull /data/local/tmp/mpv-4k/result.txt "$out/result-$depth.txt" >/dev/null 2>&1 || true; adb pull /data/local/tmp/mpv-4k/frame.png "$out/frame-$depth.png" >/dev/null 2>&1 || true; }
depth=setup
trap collect EXIT
test "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" = 22
install=$(adb install -r "$out/mpv.apk" 2>&1) || { echo "$install"; exit 1; }
echo "$install"
grep -qx Success <<< "$(tr -d '\r' <<< "$install" | tail -1)"
adb root; adb wait-for-device
adb shell mkdir -p /data/data/is.xyz.mpv/files/scripts /data/local/tmp/mpv-4k
adb shell chmod 777 /data/local/tmp/mpv-4k
adb push scripts/mpv-4k/probe.lua /data/data/is.xyz.mpv/files/scripts/probe.lua
adb shell chmod 755 /data/data/is.xyz.mpv/files/scripts
adb shell chmod 644 /data/data/is.xyz.mpv/files/scripts/probe.lua
printf 'hwdec=mediacodec\nhwdec-codecs=all\nhwdec-software-fallback=1\n' > "$out/mpv.conf"
adb push "$out/mpv.conf" /data/data/is.xyz.mpv/files/mpv.conf
adb shell chmod 644 /data/data/is.xyz.mpv/files/mpv.conf
adb shell settings put secure immersive_mode_confirmations confirmed
for depth in 8 10; do
  adb shell am force-stop is.xyz.mpv
  adb logcat -c
  adb shell rm -f /data/local/tmp/mpv-4k/result.txt /data/local/tmp/mpv-4k/frame.png
  adb push "$out/hevc-$depth.mkv" "/data/local/tmp/mpv-4k/hevc-$depth.mkv"
  launch=$(adb shell am start -W -a android.intent.action.VIEW -d "file:///data/local/tmp/mpv-4k/hevc-$depth.mkv" -t video/x-matroska -n is.xyz.mpv/.MPVActivity 2>&1 | tr -d '\r')
  echo "$launch"; grep -q '^Status: ok' <<< "$launch"
  for i in $(seq 1 90); do adb shell cat /data/local/tmp/mpv-4k/result.txt 2>/dev/null | tr -d '\r' > "$out/live-$depth.txt" || true; grep -qx DONE "$out/live-$depth.txt" && break; sleep 1; done
  collect
  cat "$out/live-$depth.txt"
  grep -qx DONE "$out/live-$depth.txt"
  ! grep -q '^FAIL ' "$out/live-$depth.txt"
  test -s "$out/frame-$depth.png"
  if [ "$depth" = 10 ]; then format=yuv420p10; else format=yuv420p; fi
  grep -q "pixelformat=$format " "$out/live-$depth.txt"
  # This guest cannot create MediaCodec; require evidence of attempted initialization
  # and a software decoder, not merely a configured fallback option.
  grep -q 'Looking at hwdec hevc_mediacodec' "$out/logcat-$depth.txt"
  grep -q 'Could not create device' "$out/logcat-$depth.txt"
  grep -q 'Using software decoding' "$out/logcat-$depth.txt"
done
