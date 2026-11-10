import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('tv_export', Path(__file__).parents[1] / 'scripts/export-tv-legacy.py')
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


class LegacyExportTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.main = Path(self.folder.name) / 'main.db'
        self.media = Path(self.folder.name) / 'media.db'
        with sqlite3.connect(self.main) as db:
            db.executescript('''PRAGMA user_version=1;
                CREATE TABLE films(id TEXT PRIMARY KEY,json TEXT);
                CREATE TABLE entries(id TEXT PRIMARY KEY,film_id TEXT REFERENCES films(id),json TEXT);
                CREATE TABLE collections(id TEXT PRIMARY KEY,json TEXT);
                CREATE TABLE resources(id TEXT PRIMARY KEY,film_id TEXT REFERENCES films(id),json TEXT);
                CREATE TABLE members(collection_id TEXT REFERENCES collections(id),film_id TEXT REFERENCES films(id));''')
            db.execute('INSERT INTO films VALUES(?,?)', ('film', json.dumps({'id': 'film', 'title': 'Migration Movie', 'mediaType': 'movie'})))
            db.execute('INSERT INTO entries VALUES(?,?,?)', ('entry', 'film', json.dumps({'id': 'entry', 'filmId': 'film', 'watchStatus': 'want', 'personalRating': 9})))
        with sqlite3.connect(self.media) as db:
            db.executescript('''PRAGMA user_version=1;CREATE TABLE files(id TEXT PRIMARY KEY,json TEXT,film_id TEXT);CREATE TABLE progress(id TEXT PRIMARY KEY,position INTEGER,duration INTEGER);''')
            row = {'source': 'quark', 'fileId': 'fid', 'name': 'Movie.mkv', 'parent': '0', 'size': 10,
                   'associationManual': True, 'headers': {'Cookie': 'not-exported'}, 'downloadUrl': 'https://cdn.test/?token=not-exported'}
            db.execute('INSERT INTO files VALUES(?,?,?)', ('quark:fid', json.dumps(row), 'film'))
            db.execute('INSERT INTO progress VALUES(?,?,?)', ('quark:fid', 45000, 120000))

    def test_old_collection_only_database_converts_to_unified_backup(self):
        result = exporter.convert(self.main)
        self.assertEqual(result['formatVersion'], 2)
        self.assertEqual(result['collection']['entries'][0]['personalRating'], 9)
        self.assertEqual(result['media'], {'files': [], 'progress': []})

    def test_media_identity_manual_link_and_progress_survive_without_headers(self):
        result = exporter.convert(self.main, self.media)
        self.assertEqual(result['media']['files'][0]['filmId'], 'film')
        self.assertTrue(result['media']['files'][0]['associationManual'])
        self.assertEqual(result['media']['progress'][0]['position'], 45000)
        self.assertNotIn('not-exported', json.dumps(result))

    def test_unknown_schema_is_rejected(self):
        with sqlite3.connect(self.main) as db:
            db.execute('PRAGMA user_version=99')
        with self.assertRaises(exporter.ExportError):
            exporter.convert(self.main)

    def test_broken_foreign_key_is_rejected(self):
        with sqlite3.connect(self.main) as db:
            db.execute("UPDATE entries SET film_id='missing'")
        with self.assertRaises(exporter.ExportError):
            exporter.convert(self.main)

    def test_mismatched_json_record_identity_is_rejected(self):
        with sqlite3.connect(self.main) as db:
            db.execute("UPDATE films SET json=?", (json.dumps({'id': 'other', 'title': 'Wrong'}),))
        with self.assertRaises(exporter.ExportError):
            exporter.convert(self.main)

    def test_orphan_progress_is_rejected(self):
        with sqlite3.connect(self.media) as db:
            db.execute("UPDATE progress SET id='quark:missing'")
        with self.assertRaises(exporter.ExportError):
            exporter.convert(self.main, self.media)

    def test_authenticated_webdav_url_is_not_exported(self):
        with self.assertRaises(exporter.ExportError):
            exporter.media_row({'source': 'webdav', 'fileId': 'https://user:password@example.test/movie', 'name': 'Movie', 'size': 1}, '')

    def test_existing_output_is_never_overwritten_or_contacts_adb(self):
        path = Path(self.folder.name) / 'backup.json'
        path.write_text('existing backup')
        with self.assertRaises(exporter.ExportError):
            exporter.export_device('no-device-may-be-contacted', path)
        self.assertEqual(path.read_text(), 'existing backup')


if __name__ == '__main__':
    unittest.main()
