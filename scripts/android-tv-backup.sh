#!/usr/bin/env bash
set -euo pipefail
case "$(adb get-serialno)" in emulator-*) ;; *) echo 'Disposable emulator required.' >&2; exit 1;; esac
test "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" = 22
out=.harness/tv-backup
mkdir -p "$out"
adb shell run-as io.mycinema.tv rm -f files/tv-backup-report.json files/tv-backup-settings.png
collect() {
  timeout 10s adb exec-out run-as io.mycinema.tv cat files/tv-backup-report.json > "$out/report.json" || true
  timeout 10s adb exec-out run-as io.mycinema.tv cat files/tv-backup-settings.png > "$out/settings.png" || true
  timeout 10s adb logcat -d > "$out/logcat.txt" || true
}
trap collect EXIT
timeout 180s adb shell am instrument -w -e disposableEmulator true -e backup true -e buildRun "$GITHUB_RUN_ID" io.mycinema.tv.test/io.mycinema.tv.SmokeInstrumentation | tee "$out/instrumentation.txt"
grep -q 'INSTRUMENTATION_RESULT: result=passed' "$out/instrumentation.txt"
collect
python3 - <<'PY'
import json,os
report=json.load(open('.harness/tv-backup/report.json'))
assert report['result']=='passed' and report['apiLevel']==22 and report['buildRun']==os.environ['GITHUB_RUN_ID']
assert report['atomicRollbackVerified'] and report['separateDocumentProviderVerified'] and len(report['checks'])>=13
assert not report['nativeDocumentPickerUiVerified'] and not report['physicalTelevisionVerified']
PY
