"""Send a pinned private Keystore to GitHub Secrets through stdin; never print its bytes."""
import argparse
import base64
import importlib.util
from pathlib import Path
import subprocess
import sys

spec = importlib.util.spec_from_file_location('tv_signer', Path(__file__).with_name('prepare-tv-signer.py'))
signer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(signer)
SECRET = 'TV_DEVELOPMENT_KEYSTORE_BASE64'


def upload(key, pin, repository):
    expected = pin.read_text().strip()
    if signer.fingerprint(key) != expected:
        raise signer.SigningError('Private key does not match the active repository certificate.')
    # Keep the body out of command-line arguments and captured command diagnostics.
    encoded = base64.b64encode(key.read_bytes())
    if len(encoded) > 1024 * 1024:
        raise signer.SigningError('Private key is too large.')
    result = subprocess.run(['gh', 'secret', 'set', SECRET, '--repo', repository],
                            input=encoded, capture_output=True, timeout=60)
    if result.returncode:
        raise signer.SigningError('GitHub refused or could not complete Secret storage. Check repository Secrets write access; private output suppressed.')
    return expected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--keystore', required=True, type=Path)
    parser.add_argument('--repo', default='StQuasimodo/Media-Library')
    arguments = parser.parse_args()
    try:
        digest = upload(arguments.keystore, Path(__file__).resolve().parents[1] / 'android-tv/development-signing.sha256', arguments.repo)
    except (signer.SigningError, OSError, subprocess.SubprocessError) as error:
        print(str(error) if isinstance(error, signer.SigningError) else 'Secret storage failed; private output suppressed.', file=sys.stderr)
        return 1
    print('Pinned TV key saved to GitHub Secrets. Public certificate SHA-256: ' + digest)
    return 0


if __name__ == '__main__':
    sys.exit(main())
