"""Restore only the pinned TV signer. Private bytes never enter output or Actions artifacts."""
import base64
import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile


class SigningError(Exception):
    pass


def fingerprint(path):
    try:
        private = subprocess.run(['keytool', '-J-Duser.language=en', '-J-Duser.country=US', '-list', '-v',
                                  '-keystore', str(path), '-alias', 'androiddebugkey', '-storepass', 'android'],
                                 capture_output=True, timeout=20)
        if private.returncode or b'PrivateKeyEntry' not in private.stdout:
            raise SigningError('Signing material must contain the original private key, not just its public certificate.')
        result = subprocess.run(['keytool', '-exportcert', '-keystore', str(path), '-alias', 'androiddebugkey',
                                 '-storepass', 'android'], capture_output=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired):
        raise SigningError('Cannot inspect the Android signing key.') from None
    if result.returncode or not result.stdout:
        raise SigningError('Signing key is unreadable or has an unexpected alias/password.')
    return hashlib.sha256(result.stdout).hexdigest()


def prepare(path, expected_file, encoded='', required_fingerprint=''):
    expected = expected_file.read_text().strip()
    if not re.fullmatch(r'[a-f0-9]{64}', expected):
        raise SigningError('Pinned certificate fingerprint is invalid.')
    if required_fingerprint and required_fingerprint != expected:
        raise SigningError('Caller and repository certificate fingerprints disagree.')
    source = 'existing'
    if encoded:
        if len(encoded) > 1024 * 1024:
            raise SigningError('Signing secret is too large.')
        try:
            raw = base64.b64decode(''.join(encoded.split()), validate=True)
        except (ValueError, base64.binascii.Error):
            raise SigningError('Signing secret is not valid base64.') from None
        if not raw or len(raw) > 256 * 1024:
            raise SigningError('Signing secret size is invalid.')
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.tv-signer-', delete=False) as output:
                temporary = Path(output.name)
                os.chmod(temporary, 0o600)
                output.write(raw)
            if fingerprint(temporary) != expected:
                raise SigningError('Signing secret does not match the published certificate; replacement refused.')
            os.replace(temporary, path)
            source = 'secret'
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    if not path.is_file():
        raise SigningError('Pinned signing key is missing. Restore TV_DEVELOPMENT_KEYSTORE_BASE64; no replacement key was generated.')
    if fingerprint(path) != expected:
        raise SigningError('Signing key does not match the published certificate; replacement refused.')
    os.chmod(path, 0o600)
    return expected, source


def main():
    try:
        digest, source = prepare(Path.home() / '.android/mycinema-tv-debug.keystore',
                                 Path('android-tv/development-signing.sha256'),
                                 os.environ.get('TV_DEVELOPMENT_KEYSTORE_BASE64', ''),
                                 os.environ.get('TV_EXPECTED_SIGNER', ''))
    except (SigningError, OSError):
        # Constant diagnostic categories only. Never echo secret values or keytool output.
        print('Pinned TV signer unavailable or invalid. Restore the pinned key from protected storage; generating a replacement is refused.', file=sys.stderr)
        return 1
    print(f'Development certificate SHA-256: {digest}')
    print(f'Signing material source: {source}')
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write(f'sha256={digest}\nsource={source}\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
