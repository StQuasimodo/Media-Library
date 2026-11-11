#!/usr/bin/env bash
set -euo pipefail
case "$(adb get-serialno)" in emulator-*) ;; *) exit 1;; esac
test "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" = 22
out=.harness/tv-features
mkdir -p "$out"
collect() {
  timeout 10s adb exec-out run-as io.mycinema.tv cat files/features-full.json > "$out/report.json" || true
  timeout 10s adb exec-out run-as io.mycinema.tv cat files/features-folders.png > "$out/folders.png" || true
}
trap collect EXIT
timeout 180s adb shell am instrument -w -e disposableEmulator true -e features true -e phase full -e buildRun "$GITHUB_RUN_ID" io.mycinema.tv.test/io.mycinema.tv.SmokeInstrumentation | tee "$out/instrumentation.txt"
grep -q 'INSTRUMENTATION_RESULT: result=passed' "$out/instrumentation.txt"
collect
python3 - <<'PY'
import json,os
r=json.load(open('.harness/tv-features/report.json'))
assert r['result']=='passed' and r['apiLevel']==22 and r['buildRun']==os.environ['GITHUB_RUN_ID'] and len(r['checks'])>=16
assert not r['physicalTelevisionVerified']
PY
