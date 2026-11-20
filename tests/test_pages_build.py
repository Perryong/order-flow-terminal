import tempfile
import unittest
from pathlib import Path
from scripts.build_pages import build

class PagesBuildTest(unittest.TestCase):
    def test_only_static_files_and_https_configuration_are_published(self):
        with tempfile.TemporaryDirectory() as directory:
            output=build(directory, 'https://mac.example.test/')
            self.assertIn('https://mac.example.test', (output/'config.js').read_text())
            self.assertTrue((output/'profile-confirmation.js').exists())
            self.assertTrue((output/'.nojekyll').exists())
            for path in ('server.py','.env','.git','alerts','providers','tests'):
                self.assertFalse((output/path).exists())
            for name in ('index.html','swing.html'):
                text=(output/name).read_text()
                self.assertNotIn('href="/',text)
                self.assertNotIn('src="/',text)

    def test_nonempty_destination_cannot_publish_unintended_leftovers(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory)/'private.txt').write_text('test fixture')
            with self.assertRaises(ValueError):
                build(directory)

    def test_credentials_and_unencrypted_origins_are_rejected(self):
        for origin in ('https://user:password@mac.test','http://mac.test','https://mac.test/token'):
            with tempfile.TemporaryDirectory() as directory, self.assertRaises(ValueError):
                build(directory,origin)
