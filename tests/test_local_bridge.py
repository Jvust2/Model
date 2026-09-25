import tempfile
import unittest
from pathlib import Path

import runtime.local_bridge as bridge


class SafeModelPathTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.old_root = bridge.MODEL_DRIVE_ROOT
        bridge.MODEL_DRIVE_ROOT = str(self.root)

    def tearDown(self):
        bridge.MODEL_DRIVE_ROOT = self.old_root
        self.temp.cleanup()

    def test_accepts_gguf_below_drive_root(self):
        model = self.root / "folder" / "model.gguf"
        model.parent.mkdir(parents=True)
        model.write_bytes(b"GGUF")
        resolved = bridge.safe_model_path("folder/model.gguf")
        self.assertEqual(resolved, model.resolve())

    def test_rejects_parent_traversal(self):
        with self.assertRaises(ValueError):
            bridge.safe_model_path("../outside.gguf")

    def test_rejects_non_gguf(self):
        model = self.root / "model.safetensors"
        model.write_bytes(b"x")
        with self.assertRaises(ValueError):
            bridge.safe_model_path("model.safetensors")

    def test_rejects_missing_model(self):
        with self.assertRaises(FileNotFoundError):
            bridge.safe_model_path("missing.gguf")


if __name__ == "__main__":
    unittest.main()
