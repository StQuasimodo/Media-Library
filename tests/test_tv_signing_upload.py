import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('tv_upload', Path(__file__).parents[1] / 'scripts/upload-tv-signing-secret.py')
uploader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(uploader)


class UploadTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.key = Path(self.folder.name) / 'key.keystore'
        self.key.write_bytes(b'disposable upload-boundary fixture')
        self.pin = Path(self.folder.name) / 'pin.sha256'
        self.pin.write_text('a' * 64)

    def test_key_body_uses_stdin_not_arguments(self):
        with patch.object(uploader.signer, 'fingerprint', return_value='a' * 64), patch.object(uploader.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as run:
            self.assertEqual(uploader.upload(self.key, self.pin, 'owner/repo'), 'a' * 64)
        args, options = run.call_args
        self.assertEqual(args[0], ['gh', 'secret', 'set', 'TV_DEVELOPMENT_KEYSTORE_BASE64', '--repo', 'owner/repo'])
        self.assertEqual(options['input'], uploader.base64.b64encode(self.key.read_bytes()))
        self.assertTrue(options['capture_output'])

    def test_wrong_identity_never_contacts_github(self):
        with patch.object(uploader.signer, 'fingerprint', return_value='b' * 64), patch.object(uploader.subprocess, 'run') as run:
            with self.assertRaises(uploader.signer.SigningError):
                uploader.upload(self.key, self.pin, 'owner/repo')
        run.assert_not_called()

    def test_github_failure_does_not_echo_private_diagnostics(self):
        with patch.object(uploader.signer, 'fingerprint', return_value='a' * 64), patch.object(uploader.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, b'private-body-fixture', b'private-body-fixture')):
            with self.assertRaises(uploader.signer.SigningError) as error:
                uploader.upload(self.key, self.pin, 'owner/repo')
        self.assertNotIn('private-body-fixture', str(error.exception))
        self.assertEqual(self.pin.read_text(), 'a' * 64)
        self.assertEqual(self.key.read_bytes(), b'disposable upload-boundary fixture')


if __name__ == '__main__':
    unittest.main()
