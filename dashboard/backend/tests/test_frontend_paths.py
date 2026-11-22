import os
import tempfile
import unittest
from pathlib import Path

from main import _safe_path_under


class SafePathUnderTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "frontend"
        self.root.mkdir()
        (self.root / "index.html").write_text("index", encoding="utf-8")
        assets = self.root / "assets"
        assets.mkdir()
        (assets / "app.js").write_text("js", encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def test_empty_path_resolves_to_index(self):
        got = _safe_path_under(self.root, "")
        self.assertEqual(got, Path(os.path.realpath(self.root / "index.html")))

    def test_nested_asset_is_allowed(self):
        got = _safe_path_under(self.root, "assets/app.js")
        self.assertEqual(got, Path(os.path.realpath(self.root / "assets" / "app.js")))

    def test_normalized_parent_inside_root_still_works(self):
        got = _safe_path_under(self.root, "assets/../index.html")
        self.assertEqual(got, Path(os.path.realpath(self.root / "index.html")))

    def test_relative_escape_is_rejected(self):
        self.assertIsNone(_safe_path_under(self.root, "../../../etc/passwd"))

    def test_nested_relative_escape_is_rejected(self):
        self.assertIsNone(_safe_path_under(self.root, "assets/../../../../etc/passwd"))

    def test_absolute_path_is_rejected(self):
        self.assertIsNone(_safe_path_under(self.root, "/etc/passwd"))

    def test_null_byte_is_rejected(self):
        self.assertIsNone(_safe_path_under(self.root, "index.html\x00.png"))

    def test_prefix_sibling_directory_is_rejected(self):
        evil = Path(self.tmp.name) / "frontend-evil"
        evil.mkdir()
        (evil / "secret.txt").write_text("nope", encoding="utf-8")
        self.assertIsNone(_safe_path_under(self.root, f"../{evil.name}/secret.txt"))


if __name__ == "__main__":
    unittest.main()
