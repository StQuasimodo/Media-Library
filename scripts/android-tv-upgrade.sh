#!/usr/bin/env bash
set -euo pipefail
test "$GITHUB_ACTIONS" = true
case "$(adb get-serialno)" in emulator-*) ;; *) exit 1;; esac
test "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" = 22
root=.harness/tv-upgrade-private
out=.harness/tv-upgrade
mkdir -p "$out"
adb install "$root/My-Cinema-TV-0.2.0-alpha.5-debug.apk"
adb install "$root/baseline-test.apk"
adb shell am instrument -w -e disposableEmulator true -e baselineUpgrade true io.mycinema.tv.test/io.mycinema.tv.SmokeInstrumentation | tee "$out/baseline-instrumentation.txt"
grep -q 'INSTRUMENTATION_RESULT: result=passed' "$out/baseline-instrumentation.txt"
adb exec-out run-as io.mycinema.tv cat files/upgrade-baseline.json > "$out/baseline.json"
adb shell am force-stop io.mycinema.tv
adb install -r .harness/tv-regression/target.apk
adb install -r android-tv/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell am instrument -w -e disposableEmulator true -e features true -e phase upgrade -e buildRun "$GITHUB_RUN_ID" io.mycinema.tv.test/io.mycinema.tv.SmokeInstrumentation > "$out/upgrade-instrumentation.txt"
grep -q 'INSTRUMENTATION_RESULT: result=passed' "$out/upgrade-instrumentation.txt"
adb exec-out run-as io.mycinema.tv cat files/features-upgrade.json > "$out/upgrade.json"
# All data here is the synthetic baseline above, on this CI-created emulator.
# The full smoke suite separately requires a clean install state.
adb shell am force-stop io.mycinema.tv
adb shell pm clear io.mycinema.tv
