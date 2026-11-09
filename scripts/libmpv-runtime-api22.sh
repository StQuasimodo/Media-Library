#!/usr/bin/env bash
# P0-B step 3: require the freshly built libmpv APK to run on an API 22 guest.
set -euo pipefail
adb start-server >/dev/null 2>&1 || true

out=.harness/libmpv-poc
mkdir -p "$out"

test "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" = 22
# Require the default flavor; never select an arbitrary api30 APK.
mapfile -t candidates < <(find "$out" -type f -name 'app-default-universal-debug.apk')
if [ "${#candidates[@]}" -ne 1 ]; then echo "Expected exactly one default APK, found ${#candidates[@]}"; exit 1; fi
apk=${candidates[0]}
aapt=$(find "$ANDROID_HOME/build-tools" -name aapt -type f | sort -V | tail -1)
badging=$("$aapt" dump badging "$apk")
sdk=$(printf '%s\n' "$badging" | sed -n "s/^sdkVersion:'\([0-9]*\)'$/\1/p")
test -n "$sdk" && test "$sdk" -le 22
install=$(adb install -r "$apk" 2>&1) || { echo "$install"; exit 1; }
echo "$install"
grep -qx 'Success' <<< "$(tr -d '\r' <<< "$install" | tail -1)"
start=$(adb shell am start -W -n is.xyz.mpv/.MPVActivity 2>&1 | tr -d '\r')
echo "$start"
grep -q '^Status: ok' <<< "$start"
sleep 12
pid=$(adb shell ps | tr -d '\r' | awk '$NF == "is.xyz.mpv" {print $2; exit}')
test -n "$pid"
adb shell cat "/proc/$pid/maps" > "$out/maps.txt"
grep -q 'libmpv.so' "$out/maps.txt"

adb shell dumpsys meminfo is.xyz.mpv > "$out/meminfo.txt" || true
head -20 "$out/meminfo.txt" || true
adb logcat -d > "$out/runtime-logcat.txt" || true
grep -iE 'mpv|libav' "$out/runtime-logcat.txt" | tail -40 || true
echo "libmpv runtime gate passed on API 22"
