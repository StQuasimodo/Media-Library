#!/usr/bin/env bash
set -euo pipefail
case "$(adb get-serialno)" in emulator-*) ;; *) echo 'Only disposable emulators are permitted.' >&2; exit 1;; esac
test "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" = 22
mkdir -p .harness/android-tv-emulator
# API 22 SurfaceFlinger cannot capture a virtual size wider than the physical
# framebuffer. The emulator itself is launched at 1280x720; do not override wm size.
adb shell wm size reset
adb shell wm density 160
adb install -r android-tv/app/build/outputs/apk/debug/app-debug.apk
adb install -r android-tv/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb logcat -c
trap 'adb logcat -d > .harness/android-tv-emulator/logcat.txt || true' EXIT
adb shell am instrument -w -e disposableEmulator true io.mycinema.tv.test/io.mycinema.tv.SmokeInstrumentation | tee .harness/android-tv-emulator/instrumentation.txt
adb logcat -d > .harness/android-tv-emulator/logcat.txt
grep -q 'INSTRUMENTATION_RESULT: result=passed' .harness/android-tv-emulator/instrumentation.txt
adb exec-out run-as io.mycinema.tv cat files/tv-smoke-report.json > .harness/android-tv-emulator/report.json
python3 - <<'PY'
import json
report=json.load(open('.harness/android-tv-emulator/report.json'))
assert report['result']=='passed' and report['apiLevel']==22
PY
for name in 01-empty 02-home 03-home-next-focus 04-film-detail 05-library 06-collections 07-watchlist 08-settings; do
  adb exec-out run-as io.mycinema.tv cat "files/$name.png" > ".harness/android-tv-emulator/$name.png"
done
adb shell am instrument -w -e disposableEmulator true -e networkProbe true io.mycinema.tv.test/io.mycinema.tv.SmokeInstrumentation | tee .harness/android-tv-emulator/network-instrumentation.txt
adb exec-out run-as io.mycinema.tv cat files/tv-network-report.json > .harness/android-tv-emulator/network-report.json
python3 - <<'PY'
import json
assert json.load(open('.harness/android-tv-emulator/network-report.json'))['realTmdbUnauthorizedResponseVerified']
PY
