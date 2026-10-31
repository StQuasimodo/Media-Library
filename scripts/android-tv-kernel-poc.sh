#!/usr/bin/env bash
# Runs the kernel PoC scenario on the disposable API 22 guest and collects its report.
set -euo pipefail
case "$(adb get-serialno)" in emulator-*) ;; *) echo 'Disposable emulator required.' >&2; exit 1;; esac
test "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" = 22

out=.harness/tv-kernel-poc
mkdir -p "$out"
adb shell am force-stop io.mycinema.tv
adb shell run-as io.mycinema.tv rm -f files/kernel-poc-report.json || true

collected=0
collect() {
  [ "$collected" = "1" ] && return 0
  collected=1
  timeout 15s adb logcat -d > "$out/logcat.txt" || true
  timeout 10s adb exec-out run-as io.mycinema.tv cat files/kernel-poc-report.json > "$out/report.json" || true
  adb shell am force-stop io.mycinema.tv || true
}
trap collect EXIT

timeout 300s adb shell am instrument -w \
  -e disposableEmulator true \
  -e kernelPoc true \
  -e buildRun "$GITHUB_RUN_ID" \
  io.mycinema.tv.test/io.mycinema.tv.SmokeInstrumentation | tee "$out/instrumentation.txt"
grep -q 'INSTRUMENTATION_RESULT: result=passed' "$out/instrumentation.txt"
# Collect before asserting: the report only exists on the device until pulled.
collect
test -s "$out/report.json"

python3 - <<'PY'
import json, os
report = json.load(open('.harness/tv-kernel-poc/report.json'))
assert report['result'] == 'passed', report
assert report['apiLevel'] == 22, report
assert report['buildRun'] == os.environ['GITHUB_RUN_ID'], report
assert report['spuCount'] >= 1, report
assert report['dualSubtitleApiPresent'] is False, report
assert report['hardwarePlaying'] and report['softwarePlaying'], report
print('kernel poc report:', {k: report[k] for k in ('spuCount', 'dualSubtitleApiPresent', 'hardwarePlaying', 'softwarePlaying', 'seekAccepted', 'paused', 'resumed')})
print('subtitle tracks:', report['spuTracks'])
PY
