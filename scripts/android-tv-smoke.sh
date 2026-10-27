#!/usr/bin/env bash
set -euo pipefail
case "$(adb get-serialno)" in emulator-*) ;; *) echo 'Only disposable emulators are permitted.' >&2; exit 1;; esac
test "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" = 22
mkdir -p .harness/android-tv-emulator
adb shell wm size 1280x720
adb shell wm density 160
adb install -r android-tv/app/build/outputs/apk/debug/app-debug.apk
adb install -r android-tv/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb logcat -c
adb shell am instrument -w -e disposableEmulator true io.mycinema.tv.test/io.mycinema.tv.SmokeInstrumentation | tee .harness/android-tv-emulator/instrumentation.txt
adb logcat -d > .harness/android-tv-emulator/logcat.txt
adb exec-out run-as io.mycinema.tv cat files/tv-smoke-report.json > .harness/android-tv-emulator/report.json
python3 - <<'PY'
import json
report=json.load(open('.harness/android-tv-emulator/report.json'))
assert report['result']=='passed' and report['apiLevel']==22
PY
for name in 01-empty 02-home 03-home-next-focus 04-film-detail 05-library 06-collections 07-watchlist 08-settings; do
  adb exec-out run-as io.mycinema.tv cat "files/$name.png" > ".harness/android-tv-emulator/$name.png"
done
