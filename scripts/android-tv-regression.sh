#!/usr/bin/env bash
set -euo pipefail
case "$(adb get-serialno)" in emulator-*) ;; *) echo 'Disposable emulator required.' >&2; exit 1;; esac
test "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" = 22
out=.harness/tv-regression
mkdir -p "$out"
wait_for_device() { timeout 120s adb wait-for-device; }
wait_for_boot() {
  local deadline=$((SECONDS + 120))
  while test "$(timeout 5s adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" != 1; do
    if (( SECONDS >= deadline )); then echo 'Android guest did not finish booting.' >&2; return 1; fi
    sleep 1
  done
}
configure_app_heap() {
  # Modern emulator versions enforce a larger VM maximum. Limit normal apps
  # through Android's own growth-limit property; do not alter/re-sign the APK.
  adb root
  wait_for_device
  adb shell setprop dalvik.vm.heapgrowthlimit "${TV_HEAP_MIB}m"
  adb shell setprop sys.boot_completed 0
  adb shell stop
  adb shell start
  wait_for_boot
  adb shell getprop dalvik.vm.heapgrowthlimit > "$out/guest-heap-growth-limit.txt"
}
configure_app_heap
adb shell wm size reset
adb shell wm density "$TV_DENSITY"
adb shell settings put secure immersive_mode_confirmations confirmed
adb install -r "$out/target.apk"
adb install -r android-tv/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
collect() {
  # Preserve completed phases if the emulator disappears during a later reboot.
  if ! timeout 5s adb get-state >/dev/null 2>&1; then return 0; fi
  timeout 15s adb logcat -d > "$out/logcat.txt" || true
  for name in full process reboot; do
    if timeout 10s adb exec-out run-as io.mycinema.tv cat "files/regression-$name.json" > "$out/$name.json.tmp" 2>/dev/null; then mv "$out/$name.json.tmp" "$out/$name.json"; else rm -f "$out/$name.json.tmp"; fi
  done
  for name in r00-failure r01-configured r02-season-picker r03-imported-detail r04-season-selection r08-stress-wall r09-process-restart r10-device-reboot; do
    if timeout 10s adb exec-out run-as io.mycinema.tv cat "files/$name.png" > "$out/$name.png.tmp" 2>/dev/null; then mv "$out/$name.png.tmp" "$out/$name.png"; else rm -f "$out/$name.png.tmp"; fi
  done
}
trap collect EXIT
adb logcat -c
# Real public network check runs BEFORE emulator-only DNS and CA fixture setup.
timeout 90s adb shell am instrument -w -e disposableEmulator true -e networkProbe true io.mycinema.tv.test/io.mycinema.tv.SmokeInstrumentation | tee "$out/public-network-instrumentation.txt"
adb exec-out run-as io.mycinema.tv cat files/tv-network-report.json > "$out/public-network.json"
adb root
wait_for_device
adb remount
ca_name=$(cat .harness/tv-fixture-private/ca-name.txt)
adb push .harness/tv-fixture-private/ca.pem "/system/etc/security/cacerts/$ca_name"
adb shell chmod 644 "/system/etc/security/cacerts/$ca_name"
adb pull /system/etc/hosts .harness/tv-fixture-private/hosts-original
python3 - <<'PY'
from pathlib import Path
root=Path('.harness/tv-fixture-private')
(root/'hosts').write_text((root/'hosts-original').read_text()+'\n10.0.2.2 api.tmdb.org api.themoviedb.org image.tmdb.org drive-pc.quark.cn\n')
PY
adb push .harness/tv-fixture-private/hosts /system/etc/hosts
adb shell chmod 644 /system/etc/hosts
run_phase() {
  adb shell run-as io.mycinema.tv rm -f "files/regression-$1.json"
  timeout 180s adb shell am instrument -w -e disposableEmulator true -e regression true -e expectedHeapMiB "$TV_HEAP_MIB" -e phase "$1" io.mycinema.tv.test/io.mycinema.tv.SmokeInstrumentation | tee "$out/$1-instrumentation.txt"
  grep -q 'INSTRUMENTATION_RESULT: result=passed' "$out/$1-instrumentation.txt"
}
run_phase full
collect
adb shell am force-stop io.mycinema.tv
run_phase process
collect
adb shell cat /proc/sys/kernel/random/boot_id > "$out/boot-before.txt"
adb reboot
wait_for_device
wait_for_boot
configure_app_heap
adb shell settings put secure immersive_mode_confirmations confirmed
adb shell input keyevent 82
adb shell cat /proc/sys/kernel/random/boot_id > "$out/boot-after.txt"
if cmp -s "$out/boot-before.txt" "$out/boot-after.txt"; then echo 'Emulator did not actually reboot.' >&2; exit 1; fi
run_phase reboot
collect
python3 - <<'PY'
import json,os
from pathlib import Path
root=Path('.harness/tv-regression')
for phase in ['full','process','reboot']:
    assert json.loads((root/f'{phase}.json').read_text())['result']=='passed'
assert json.loads((root/'public-network.json').read_text())['realTmdbUnauthorizedResponseVerified']
summary={'profile':os.environ['TV_PROFILE'],'result':'passed','api':22,'controlledTmdbSuccessFlow':True,'actualPublic401Verified':True,'processRestartVerified':True,'emulatorRebootVerified':True,'physicalTelevisionVerified':False,'realAccountVerified':False,'apk':json.loads((root/'target.json').read_text())}
(root/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
PY
