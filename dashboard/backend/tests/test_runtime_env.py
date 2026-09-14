import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from services import env_file
from services.env_file import funcom_image_tag, live_world_name


class RuntimeEnvTests(unittest.TestCase):
    def test_world_name_reads_env_file_not_import_time(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / ".env"
            path.write_text('WORLD_NAME="One Sandworm One Tacoma"\n', encoding="utf-8")
            with patch.object(env_file, "ENV_PATH", str(path)), patch.dict(os.environ, {"WORLD_NAME": "", "DUNE_WORLD_NAME": ""}, clear=False):
                self.assertEqual(live_world_name(), "One Sandworm One Tacoma")
                path.write_text('WORLD_NAME="Renamed Sietch"\n', encoding="utf-8")
                self.assertEqual(live_world_name(), "Renamed Sietch")

    def test_funcom_image_tag_defaults_to_unknown(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / ".env"
            path.write_text("", encoding="utf-8")
            with patch.object(env_file, "ENV_PATH", str(path)), patch.dict(os.environ, {"DUNE_IMAGE_TAG": ""}, clear=False):
                self.assertEqual(funcom_image_tag(), "unknown")
            path.write_text("DUNE_IMAGE_TAG=2064155-0-shipping\n", encoding="utf-8")
            with patch.object(env_file, "ENV_PATH", str(path)), patch.dict(os.environ, {"DUNE_IMAGE_TAG": ""}, clear=False):
                self.assertEqual(funcom_image_tag(), "2064155-0-shipping")


if __name__ == "__main__":
    unittest.main()
