#!/usr/bin/env bash
# P0-B step 3: require the freshly built libmpv APK to run on an API 22 guest.
set -euo pipefail
adb start-server >/dev/null 2>&1 || true

out=.harness/libmpv-poc
mkdir -p "$out"

test "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" = 22
# The downloaded artifact keeps the upload paths, so search for any APK and show
# the tree when the search comes back empty.
find "$out" -maxdepth 8 -type f -name '*.apk' | head -20
apk=$(find "$out" -type f -name '*.apk' | head -1)
echo "apk: $apk"
if [ -z "$apk" ]; then
  echo 'artifact tree:'
  find "$out" -maxdepth 4 | head -40
  exit 1
fi

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
