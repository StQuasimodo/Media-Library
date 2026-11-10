#!/usr/bin/env bash
set -euo pipefail
suite=${TV_TEST_SUITE:-full}
case "$suite" in
  full|resource_names) ;;
  *) echo 'Unknown TV validation suite.' >&2; exit 2 ;;
esac
bash scripts/android-tv-smoke.sh
case "$suite" in
  resource_names) bash scripts/android-tv-resource-names.sh ;;
  full)
    bash scripts/android-tv-playback.sh
    bash scripts/android-tv-regression.sh
    ;;
esac
