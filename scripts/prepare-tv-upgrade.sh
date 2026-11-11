#!/usr/bin/env bash
set -euo pipefail
root=.harness/tv-upgrade-private
mkdir -p "$root"
# Retain the exact released bytes; only its test driver is compiled separately.
gh release download tv-v0.2.0-alpha.5 -R "$GITHUB_REPOSITORY" -p '*.apk' -D "$root"
echo '1c03fd9052ec49124dc679302bde543269a1f969288d58fb7e4286cdf43c5fda  .harness/tv-upgrade-private/My-Cinema-TV-0.2.0-alpha.5-debug.apk' | sha256sum -c -
git fetch --depth=1 origin 3d0d68cdbd5febb1648a111c5c753a56ed4dbdd7
git worktree add --detach "$root/source" 3d0d68cdbd5febb1648a111c5c753a56ed4dbdd7
cp android-tv/app/src/androidTest/java/io/mycinema/tv/LegacyBaselineScenario.java "$root/source/android-tv/app/src/androidTest/java/io/mycinema/tv/"
python3 - <<'PY'
from pathlib import Path
p=Path('.harness/tv-upgrade-private/source/android-tv/app/src/androidTest/java/io/mycinema/tv/SmokeInstrumentation.java')
s=p.read_text();marker='            if(arguments.getString("migration")!=null)'
assert marker in s
s=s.replace(marker,'            if("true".equals(arguments.getString("baselineUpgrade"))){new LegacyBaselineScenario(this).run();return;}\n'+marker)
p.write_text(s)
PY
(cd "$root/source/android-tv" && ./gradlew --no-daemon assembleDebugAndroidTest)
cp "$root/source/android-tv/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk" "$root/baseline-test.apk"
