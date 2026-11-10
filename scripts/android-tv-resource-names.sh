#!/usr/bin/env bash
set -euo pipefail
case "$(adb get-serialno)" in emulator-*) ;; *) echo 'Disposable emulator required.' >&2; exit 1;; esac
test "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" = 22
out=.harness/tv-resource-names
mkdir -p "$out"
adb shell run-as io.mycinema.tv rm -f files/tv-resource-name-report.json
collect() {
  timeout 10s adb exec-out run-as io.mycinema.tv cat files/tv-resource-name-report.json > "$out/report.json" || true
  timeout 10s adb logcat -d > "$out/logcat.txt" || true
}
trap collect EXIT
timeout 90s adb shell am instrument -w -e disposableEmulator true -e resourceNames true -e buildRun "$GITHUB_RUN_ID" io.mycinema.tv.test/io.mycinema.tv.SmokeInstrumentation | tee "$out/instrumentation.txt"
grep -q 'INSTRUMENTATION_RESULT: result=passed' "$out/instrumentation.txt"
collect
python3 - <<'PY'
import hashlib,json,os
from pathlib import Path
report=json.load(open('.harness/tv-resource-names/report.json'))
assert report['result']=='passed' and report['apiLevel']==22
assert report['buildRun']==os.environ['GITHUB_RUN_ID']
assert report['fixtureCount']>=26 and report['matchingChecks']==8 and report['catalogPreservationChecks']==5
assert report['fixtureSha256']==hashlib.sha256(Path('tests/fixtures/resource-name-cases.json').read_bytes()).hexdigest()
PY
