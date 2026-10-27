"""Validate the install constraints from the user's API 22 television handoff."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile

apk = Path('android-tv/app/build/outputs/apk/debug/app-debug.apk')
out = Path('.harness/android-tv-package')
badging = (out / 'badging.txt').read_text()
signature = (out / 'signature.txt').read_text()
assert "sdkVersion:'21'" in badging
assert "versionName='0.1.0-alpha.1'" in badging
assert 'Verified using v1 scheme (JAR signing): true' in signature
assert 'io.mycinema.tv' in badging
with zipfile.ZipFile(apk) as archive:
    names = archive.namelist()
    assert any(re.fullmatch(r'META-INF/[^/]+\.RSA', name) for name in names)
    assert not any(name.startswith('lib/') and name.endswith('.so') for name in names)
    for name in names:
        if re.fullmatch(r'classes\d*\.dex', name):
            assert archive.read(name)[:8] == b'dex\n035\x00', 'DEX must work on API 21/22'
report = {
    'version': '0.1.0-alpha.1', 'developmentBuild': True, 'minSdk': 21, 'targetSdk': 35,
    'v1SignatureVerified': True, 'nativeLibraries': False, 'cpuAbiIndependent': True,
    'source': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
    'run': os.environ.get('GITHUB_RUN_ID'), 'sha256': hashlib.sha256(apk.read_bytes()).hexdigest(),
    'bytes': apk.stat().st_size, 'actualTelevisionVerified': False,
}
(out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
