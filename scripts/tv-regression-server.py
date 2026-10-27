"""Disposable emulator-only HTTPS TMDB fixture. Never packaged in the application."""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import ssl
import struct
import subprocess
import threading
from urllib.parse import parse_qs, urlparse
import zlib


def png(color, width=160, height=240):
    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data) & 0xffffffff)
    rows = b''.join(b'\0' + bytes(color) * width for _ in range(height))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!IIBBBBB', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')


def prepare(root):
    root.mkdir(parents=True, exist_ok=True)
    commands = [
        ['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '2', '-subj', '/CN=MyCinema disposable emulator fixture CA', '-keyout', str(root / 'ca.key'), '-out', str(root / 'ca.pem')],
        ['openssl', 'req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=api.tmdb.org', '-keyout', str(root / 'server.key'), '-out', str(root / 'server.csr')],
    ]
    for command in commands:
        subprocess.run(command, check=True, capture_output=True)
    ext = root / 'extensions.cnf'
    ext.write_text('subjectAltName=DNS:api.tmdb.org,DNS:api.themoviedb.org,DNS:image.tmdb.org\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n')
    subprocess.run(['openssl', 'x509', '-req', '-in', str(root / 'server.csr'), '-CA', str(root / 'ca.pem'), '-CAkey', str(root / 'ca.key'), '-CAcreateserial', '-days', '2', '-sha256', '-extfile', str(ext), '-out', str(root / 'server.pem')], check=True, capture_output=True)
    for name in ['ca.key', 'server.key']:
        (root / name).chmod(0o600)
    subject_hash = subprocess.check_output(['openssl', 'x509', '-subject_hash_old', '-in', str(root / 'ca.pem'), '-noout'], text=True).strip()
    (root / 'ca-name.txt').write_text(subject_hash + '.0')


def serve(root, log):
    state = {'mode': 'normal', 'requests': 0}
    lock = threading.Lock()
    log.parent.mkdir(parents=True, exist_ok=True)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass  # Do not log query strings or authorization headers.

        def reply(self, payload, status=200):
            body = payload if isinstance(payload, bytes) else json.dumps(payload, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'image/png' if isinstance(payload, bytes) else 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            uri = urlparse(self.path)
            query = parse_qs(uri.query)
            if self.server.server_port == 8765:
                if uri.path == '/control':
                    mode = query.get('mode', ['normal'])[0]
                    if mode not in ['normal', 'offline', 'season3', 'rate_limit', 'images_fail']:
                        self.reply({'error': 'invalid fixture mode'}, 400)
                        return
                    with lock:
                        state['mode'] = mode
                self.reply(dict(state))
                return
            path = uri.path.removeprefix('/3')
            with lock:
                state['requests'] += 1
                mode = state['mode']
                with log.open('a') as output:
                    output.write(json.dumps({'path': path, 'mode': mode}) + '\n')
            if mode == 'offline':
                self.reply({}, 503)
                return
            if uri.path.startswith('/t/p/'):
                if mode == 'images_fail':
                    self.reply({}, 503)
                else:
                    season = 2 if 's2' in uri.path else 3 if 's3' in uri.path else 1
                    color = [(35, 75, 120), (150, 85, 35), (55, 110, 75)][season - 1]
                    self.reply(png(color, 320, 180) if 'still' in uri.path else png(color))
                return
            if mode == 'rate_limit':
                self.reply({}, 429)
                return
            if not query.get('api_key', [''])[0].startswith('tv-fixture-'):
                self.reply({'status_code': 7}, 401)
                return
            series = {'id': 1396, 'name': '绝命毒师', 'original_name': 'Breaking Bad', 'first_air_date': '2008-01-20', 'overview': '受控整剧简介', 'poster_path': '/whole-poster.png', 'backdrop_path': '/whole-still.png', 'genres': [{'name': '剧情'}], 'seasons': [
                {'season_number': n, 'name': f'第{n}季', 'air_date': f'{2007+n}-01-20', 'episode_count': 7 if n == 1 else 13, 'overview': f'受控第{n}季简介'} for n in [1, 2, 3]]}
            movie = {'id': 603, 'title': '黑客帝国', 'original_title': 'The Matrix', 'release_date': '1999-03-31', 'overview': '受控电影简介', 'runtime': 136, 'poster_path': '/movie-poster.png', 'backdrop_path': '/movie-still.png', 'genres': [{'name': '科幻'}]}
            if path == '/configuration':
                self.reply({'images': {'secure_base_url': 'https://image.tmdb.org/t/p/'}})
            elif path == '/search/tv':
                self.reply({'results': [series] if query.get('query', [''])[0].lower() in ['breaking bad', '绝命毒师'] else []})
            elif path == '/search/movie':
                self.reply({'results': [movie] if query.get('query', [''])[0].lower() in ['matrix', '黑客帝国'] else []})
            elif path == '/tv/1396':
                self.reply(series)
            elif path.startswith('/tv/1396/season/'):
                n = int(path.rsplit('/', 1)[1])
                if mode == 'season3' and n == 3:
                    self.reply({}, 503)
                else:
                    self.reply({'season_number': n, 'air_date': f'{2007+n}-01-20', 'overview': f'独立第{n}季资料', 'poster_path': f'/s{n}-poster.png', 'episodes': [{'runtime': 48, 'still_path': f'/s{n}-still.png'}]})
            elif path == '/movie/603':
                self.reply(movie)
            else:
                self.reply({}, 404)

    control = ThreadingHTTPServer(('0.0.0.0', 8765), Handler)
    threading.Thread(target=control.serve_forever, daemon=True).start()
    server = ThreadingHTTPServer(('0.0.0.0', 443), Handler)
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.minimum_version = ssl.TLSVersion.TLSv1_2
    tls.load_cert_chain(root / 'server.pem', root / 'server.key')
    server.socket = tls.wrap_socket(server.socket, server_side=True)
    server.serve_forever()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['prepare', 'serve'])
    parser.add_argument('--private-dir', type=Path, default=Path('.harness/tv-fixture-private'))
    parser.add_argument('--log', type=Path, default=Path('.harness/tv-regression/fixture.jsonl'))
    args = parser.parse_args()
    prepare(args.private_dir) if args.operation == 'prepare' else serve(args.private_dir, args.log)
