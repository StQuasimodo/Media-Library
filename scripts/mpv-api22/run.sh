#!/usr/bin/env bash
set -euo pipefail
out=.harness/mpv-candidate
apk="$out/app-default-x86-release.apk"
collect() {
  adb logcat -d > "$out/logcat.txt" 2>&1 || true
  adb shell dumpsys meminfo is.xyz.mpv > "$out/meminfo.txt" 2>&1 || true
  adb pull /sdcard/Download/mpv-probe.txt "$out/probe.txt" >/dev/null 2>&1 || true
  adb exec-out screencap -p > "$out/screen.png" 2>/dev/null || true
}
trap collect EXIT
test "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" = 22
install=$(adb install -r "$apk" 2>&1) || { echo "$install"; exit 1; }
echo "$install"
grep -qx 'Success' <<< "$(tr -d '\r' <<< "$install" | tail -1)"
adb root
adb wait-for-device
adb shell mkdir -p /data/data/is.xyz.mpv/files/scripts /sdcard/Download
adb push scripts/mpv-api22/probe.lua /data/data/is.xyz.mpv/files/scripts/probe.lua
adb shell 'uid=$(stat -c %u /data/data/is.xyz.mpv); gid=$(stat -c %g /data/data/is.xyz.mpv); chown -R "$uid:$gid" /data/data/is.xyz.mpv/files'
adb push "$out/sample.mkv" /sdcard/Download/mycinema-sample.mkv
adb shell rm -f /sdcard/Download/mpv-probe.txt
start=$(adb shell am start -W -a android.intent.action.VIEW -d file:///sdcard/Download/mycinema-sample.mkv -t video/x-matroska -n is.xyz.mpv/.MPVActivity 2>&1 | tr -d '\r')
echo "$start"
grep -q '^Status: ok' <<< "$start"
for i in $(seq 1 60); do
  adb shell cat /sdcard/Download/mpv-probe.txt 2>/dev/null | tr -d '\r' > "$out/probe-live.txt" || true
  if grep -qx DONE "$out/probe-live.txt"; then break; fi
  sleep 1
done
pid=$(adb shell ps | tr -d '\r' | awk '$NF == "is.xyz.mpv" {print $2; exit}')
test -n "$pid"
adb shell cat "/proc/$pid/maps" > "$out/maps.txt"
grep -q 'libmpv.so' "$out/maps.txt"
cat "$out/probe-live.txt"
grep -qx DONE "$out/probe-live.txt"
! grep -q '^FAIL ' "$out/probe-live.txt"
test "$(grep -c '^PASS ' "$out/probe-live.txt")" -eq 7
