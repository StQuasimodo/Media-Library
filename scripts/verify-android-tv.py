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
version = re.search(r"versionName '([^']+)'", Path('android-tv/app/build.gradle').read_text()).group(1)
assert f"versionName='{version}'" in badging
assert 'Verified using v1 scheme (JAR signing): true' in signature
assert 'io.mycinema.tv' in badging
signer = re.search(r'certificate SHA-256 digest: ([0-9a-f]+)', signature).group(1)
pinned = signer == Path('android-tv/development-signing.sha256').read_text().strip()
if os.environ.get('TV_PIN_DEVELOPMENT_SIGNING') == '1':
    assert pinned, 'Built APK does not use the active pinned signer'
with zipfile.ZipFile(apk) as archive:
    names = archive.namelist()
    assert 'assets/resource-name-cases.json' not in names, 'Parser fixtures belong only in the instrumentation APK'
    assert any(re.fullmatch(r'META-INF/[^/]+\.RSA', name) for name in names)
    native = [name for name in names if name.startswith('lib/') and name.endswith('.so')]
    assert {name.split('/')[1] for name in native} == {'armeabi-v7a', 'x86'}
    # The older LibVLC runtime is missing symbols required by the pinned mpv libraries.
    runtime_digests = {
        'armeabi-v7a': '4df8b2e81690dd1393a94f65c18b41e5b91494b10b21415823a94ab6bb81018a',
        'x86': '9eef90154d953ed3dc39abb4af5a8ca6fc76474c2f07e66e44c8fcbd60572f05',
    }
    for abi, digest in runtime_digests.items():
        runtime = archive.read(f'lib/{abi}/libc++_shared.so')
        assert hashlib.sha256(runtime).hexdigest() == digest, f'{abi} needs the pinned mpv C++ runtime'
        for library in ['libvlc.so', 'libvlcjni.so', 'libc++_shared.so', 'libplayer.so', 'libmpv.so']:
            assert f'lib/{abi}/{library}' in native
    assert 'assets/licenses/LGPL-2.1.txt' in names
    assert 'assets/licenses/NOTICE.txt' in names
    for name in names:
        if re.fullmatch(r'classes\d*\.dex', name):
            assert archive.read(name)[:8] == b'dex\n035\x00', 'DEX must work on API 21/22'
            assert b'BackupTestProvider' not in archive.read(name), 'Test document provider must never ship in the app'
report = {
    'version': version, 'developmentBuild': True, 'minSdk': 21, 'targetSdk': 35,
    'v1SignatureVerified': True, 'nativeLibraries': True, 'cpuAbiIndependent': False,
    'nativeAbis': ['armeabi-v7a','x86'], 'player': 'LibVLC 3.7.7', 'dualSubtitlePlayer': 'mpv-android 2024-11-16',
    'source': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
    'run': os.environ.get('GITHUB_RUN_ID'), 'sha256': hashlib.sha256(apk.read_bytes()).hexdigest(),
    'bytes': apk.stat().st_size, 'actualTelevisionVerified': False,
    'signerSha256': signer, 'pinnedSignerVerified': pinned,
}
(out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
