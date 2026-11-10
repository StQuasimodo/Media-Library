#!/usr/bin/env bash
set -euo pipefail
suite=${TV_TEST_SUITE:-full}
case "$suite" in
  full|resource_names|backup) ;;
  *) echo 'Unknown TV validation suite.' >&2; exit 2 ;;
esac
bash scripts/android-tv-smoke.sh
case "$suite" in
  resource_names) bash scripts/android-tv-resource-names.sh ;;
  backup)
    bash scripts/android-tv-resource-names.sh
    bash scripts/android-tv-backup.sh
    ;;
  full)
    bash scripts/android-tv-resource-names.sh
    bash scripts/android-tv-backup.sh
    bash scripts/android-tv-playback.sh
    bash scripts/android-tv-regression.sh
    ;;
esac
