#!/usr/bin/env bash
# P0-B step 3: require the freshly built libmpv APK to run on an API 22 guest.
set -euo pipefail
adb start-server >/dev/null 2>&1 || true

out=.harness/libmpv-poc
mkdir -p "$out"

test "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" = 22
apk=$(find "$out" -name 'app-debug.apk' | head -1)
echo "apk: $apk"
test -n "$apk"

adb install -r "$apk"
adb shell am start -W -n is.xyz.mpv/.MPVActivity
sleep 12

pid=$(adb shell pidof is.xyz.mpv | tr -d '\r')
echo "pid: $pid"
test -n "$pid"

adb shell dumpsys meminfo is.xyz.mpv > "$out/meminfo.txt" || true
head -20 "$out/meminfo.txt" || true
adb logcat -d > "$out/runtime-logcat.txt" || true
grep -iE 'mpv|libav' "$out/runtime-logcat.txt" | tail -40 || true
echo "libmpv runtime gate passed on API 22"
