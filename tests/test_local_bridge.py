import struct
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
        model.write_bytes(b"GGUF" + b"\x00" * 20)
        resolved = bridge.safe_model_path("folder/model.gguf")
        self.assertEqual(resolved, model.resolve())

    def test_rejects_empty_path(self):
        with self.assertRaises(ValueError):
            bridge.safe_model_path("")

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


class GgufInspectionTests(unittest.TestCase):
    def test_reads_fixed_header_without_payload(self):
        with tempfile.TemporaryDirectory() as temp:
            model = Path(temp) / "tiny.gguf"
            model.write_bytes(struct.pack("<4sIQQ", b"GGUF", 3, 42, 17) + b"payload")
            info = bridge.inspect_gguf(model)
            self.assertEqual(info["version"], 3)
            self.assertEqual(info["tensor_count"], 42)
            self.assertEqual(info["metadata_kv_count"], 17)
            self.assertEqual(info["header_bytes_read"], 24)
            self.assertEqual(info["file_size"], 31)

    def test_rejects_wrong_magic(self):
        with tempfile.TemporaryDirectory() as temp:
            model = Path(temp) / "fake.gguf"
            model.write_bytes(struct.pack("<4sIQQ", b"NOPE", 3, 1, 1))
            with self.assertRaises(ValueError):
                bridge.inspect_gguf(model)

    def test_rejects_truncated_header(self):
        with tempfile.TemporaryDirectory() as temp:
            model = Path(temp) / "short.gguf"
            model.write_bytes(b"GGUF")
            with self.assertRaises(ValueError):
                bridge.inspect_gguf(model)


class LoadModeTests(unittest.TestCase):
    def test_accepts_current_llama_load_modes(self):
        for mode in ("auto", "none", "mmap", "mlock", "mmap+mlock", "dio"):
            self.assertEqual(bridge.normalize_load_mode(mode), mode)

    def test_normalizes_case_and_whitespace(self):
        self.assertEqual(bridge.normalize_load_mode("  MMAP  "), "mmap")

    def test_rejects_unknown_load_mode(self):
        with self.assertRaises(ValueError):
            bridge.normalize_load_mode("legacy")


if __name__ == "__main__":
    unittest.main()
