"""Disposable API22: historical APK, read-only export, rejected wrong signer and parallel upgrade."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import time
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location('legacy_export', Path(__file__).with_name('export-tv-legacy.py'))
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)
OUT = Path('.harness/tv-migration')
PRIVATE = Path('.harness/tv-migration-private')
PKG = 'io.mycinema.tv'
PREVIEW = PKG + '.preview'


def adb(*args, check=True):
    value = subprocess.run(['adb', *args], capture_output=True, timeout=45)
    if check and value.returncode:
        raise AssertionError('Controlled adb operation failed')
    return value.stdout.decode(errors='replace') + value.stderr.decode(errors='replace')


def nodes():
    adb('shell', 'uiautomator', 'dump', '/sdcard/migration-ui.xml')
    return list(ET.fromstring(adb('shell', 'cat', '/sdcard/migration-ui.xml')).iter('node'))


def tap(node):
    bounds = [int(v) for v in re.findall(r'\d+', node.attrib['bounds'])]
    assert len(bounds) == 4 and bounds[2] > bounds[0] and bounds[3] > bounds[1]
    adb('shell', 'input', 'tap', str((bounds[0] + bounds[2]) // 2), str((bounds[1] + bounds[3]) // 2))
    time.sleep(.2)


def click(text):
    for _ in range(8):
        for node in nodes():
            if node.attrib.get('text') == text:
                tap(node)
                return
        time.sleep(.3)
    raise AssertionError('Legacy native UI control not found')


def enter(index, text):
    editors = []
    for _ in range(8):
        editors = [n for n in nodes() if n.attrib.get('class') == 'android.widget.EditText']
        if len(editors) > index:
            break
        time.sleep(.3)
    assert len(editors) > index, 'Legacy native editor not visible'
    tap(editors[index])
    adb('shell', 'input', 'text', text.replace(' ', '%s'))
    if 'mInputShown=true' in adb('shell', 'dumpsys', 'input_method'):
        adb('shell', 'input', 'keyevent', '4')


def digest_database():
    data = subprocess.run(['adb', 'exec-out', 'run-as', PKG, 'cat', 'databases/my-cinema-tv.db'], capture_output=True, check=True).stdout
    return hashlib.sha256(data).hexdigest()


def instrument(phase):
    result = adb('shell', 'am', 'instrument', '-w', '-e', 'disposableEmulator', 'true', '-e', 'migration', phase,
                 '-e', 'buildRun', os.environ['GITHUB_RUN_ID'], PREVIEW + '.test/io.mycinema.tv.SmokeInstrumentation')
    (OUT / (phase + '-instrumentation.txt')).write_text(result)
    assert 'INSTRUMENTATION_RESULT: result=passed' in result, 'Native migration assertion failed'
    raw = subprocess.run(['adb', 'exec-out', 'run-as', PREVIEW, 'cat', f'files/migration-{phase}.json'], capture_output=True, check=True).stdout
    (OUT / (phase + '.json')).write_bytes(raw)
    image = subprocess.run(['adb', 'exec-out', 'run-as', PREVIEW, 'cat', f'files/migration-{phase}.png'], capture_output=True, check=True).stdout
    (OUT / (phase + '.png')).write_bytes(image)
    assert json.loads(raw)['result'] == 'passed'


def main():
    assert os.environ.get('GITHUB_ACTIONS') == 'true'
    serial = adb('get-serialno').strip()
    assert serial.startswith('emulator-') and adb('shell', 'getprop', 'ro.build.version.sdk').strip() == '22'
    # API22 ignores the emulator's -dpi-device flag on this image. Match the
    # existing 720p TV smoke harness before measuring/tapping native controls.
    adb('shell', 'wm', 'size', 'reset')
    adb('shell', 'wm', 'density', '160')
    adb('shell', 'settings', 'put', 'system', 'font_scale', '1.0')
    assert 'Override density: 160' in adb('shell', 'wm', 'density')
    OUT.mkdir(parents=True, exist_ok=True)
    PRIVATE.mkdir(parents=True, exist_ok=True)
    old = Path('.harness/tv-legacy-release/My-Cinema-TV-0.1.0-alpha.3-debug.apk')
    assert hashlib.sha256(old.read_bytes()).hexdigest() == '83e074cba861a3dae1456a1763cee469e737b02f5c7f4a7df2424ce2b93e8bff'
    assert 'Success' in adb('install', str(old))
    adb('shell', 'settings', 'put', 'secure', 'immersive_mode_confirmations', 'confirmed')
    adb('shell', 'am', 'start', '-W', '-n', PKG + '/io.mycinema.tv.MainActivity')
    click('手动添加')
    enter(0, 'Migration Movie')
    click('保存')
    click('编辑观影记录')
    enter(0, '9')
    enter(1, 'Legacy reason')
    click('保存')
    adb('shell', 'am', 'force-stop', PKG)
    before = digest_database()
    exported = PRIVATE / 'legacy-export.json'
    metadata = exporter.export_device(serial, exported)
    assert metadata['filmCount'] == 1 and metadata['mediaCount'] == 0
    value = json.loads(exported.read_text())
    assert value['collection']['films'][0]['title'] == 'Migration Movie'
    assert value['collection']['entries'][0]['personalRating'] == 9
    assert value['collection']['entries'][0]['favoriteReason'] == 'Legacy reason'
    assert digest_database() == before, 'Read-only exporter modified original database'
    replacement = adb('install', '-r', '.harness/tv-migration-private/current-default.apk', check=False)
    assert 'INSTALL_FAILED_UPDATE_INCOMPATIBLE' in replacement, 'Different signer must not be accepted'
    assert digest_database() == before and 'versionName=0.1.0-alpha.3' in adb('shell', 'dumpsys', 'package', PKG)
    assert 'Success' in adb('install', '.harness/tv-migration-private/preview-v7.apk')
    assert 'Success' in adb('install', '.harness/tv-migration-private/preview-test.apk')
    adb('shell', 'mkdir', '-p', '/sdcard/Download/MyCinema')
    adb('push', str(exported), '/sdcard/Download/MyCinema/legacy-migration.json')
    instrument('import')
    assert 'Success' in adb('install', '-r', '.harness/tv-migration-private/preview-v8.apk')
    instrument('upgrade')
    assert digest_database() == before, 'Parallel migration must retain original installation and data'
    report = {'result': 'passed', 'buildRun': os.environ['GITHUB_RUN_ID'], 'apiLevel': 22,
              'historicalApkSha256': hashlib.sha256(old.read_bytes()).hexdigest(), 'legacyNativeUiSeeded': True,
              'readOnlyExportVerified': True, 'differentSignerUpdateRejected': True, 'originalDataUnchanged': True,
              'parallelImportVerified': True, 'sameTestSignerUpgradeVerified': True,
              'originalSignerUpgradeVerified': False, 'physicalTelevisionVerified': False}
    (OUT / 'summary.json').write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    try:
        main()
    finally:
        # The action shuts down the guest as soon as this script exits.
        OUT.mkdir(parents=True, exist_ok=True)
        for arguments, name in [(('logcat', '-d'), 'logcat.txt'),
                                (('exec-out', 'screencap', '-p'), 'last-screen.png')]:
            try:
                result = subprocess.run(['adb', *arguments], capture_output=True, timeout=15)
                if result.returncode == 0:
                    (OUT / name).write_bytes(result.stdout)
            except (OSError, subprocess.TimeoutExpired):
                pass
