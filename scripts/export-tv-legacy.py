"""Read-only extraction from an installed debuggable TV preview; never installs or clears apps.

Requires Python 3 and adb. The source app is stopped to freeze its files. SQLite recovery
runs only on private temporary copies, including any existing rollback/WAL sidecars.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit

PACKAGE = 'io.mycinema.tv'
MAX_BYTES = 8 * 1024 * 1024
TABLES = ('films', 'entries', 'collections', 'resources', 'members')


class ExportError(Exception):
    pass


def database(path, tables):
    connection = sqlite3.connect(path)
    try:
        if connection.execute('PRAGMA user_version').fetchone()[0] != 1:
            raise ExportError('Unsupported database schema; source left unchanged.')
        if connection.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ExportError('Database copy failed integrity checking.')
        if connection.execute('PRAGMA foreign_key_check').fetchall():
            raise ExportError('Database copy contains broken relationships.')
        names = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not set(tables).issubset(names):
            raise ExportError('Database copy is missing required tables.')
        return connection
    except Exception:
        connection.close()
        raise


def rows(connection, sql):
    values = connection.execute(sql + ' LIMIT 10001').fetchall()
    if len(values) > 10000:
        raise ExportError('Too many records for the portable backup format.')
    return values


def webdav(value):
    parsed = urlsplit(value)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ExportError('Media URL contains unsupported routing or authentication fields.')
    return value


def media_row(raw, film):
    if not isinstance(raw, dict):
        raise ExportError('Invalid media record.')
    source, fid, name, parent = (raw.get(key, '') for key in ('source', 'fileId', 'name', 'parent'))
    if not all(isinstance(value, str) and '\x00' not in value and '\r' not in value and '\n' not in value for value in (source, fid, name, parent)):
        raise ExportError('Invalid media record.')
    if not fid or not name or len(name) > 16384 or len(fid) > 8192 or len(parent) > 8192:
        raise ExportError('Invalid media record.')
    if source == 'quark':
        if max(len(fid), len(parent)) > 1024 or '://' in fid or '://' in parent:
            raise ExportError('Invalid Quark identity.')
    elif source == 'webdav':
        webdav(fid)
        if parent:
            webdav(parent)
    else:
        raise ExportError('Unknown media source.')
    size = raw.get('size')
    if type(size) is not int or size < 0 or not isinstance(film, str) or len(film) > 256:
        raise ExportError('Invalid media size or association.')
    result = {'source': source, 'fileId': fid, 'key': f'{source}:{fid}', 'name': name, 'parent': parent, 'size': size, 'filmId': film}
    if 'associationManual' in raw:
        if type(raw['associationManual']) is not bool:
            raise ExportError('Invalid association flag.')
        result['associationManual'] = raw['associationManual']
    return result


def convert(main_path, media_path=None):
    main = database(main_path, TABLES)
    try:
        collection = {'format': 'my-cinema-tv-backup', 'formatVersion': 1}
        for table in TABLES[:-1]:
            collection[table] = []
            for identity, data in rows(main, f'SELECT id,json FROM {table} ORDER BY rowid'):
                value = json.loads(data)
                if not isinstance(value, dict) or value.get('id') != identity:
                    raise ExportError('Invalid collection record.')
                collection[table].append(value)
        collection['members'] = [{'collectionId': group, 'filmId': film} for group, film in rows(main, 'SELECT collection_id,film_id FROM members ORDER BY rowid')]
    finally:
        main.close()
    catalog = {'files': [], 'progress': []}
    if media_path is not None:
        media = database(media_path, ('files', 'progress'))
        try:
            identities = set()
            for identity, data, film in rows(media, 'SELECT id,json,film_id FROM files ORDER BY id'):
                value = media_row(json.loads(data), film)
                if identity != value['key'] or identity in identities:
                    raise ExportError('Invalid media identity.')
                identities.add(identity)
                catalog['files'].append(value)
            for identity, position, duration in rows(media, 'SELECT id,position,duration FROM progress ORDER BY id'):
                if identity not in identities or type(position) is not int or type(duration) is not int or min(position, duration) < 0:
                    raise ExportError('Invalid playback progress.')
                catalog['progress'].append({'key': identity, 'position': position, 'duration': duration})
        finally:
            media.close()
    return {'format': 'my-cinema-tv-backup', 'formatVersion': 2, 'collection': collection, 'media': catalog}


def adb(serial, *arguments, **kwargs):
    result = subprocess.run(['adb', '-s', serial, *arguments], stderr=subprocess.PIPE, timeout=30, **kwargs)
    if result.returncode:
        raise ExportError('ADB operation failed. Check the selected device, authorization and debuggable preview; no app data was cleared.')
    return result


def capture(serial, destination):
    adb(serial, 'exec-out', 'run-as', PACKAGE, 'id', stdout=subprocess.PIPE)
    adb(serial, 'shell', 'am', 'force-stop', PACKAGE, stdout=subprocess.PIPE)
    listing = adb(serial, 'exec-out', 'run-as', PACKAGE, 'ls', 'databases', stdout=subprocess.PIPE).stdout.decode().split()
    if 'my-cinema-tv.db' not in listing:
        raise ExportError('Collection database not found. Open the old app first; no data was cleared.')
    media = 'media-sources.db' in listing
    for base in ['my-cinema-tv.db'] + (['media-sources.db'] if media else []):
        for name in [base, base + '-journal', base + '-wal', base + '-shm']:
            if name not in listing:
                continue
            path = destination / name
            with open(path, 'xb') as output:
                os.chmod(path, 0o600)
                adb(serial, 'exec-out', 'run-as', PACKAGE, 'cat', 'databases/' + name, stdout=output)
            if path.stat().st_size > 128 * 1024 * 1024:
                raise ExportError('Database copy is too large for this tool.')
    return destination / 'my-cinema-tv.db', destination / 'media-sources.db' if media else None


def export_device(serial, output):
    manifest = output.with_suffix(output.suffix + '.manifest.json')
    if output.exists() or manifest.exists():
        raise ExportError('Output already exists. Choose a new filename; existing backups are never overwritten.')
    with tempfile.TemporaryDirectory(prefix='mycinema-tv-export-') as directory:
        main, media = capture(serial, Path(directory))
        value = convert(main, media)
        data = json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        if len(data) > MAX_BYTES:
            raise ExportError('Portable backup exceeds 8 MiB; source data is unchanged.')
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
    except Exception:
        output.unlink(missing_ok=True)
        raise
    report = {'formatVersion': 2, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data),
              'filmCount': len(value['collection']['films']), 'mediaCount': len(value['media']['files']),
              'progressCount': len(value['media']['progress']), 'sourcePackage': PACKAGE,
              'sourceUninstalled': False, 'sourceDataCleared': False, 'credentialsExported': False}
    with open(manifest, 'x', encoding='utf-8') as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--serial', required=True, help='Explicit adb device serial; never selects an arbitrary device')
    parser.add_argument('--output', required=True, type=Path, help='New private JSON backup filename')
    args = parser.parse_args()
    try:
        report = export_device(args.serial, args.output)
    except (ExportError, OSError, sqlite3.Error, ValueError, subprocess.SubprocessError):
        print('Export did not complete. Check ADB, schema, output path and storage; the original app was not uninstalled or cleared.', file=sys.stderr)
        return 1
    print(f'Export verified: {report["filmCount"]} films, {report["mediaCount"]} media records. SHA-256 {report["sha256"]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
