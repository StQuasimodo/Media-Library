#!/usr/bin/env bash
set -euo pipefail
case "$(adb get-serialno)" in emulator-*) ;; *) echo 'Disposable emulator required.' >&2; exit 1;; esac
test "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" = 22
out=.harness/tv-playback
mkdir -p "$out"
collect() {
  timeout 15s adb logcat -d > "$out/logcat.txt" || true
  timeout 10s adb exec-out run-as io.mycinema.tv cat files/tv-playback-report.json > "$out/report.json" || true
  timeout 10s adb exec-out run-as io.mycinema.tv cat files/p01-playing.png > "$out/p01-playing.png" || true
  timeout 10s adb exec-out run-as io.mycinema.tv cat files/p02-sources.png > "$out/p02-sources.png" || true
}
trap collect EXIT
timeout 180s adb shell am instrument -w -e disposableEmulator true -e playback true io.mycinema.tv.test/io.mycinema.tv.SmokeInstrumentation | tee "$out/instrumentation.txt"
grep -q 'INSTRUMENTATION_RESULT: result=passed' "$out/instrumentation.txt"
collect
python3 - <<'PY'
import json
report=json.load(open('.harness/tv-playback/report.json'))
assert report['result']=='passed' and report['apiLevel']==22
PY
