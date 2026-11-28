"""Unpack the two pinned upstream API21 JNI builds into Gradle's generated directory."""
from pathlib import Path
import hashlib
import subprocess
import sys
from zipfile import ZipFile

root = Path(__file__).resolve().parents[1]
cache = root / '.harness/mpv-release'
cache.mkdir(parents=True, exist_ok=True)
output = Path(sys.argv[1])
for abi, checksum in {
    'armeabi-v7a': '577b2729268442d9c61e9223bdade93fb8995a17c8d6bb526b8121b6fd1343c3',
    'x86': '90cdd455167c71c794f07c9d9458eb303526e1fca7f7f9ac0f8d71121d722414',
}.items():
    apk = cache / f'app-default-{abi}-release.apk'
    if not apk.exists():
        subprocess.run(['gh', 'release', 'download', '2024-11-16', '-R', 'mpv-android/mpv-android',
                        '-p', apk.name, '-D', str(cache)], check=True)
    if hashlib.sha256(apk.read_bytes()).hexdigest() != checksum:
        raise ValueError(f'Unexpected upstream APK digest for {abi}')
    with ZipFile(apk) as archive:
        for name in archive.namelist():
            parts = name.split('/')
            if len(parts) != 3 or parts[:2] != ['lib', abi] or not name.endswith('.so'):
                continue
            if parts[2] == 'libc++_shared.so':
                continue  # one shared C++ runtime per ABI, supplied by LibVLC
            target = output / abi / parts[2]
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(name))
