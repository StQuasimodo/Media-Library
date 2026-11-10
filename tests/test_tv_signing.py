import base64
import hashlib
import importlib.util
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('tv_signer', Path(__file__).parents[1] / 'scripts/prepare-tv-signer.py')
signer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(signer)


class SigningTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = tempfile.TemporaryDirectory()
        cls.path = Path(cls.root.name)
        cls.keys = []
        for n in range(2):
            key = cls.path / f'fixture-{n}.p12'
            subprocess.run(['keytool', '-genkeypair', '-keystore', str(key), '-storetype', 'PKCS12',
                            '-alias', 'androiddebugkey', '-storepass', 'android', '-keypass', 'android',
                            '-keyalg', 'RSA', '-keysize', '2048', '-validity', '2', '-dname', f'CN=Disposable Fixture {n}'],
                           check=True, capture_output=True)
            cls.keys.append(key)
        cls.digest = signer.fingerprint(cls.keys[0])

    @classmethod
    def tearDownClass(cls):
        cls.root.cleanup()

    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.output = Path(self.folder.name) / 'private/key.p12'
        self.pin = Path(self.folder.name) / 'expected.sha256'
        self.pin.write_text(self.digest)
        self.encoded = base64.b64encode(self.keys[0].read_bytes()).decode()

    def test_missing_key_never_generates_a_replacement(self):
        with self.assertRaises(signer.SigningError):
            signer.prepare(self.output, self.pin)
        self.assertFalse(self.output.exists())

    def test_secret_restores_pinned_private_key_with_private_permissions(self):
        digest, source = signer.prepare(self.output, self.pin, self.encoded)
        self.assertEqual((digest, source), (self.digest, 'secret'))
        self.assertEqual(stat.S_IMODE(self.output.stat().st_mode), 0o600)
        self.assertEqual(signer.prepare(self.output, self.pin), (self.digest, 'existing'))

    def test_wrong_secret_keeps_existing_key_and_removes_temporary_file(self):
        signer.prepare(self.output, self.pin, self.encoded)
        before = hashlib.sha256(self.output.read_bytes()).hexdigest()
        wrong = base64.b64encode(self.keys[1].read_bytes()).decode()
        with self.assertRaises(signer.SigningError):
            signer.prepare(self.output, self.pin, wrong)
        self.assertEqual(hashlib.sha256(self.output.read_bytes()).hexdigest(), before)
        self.assertFalse(list(self.output.parent.glob('.tv-signer-*')))

    def test_invalid_base64_is_rejected_without_materializing_a_key(self):
        with self.assertRaises(signer.SigningError):
            signer.prepare(self.output, self.pin, 'not!base64')
        self.assertFalse(self.output.exists())

    def test_wrong_existing_identity_is_rejected(self):
        self.output.parent.mkdir()
        self.output.write_bytes(self.keys[1].read_bytes())
        with self.assertRaises(signer.SigningError):
            signer.prepare(self.output, self.pin)

    def test_public_certificate_alone_cannot_pass_the_private_key_gate(self):
        cert = Path(self.folder.name) / 'public.cer'
        cert.write_bytes(subprocess.run(['keytool', '-exportcert', '-keystore', str(self.keys[0]),
                                        '-alias', 'androiddebugkey', '-storepass', 'android'],
                                       check=True, capture_output=True).stdout)
        public_store = Path(self.folder.name) / 'public-only.p12'
        subprocess.run(['keytool', '-importcert', '-noprompt', '-keystore', str(public_store), '-storetype', 'PKCS12',
                        '-alias', 'androiddebugkey', '-storepass', 'android', '-file', str(cert)], check=True, capture_output=True)
        with self.assertRaises(signer.SigningError):
            signer.prepare(self.output, self.pin, base64.b64encode(public_store.read_bytes()).decode())
        self.assertFalse(self.output.exists())

    def test_caller_fingerprint_mismatch_stops_before_restoring(self):
        with self.assertRaises(signer.SigningError):
            signer.prepare(self.output, self.pin, self.encoded, '0' * 64)
        self.assertFalse(self.output.exists())


if __name__ == '__main__':
    unittest.main()
