"""Disposable emulator-only HTTPS TMDB fixture. Never packaged in the application."""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import re
from pathlib import Path
import ssl
import struct
import subprocess
import threading
import time
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
    ext.write_text('subjectAltName=DNS:api.tmdb.org,DNS:api.themoviedb.org,DNS:image.tmdb.org,DNS:drive-pc.quark.cn\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n')
    subprocess.run(['openssl', 'x509', '-req', '-in', str(root / 'server.csr'), '-CA', str(root / 'ca.pem'), '-CAkey', str(root / 'ca.key'), '-CAcreateserial', '-days', '2', '-sha256', '-extfile', str(ext), '-out', str(root / 'server.pem')], check=True, capture_output=True)
    for name in ['ca.key', 'server.key']:
        (root / name).chmod(0o600)
    subject_hash = subprocess.check_output(['openssl', 'x509', '-subject_hash_old', '-in', str(root / 'ca.pem'), '-noout'], text=True).strip()
    (root / 'ca-name.txt').write_text(subject_hash + '.0')


def serve(root, log):
    state = {'mode': 'normal', 'requests': 0, 'downloads': 0, 'ranges': 0, 'mediaRequests': 0,
             'fault': 'none', 'drops': 0, 'expiredLease': -1, 'expiredReplies': 0,
             'pendingDownloads': 0, 'quarkGets': 0, 'unboundedQuarkGets': 0, 'maxQuarkRangeBytes': 0,
             'slowListStarts': 0, 'slowDavStarts': 0}
    lock = threading.Lock()
    expired_pair = threading.Barrier(2)
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

        def do_PROPFIND(self):
            path=urlparse(self.path).path
            if (path == '/public-dav/' and self.headers.get('Authorization')) or (path != '/public-dav/' and self.headers.get('Authorization') != 'Basic dHYtdGVzdDpmaXh0dXJl'):
                self.reply({},401)
                return
            if path not in ['/dav/', '/bad-dav/', '/public-dav/']:
                self.reply({},404)
                return
            with lock:
                slow = state['fault'] == 'slow_dav'
                if slow: state['slowDavStarts'] += 1
            if slow: time.sleep(10)
            href='https://example.invalid/stolen.mp4' if path == '/bad-dav/' else path+'Breaking.Bad.S02E01.1080p.WEB-DL.H264.AAC.mp4'
            xml=('<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>'+href+'</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>1024</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>').encode()
            self.send_response(207)
            self.send_header('Content-Type','application/xml; charset=utf-8')
            self.send_header('Content-Length',str(len(xml)))
            self.end_headers()
            self.wfile.write(xml)

        def do_POST(self):
            if urlparse(self.path).path == '/1/clouddrive/file/v2/play/project':
                if '__puus=tv-playback-fixture' not in self.headers.get('Cookie',''):
                    self.reply({},401)
                    return
                body=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))))
                if body.get('fid') != 'movie-file' or body.get('supports') != 'fmp4_av,m3u8':
                    self.reply({},400)
                    return
                with lock:
                    state['cloudQueries']=state.get('cloudQueries',0)+1
                    state['cloudLeases']=state.get('cloudLeases',0)+1
                    cloud_lease=state['cloudLeases']
                    cloud=state.get('cloudMode','normal')
                if cloud=='denied':
                    self.reply({'status':403,'code':403,'message':'fixture entitlement refusal'})
                    return
                if cloud=='empty':
                    self.reply({'status':200,'code':0,'data':{'video_list':[]}})
                    return
                def version(res,fmt,w,h,**flags):
                    return {'resolution':res,'video_info':{'format':fmt,'width':w,'height':h,'codec':'h264','fps':24,'bitrate':3500000,'audio':{'codec':'aac','channels':2},'url':'https://drive-pc.quark.cn/cloud/'+('master.m3u8' if fmt=='m3u8' else 'video.mp4')+'?token=cloud-fixture-private&Signature='+str(cloud_lease)+'&Expires='+str(int(time.time())+3600),'success':True,'finish':True,**flags}}
                rows=[version('4k','m3u8',1920,1080),version('high','fmp4_av',1280,720),version('2k','m3u8',2560,1440,finish=False),{**version('super','mp4',1920,1080),'accessable':False}]
                self.reply({'status':200,'code':0,'data':{'video_list':rows}})
                return
            if urlparse(self.path).path == '/1/clouddrive/file/download':
                if '__puus=tv-playback-fixture' not in self.headers.get('Cookie',''):
                    self.reply({},401)
                    return
                body=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))))
                if body.get('fids') != ['movie-file']:
                    self.reply({},400)
                    return
                with lock:
                    state['downloads']+=1
                    number=state['downloads']
                    slow=state['fault']=='slow_download'
                    if slow:state['pendingDownloads']+=1
                if slow:
                    try:time.sleep(10)
                    finally:
                        with lock:state['pendingDownloads']-=1
                filename='expired.mp4' if number == 1 else 'movie.mp4'
                self.reply({'status':200,'code':0,'data':[{'download_url':'https://drive-pc.quark.cn/stream/'+filename+'?lease='+str(number)}]})
            else:
                self.reply({},404)

        def cloud_media(self, uri, head=False):
            query=parse_qs(uri.query)
            try:signature=int(query.get('Signature',['-1'])[0])
            except ValueError:signature=-1
            with lock:
                state['cloudGets']=state.get('cloudGets',0)+1
                expired=signature==state.get('expiredCloudLease',-2)
                if expired:state['cloudExpiredReplies']=state.get('cloudExpiredReplies',0)+1
            if self.headers.get('Authorization') or '__puus=tv-playback-fixture' not in self.headers.get('Cookie','') or self.headers.get('Referer')!='https://pan.quark.cn/' or not self.headers.get('User-Agent'):
                with lock:state['cloudHeaderErrors']=state.get('cloudHeaderErrors',0)+1
                self.reply({},401)
                return
            if signature<0 or expired:
                self.reply({},403)
                return
            filename=uri.path[len('/cloud/'):]
            if '/' in filename or filename in ('','..'):
                self.reply({},404)
                return
            resource_fault=state.get('cloudResourceFault','normal')
            if filename=='init.mp4' and resource_fault=='redirect':
                self.send_response(302);self.send_header('Location','https://example.invalid/forbidden.mp4');self.send_header('Content-Length','0');self.end_headers();return
            suffix='?Signature='+str(signature)+'&Expires='+str(int(time.time())+3600)
            if filename=='master.m3u8':
                body=('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1920x1080,CODECS="avc1.42c028,mp4a.40.2"\nmedia.m3u8'+suffix+'\n').encode()
            elif filename=='media.m3u8':
                text=(root/'cloud/media.m3u8').read_text()
                lines=[]
                for line in text.splitlines():
                    if 'URI="init.mp4"' in line:line=line.replace('URI="init.mp4"','URI="init.mp4'+suffix+'"')
                    elif line and not line.startswith('#'):line+=suffix
                    lines.append(line)
                body=('\n'.join(lines)+'\n').encode()
            else:
                file=root/'cloud'/filename
                if not file.is_file() or file.suffix not in ('.mp4','.m4s'):
                    self.reply({},404)
                    return
                body=file.read_bytes()
                if filename=='init.mp4' and resource_fault=='disguised':body=b'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://example.invalid/forbidden.mp4\n'
            if filename.endswith('.m3u8'):
                if filename=='media.m3u8' and state.get('cloudShape','normal')=='changed':body=body.replace(b'#EXTINF:',b'#EXT-X-DISCONTINUITY\n#EXTINF:',1)
                self.send_response(200);self.send_header('Content-Type','application/vnd.apple.mpegurl');self.send_header('Content-Length',str(len(body)));self.end_headers()
                if not head:self.wfile.write(body)
                return
            start,end=0,len(body)-1;status=200
            range_value=self.headers.get('Range')
            if range_value:
                match=re.fullmatch(r'bytes=(\d*)-(\d*)',range_value)
                if not match or not any(match.groups()):self.reply({},416);return
                if not match[1]:start=max(0,len(body)-int(match[2]))
                else:start=int(match[1]);end=min(end,int(match[2])) if match[2] else end
                if start>=len(body) or end<start:self.reply({},416);return
                status=206
            with lock:state['cloudBinaryGets']=state.get('cloudBinaryGets',0)+1
            self.send_response(status);self.send_header('Content-Type','video/mp4');self.send_header('Content-Length',str(end-start+1));self.send_header('Accept-Ranges','bytes');self.send_header('ETag','"cloud-static-v1"')
            if status==206:self.send_header('Content-Range','bytes '+str(start)+'-'+str(end)+'/'+str(len(body)))
            self.end_headers()
            if not head:
                try:self.wfile.write(body[start:end+1])
                except (BrokenPipeError,ConnectionResetError,ssl.SSLEOFError):pass

        def do_HEAD(self):
            self.do_GET()

        def media(self,uri):
            if uri.path.startswith('/dav/') and self.headers.get('Authorization') != 'Basic dHYtdGVzdDpmaXh0dXJl':
                self.reply({},401)
                return
            if uri.path.startswith('/stream/') and '__puus=tv-playback-fixture' not in self.headers.get('Cookie',''):
                self.reply({},401)
                return
            if uri.path.endswith('/expired.mp4'):
                self.reply({},403)
                return
            lease=int(parse_qs(uri.query).get('lease',['0'])[0])
            with lock:
                expired=lease>0 and lease==state['expiredLease']
            if expired:
                with lock:
                    state['expiredReplies']+=1
                    paired=state['fault']=='expire_concurrent'
                if paired:
                    try:expired_pair.wait(timeout=5)
                    except threading.BrokenBarrierError:pass
                self.reply({},403)
                return
            video=root/'sample.mp4'
            size=video.stat().st_size
            start,end=0,size-1
            ranged=self.headers.get('Range','')
            if ranged:
                import re
                match=re.fullmatch(r'bytes=(\d+)-(\d*)',ranged)
                if not match:
                    self.reply({},416)
                    return
                start=int(match[1]);end=min(int(match[2]) if match[2] else end,end)
                if start>end:
                    self.send_response(416);self.send_header('Content-Range',f'bytes */{size}');self.send_header('Content-Length','0');self.end_headers();return
            with lock:
                quark_stream=uri.path.startswith('/stream/')
                fault=state['fault'] if quark_stream else 'none'
                if quark_stream and self.command=='GET':
                    state['quarkGets']+=1
                    bounded=bool(ranged and ranged.rsplit('-',1)[1])
                    if not bounded:state['unboundedQuarkGets']+=1
                    if bounded:state['maxQuarkRangeBytes']=max(state['maxQuarkRangeBytes'],end-start+1)
                reject=fault=='bounded_only' and (self.command=='HEAD' or not ranged or not ranged.rsplit('-',1)[1] or end-start+1>4*1024*1024)
            if reject:
                self.reply({},405 if self.command=='HEAD' else 429)
                return
            with lock:
                state['mediaRequests']+=1
                if ranged:state['ranges']+=1
                fault=state['fault'] if uri.path.startswith('/stream/') else 'none'
                drop=self.command!='HEAD' and (fault=='drop_always' or (fault in ['drop_expire','bad_resume'] and state['drops']==0))
                if drop:
                    state['drops']+=1
                    if fault=='drop_expire':state['expiredLease']=lease
                bad_resume=fault=='bad_resume' and state['drops']>0 and not drop
            if bad_resume:
                start,end,ranged=0,size-1,''
            self.send_response(206 if ranged else 200)
            self.send_header('Content-Type','video/mp4')
            self.send_header('Accept-Ranges','bytes')
            self.send_header('ETag','"my-cinema-fixture-v1"')
            self.send_header('Content-Length',str(end-start+1))
            if ranged:self.send_header('Content-Range',f"bytes {start+1 if fault=='wrong_initial' else start}-{end}/{size}")
            self.end_headers()
            if self.command == 'HEAD':return
            try:
                with video.open('rb') as stream:
                    stream.seek(start)
                    remaining=end-start+1
                    while remaining>0:
                        chunk=stream.read(min(4096 if drop else 65536,remaining))
                        if not chunk:break
                        self.wfile.write(chunk);remaining-=len(chunk)
                        if drop:
                            self.wfile.flush()
                            self.close_connection=True
                            return
            except (BrokenPipeError,ConnectionResetError,ssl.SSLEOFError):pass

        def do_GET(self):
            uri = urlparse(self.path)
            query = parse_qs(uri.query)
            if self.server.server_port == 8765:
                if uri.path == '/control':
                    cloud=query.get('cloud',[state.get('cloudMode','normal')])[0]
                    if cloud not in ['normal','empty','denied']:
                        self.reply({'error':'invalid cloud fixture mode'},400)
                        return
                    shape=query.get('cloudShape',[state.get('cloudShape','normal')])[0]
                    resource=query.get('cloudResource',[state.get('cloudResourceFault','normal')])[0]
                    if shape not in ['normal','changed'] or resource not in ['normal','disguised','redirect']:
                        self.reply({},400);return
                    state['cloudShape']=shape;state['cloudResourceFault']=resource
                    state['cloudMode']=cloud
                    mode = query.get('mode', [state['mode']])[0]
                    fault=query.get('fault',['none'])[0]
                    if mode not in ['normal', 'offline', 'season3', 'rate_limit', 'images_fail', 'bridge_tree'] or fault not in ['none','drop_expire','drop_always','bad_resume','bounded_only','expire_concurrent','slow_download','wrong_initial','slow_list','slow_dav','cloud_expire']:
                        self.reply({'error': 'invalid fixture mode'}, 400)
                        return
                    with lock:
                        state['mode'] = mode
                        state['fault']=fault
                        state['drops']=0
                        state['expiredLease']=state['downloads'] if fault=='expire_concurrent' else -1
                        state['expiredReplies']=0
                        state['expiredCloudLease']=state.get('cloudLeases',-1) if fault=='cloud_expire' else -2
                        state['cloudExpiredReplies']=0
                        state['quarkGets']=0
                        state['unboundedQuarkGets']=0
                        state['maxQuarkRangeBytes']=0
                        if fault=='expire_concurrent':expired_pair.reset()
                self.reply(dict(state))
                return
            if uri.path.startswith('/cloud/'):
                self.cloud_media(uri, self.command=='HEAD')
                return
            if uri.path.startswith('/stream/') or uri.path.startswith('/dav/') or uri.path.startswith('/public-dav/'):
                self.media(uri)
                return
            if uri.path == '/1/clouddrive/file/sort':
                if '__puus=tv-playback-fixture' not in self.headers.get('Cookie',''):
                    self.reply({},401)
                else:
                    parent=query.get('pdir_fid',['0'])[0]
                    with lock:
                        slow = state['fault'] == 'slow_list'
                        if slow: state['slowListStarts'] += 1
                    if slow: time.sleep(10)
                    rows=[{'fid':'movie-file','file_name':'Breaking.Bad.S02E01.1080p.WEB-DL.H264.AAC.mp4','file':True,'size':(root/'sample.mp4').stat().st_size}]
                    if state['mode']=='bridge_tree':
                        if parent=='0':rows=[{'fid':'tv-root','file_name':'影视 & 中文','file':False},{'fid':'outside','file_name':'不在挂载范围','file':False}]
                        elif parent=='tv-root':rows=[{'fid':'season2','file_name':'第2季 #目录','file':False}]
                        elif parent=='season2':rows=[{'fid':'movie-file','file_name':'Breaking.Bad.S02E01.1080p.H264.AAC.中文 & #测试.mp4','file':True,'size':(root/'sample.mp4').stat().st_size}]
                        else:rows=[]
                    self.reply({'status':200,'code':0,'data':{'list':rows},'metadata':{'_total':len(rows)}})
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
                    self.reply(png(color, 320, 180) if ('still' in uri.path or 'promo' in uri.path) else png(color))
                return
            if mode == 'rate_limit':
                self.reply({}, 429)
                return
            if not query.get('api_key', [''])[0].startswith('tv-fixture-'):
                self.reply({'status_code': 7}, 401)
                return
            series = {'id': 1396, 'credits': {'cast': [], 'crew': []}, 'created_by': [], 'keywords': {'keywords': []}, 'name': '绝命毒师', 'original_name': 'Breaking Bad', 'first_air_date': '2008-01-20', 'overview': '受控整剧简介', 'poster_path': '/whole-poster.png', 'backdrop_path': '/whole-still.png', 'genres': [{'name': '剧情'}], 'seasons': [
                {'season_number': n, 'name': f'第{n}季', 'air_date': f'{2007+n}-01-20', 'episode_count': 7 if n == 1 else 13, 'overview': f'受控第{n}季简介'} for n in [1, 2, 3]]}
            movie = {'id': 603, 'credits': {'cast': [], 'crew': []}, 'created_by': [], 'keywords': {'keywords': []}, 'title': '黑客帝国', 'original_title': 'The Matrix', 'release_date': '1999-03-31', 'overview': '受控电影简介', 'runtime': 136, 'poster_path': '/movie-poster.png', 'backdrop_path': '/movie-still.png', 'genres': [{'name': '科幻'}]}
            if path.endswith('/images'):
                base = path.removesuffix('/images')
                n = int(base.rsplit('/', 1)[1]) if '/season/' in base else None
                poster = f'/s{n}-poster.png' if n is not None else '/movie-poster.png' if base.startswith('/movie/') else '/whole-poster.png'
                self.reply({'posters': [
                    {'file_path': '/traditional-poster.png', 'iso_639_1': 'zh', 'width': 1000, 'height': 1500},
                    {'file_path': poster, 'iso_639_1': 'en', 'width': 1000, 'height': 1500}],
                    **({} if n is not None else {'backdrops': [{'file_path': f'/s{i}-promo.png', 'iso_639_1': 'en', 'width': 1920, 'height': 1080} for i in [1, 2, 3]]})})
            elif path == '/configuration':
                self.reply({'images': {'secure_base_url': 'https://image.tmdb.org/t/p/'}})
            elif path in ('/tv/60574', '/movie/900001'):
                is_tv = path.startswith('/tv/')
                self.reply({'id': 60574 if is_tv else 900001, **({'name': '浴血黑帮', 'original_name': 'Peaky Blinders'} if is_tv else {'title': '浴血黑帮：不朽之人', 'original_title': 'Peaky Blinders: The Immortal Man'}), 'overview': '受控跨媒体关联资料', 'created_by': [{'id': 31}] if is_tv else [], 'credits': {'cast': [{'id': i} for i in (11, 12, 13)], 'crew': [{'id': 31, 'job': 'Writer'}]}, 'keywords': {'keywords': [{'name': 'based on television series'}]}})
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
