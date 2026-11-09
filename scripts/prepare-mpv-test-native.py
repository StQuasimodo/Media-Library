"""Provision instrumented-test libraries only from the exact pre-verified PoC APK."""
import sys
from pathlib import Path
from zipfile import ZipFile
apk=Path(sys.argv[1])
out=Path('android-tv/app/src/androidTest/jniLibs')
with ZipFile(apk) as archive:
    for abi in ('armeabi-v7a','x86'):
        prefix='lib/'+abi+'/'
        names=[n for n in archive.namelist() if n.startswith(prefix) and n.endswith('.so') and n.count('/')==2]
        assert prefix+'libmpv.so' in names and prefix+'libplayer.so' in names
        for name in names:
            target=out/abi/Path(name).name
            target.parent.mkdir(parents=True,exist_ok=True)
            target.write_bytes(archive.read(name))
