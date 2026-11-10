"""Authenticate release metadata with the fixed private signer; publish only public envelopes."""
import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

REPO = 'StQuasimodo/Media-Library'
DOMAIN = b'MY_CINEMA_UPDATE_V1\n'
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('signer', ROOT / 'scripts/prepare-tv-signer.py')
signer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(signer)


def gh(*args):
    return subprocess.check_output(['gh', *args], text=True)


def version(tag):
    value = tag.removeprefix('tv-').removeprefix('v')
    match = re.fullmatch(r'(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?', value)
    if not match:
        raise ValueError('Unsupported release version')
    return (*(int(match[i]) for i in (1, 2, 3)), {'alpha': 0, 'beta': 1, 'rc': 2, None: 3}[match[4]], int(match[5] or 0))


def sign(payload, key):
    expected = (ROOT / 'android-tv/development-signing.sha256').read_text().strip()
    if signer.fingerprint(key) != expected:
        raise ValueError('Private key does not match the pinned certificate')
    public = json.loads((ROOT / 'src/shared/data/update-signing.json').read_text())['certificatePem']
    pem = subprocess.run(['openssl', 'pkcs12', '-in', str(key), '-passin', 'pass:android', '-nodes', '-nocerts'], check=True, capture_output=True).stdout
    body = json.dumps(payload, ensure_ascii=False, separators=(',', ':'), sort_keys=True).encode()
    with tempfile.TemporaryDirectory(prefix='mycinema-update-sign-') as folder:
        root = Path(folder)
        (root / 'payload').write_bytes(DOMAIN + body)
        signature = subprocess.run(['openssl', 'dgst', '-sha256', '-sign', '/dev/stdin', str(root / 'payload')], input=pem, check=True, capture_output=True).stdout
        (root / 'signature').write_bytes(signature)
        pubkey = subprocess.run(['openssl', 'x509', '-pubkey', '-noout'], input=public.encode(), check=True, capture_output=True).stdout
        (root / 'public.pem').write_bytes(pubkey)
        subprocess.run(['openssl', 'dgst', '-sha256', '-verify', str(root / 'public.pem'), '-signature', str(root / 'signature'), str(root / 'payload')], check=True, capture_output=True)
    return {'payload': base64.b64encode(body).decode(), 'signature': base64.b64encode(signature).decode()}


def manifest(release, platform, channel):
    assets = [asset for asset in release['assets'] if asset['name'].endswith('.apk' if platform == 'tv' else '-Setup.exe')]
    if len(assets) != 1:
        raise ValueError('Expected one installable release asset')
    asset = assets[0]
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', asset.get('digest', '')):
        raise ValueError('GitHub asset digest missing')
    tag = release['tag_name']
    result = {'format': 1, 'platform': platform, 'channel': channel, 'version': tag.removeprefix('tv-').removeprefix('v'), 'versionCode': 0, 'minSdk': 0, 'releaseUrl': release['html_url'], 'publishedAt': release['published_at'], 'asset': {'name': asset['name'], 'url': asset['browser_download_url'], 'sha256': asset['digest'][7:], 'bytes': asset['size']}}
    if platform == 'tv':
        source = json.loads(gh('api', f'repos/{REPO}/contents/android-tv/app/build.gradle?ref={tag}'))
        gradle = base64.b64decode(source['content']).decode()
        result.update(versionCode=int(re.search(r'versionCode (\d+)', gradle)[1]), minSdk=int(re.search(r'minSdk (\d+)', gradle)[1]))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--keystore', type=Path, default=Path.home() / '.android/mycinema-tv-debug.keystore')
    parser.add_argument('--publish', action='store_true')
    args = parser.parse_args()
    releases = [r for r in json.loads(gh('api', f'repos/{REPO}/releases?per_page=100')) if not r['draft']]
    results = []
    for platform in ['windows', 'tv']:
        for channel in ['stable', 'preview']:
            candidates = []
            for release in releases:
                if release['tag_name'].startswith('tv-v') != (platform == 'tv') or channel == 'stable' and release['prerelease']:
                    continue
                try:
                    version(release['tag_name'])
                    candidates.append(release)
                except ValueError:
                    pass
            if not candidates:
                continue
            latest = max(candidates, key=lambda r: version(r['tag_name']))
            payload = manifest(latest, platform, channel)
            envelope = sign(payload, args.keystore)
            relative = f'updates/{platform}-{channel}.json'
            path = ROOT / relative
            path.parent.mkdir(exist_ok=True)
            data = (json.dumps(envelope, indent=2) + '\n').encode()
            path.write_bytes(data)
            if args.publish:
                current = json.loads(gh('api', f'repos/{REPO}/contents/{relative}')) if subprocess.run(['gh', 'api', f'repos/{REPO}/contents/{relative}', '--silent'], capture_output=True).returncode == 0 else None
                if current and base64.b64decode(current['content']) == data:
                    continue
                body = {'message': f'chore: publish signed {platform} {channel} update feed', 'content': base64.b64encode(data).decode(), 'branch': 'main'}
                if current:
                    body['sha'] = current['sha']
                with tempfile.NamedTemporaryFile(mode='w', suffix='.json') as file:
                    json.dump(body, file);file.flush()
                    gh('api', '--method', 'PUT', f'repos/{REPO}/contents/{relative}', '--input', file.name)
            results.append({'feed': relative, 'version': payload['version'], 'sha256': payload['asset']['sha256']})
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        raise SystemExit('Update feed preparation failed. Private signing output was suppressed; no replacement key generated.')
