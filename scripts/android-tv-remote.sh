#!/usr/bin/env bash
set -euo pipefail
case "$(adb get-serialno)" in emulator-*) ;; *) exit 1;; esac
test "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" = 22
out=.harness/tv-remote
mkdir -p "$out"
collect() {
  timeout 10s adb exec-out run-as io.mycinema.tv cat files/remote-report.json > "$out/report.json" || true
  for image in remote-rating remote-mirrors remote-failure; do timeout 10s adb exec-out run-as io.mycinema.tv cat "files/$image.png" > "$out/$image.png" || true; done
  timeout 10s adb logcat -d > "$out/logcat.txt" || true
}
trap collect EXIT
timeout 180s adb shell am instrument -w -e disposableEmulator true -e remote true -e buildRun "$GITHUB_RUN_ID" io.mycinema.tv.test/io.mycinema.tv.SmokeInstrumentation | tee "$out/instrumentation.txt"
grep -q 'INSTRUMENTATION_RESULT: result=passed' "$out/instrumentation.txt"
collect
python3 - <<'PY'
import json,os
r=json.load(open('.harness/tv-remote/report.json'))
assert r['result']=='passed' and r['apiLevel']==22 and r['buildRun']==os.environ['GITHUB_RUN_ID'] and r['remoteKeyEvents']>=30
assert not r['textInputUsedForQuickActions'] and not r['physicalRemoteVerified']
PY
