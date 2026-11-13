#!/usr/bin/env python3
"""Run production Java control-queue/lease policies on the host without Android stubs."""
import argparse
import pathlib
import subprocess
import tempfile
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--ecj", help="Optional Eclipse compiler jar for environments with only a JRE")
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parent.parent
source = root / 'android-tv/app/src'
files = [source / 'main/java/io/mycinema/tv' / name for name in ('LeaseLifetime.java', 'QuarkRequestGate.java')]
files.append(source / 'androidTest/java/io/mycinema/tv/QuarkTransportPolicyTest.java')
with tempfile.TemporaryDirectory(prefix='cinema-transport-') as out:
    compiler = ['java', '-jar', args.ecj, '-8', '-nowarn'] if args.ecj else ['javac', '-source', '8', '-target', '8', '-Xlint:-options']
    subprocess.run([*compiler, '-d', out, *map(str, files)], check=True)
    subprocess.run(['java', '-cp', out, 'io.mycinema.tv.QuarkTransportPolicyTest'], check=True, timeout=25)
