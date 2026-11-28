"""Unpack the two pinned upstream API21 JNI builds into Gradle's generated directory."""
from pathlib import Path
import hashlib
import os
import subprocess
import tempfile
from shutil import copyfileobj
from urllib.request import Request, urlopen
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
        with tempfile.TemporaryDirectory(dir=cache) as staging:
            incoming = Path(staging) / apk.name
            if os.environ.get('GH_TOKEN'):
                subprocess.run(['gh', 'release', 'download', '2024-11-16', '-R', 'mpv-android/mpv-android',
                                '-p', apk.name, '-D', staging], check=True)
            else:
                url = 'https://github.com/mpv-android/mpv-android/releases/download/2024-11-16/' + apk.name
                with urlopen(Request(url, headers={'User-Agent': 'My-Cinema-build'}), timeout=60) as response:
                    with incoming.open('wb') as destination:
                        copyfileobj(response, destination)
            if hashlib.sha256(incoming.read_bytes()).hexdigest() != checksum:
                raise ValueError(f'Unexpected upstream APK digest for {abi}')
            incoming.replace(apk)
    if hashlib.sha256(apk.read_bytes()).hexdigest() != checksum:
        raise ValueError(f'Unexpected upstream APK digest for {abi}')
    with ZipFile(apk) as archive:
        for name in archive.namelist():
            parts = name.split('/')
            if len(parts) != 3 or parts[:2] != ['lib', abi] or not name.endswith('.so'):
                continue
            target = output / abi / parts[2]
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(name))
