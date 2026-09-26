import struct
import tempfile
import unittest
from pathlib import Path

import runtime.local_bridge as bridge


class DriveSessionTests(unittest.TestCase):
    def test_token_is_memory_only_state(self):
        session = bridge.DriveSession()
        session.set("token-value")
        self.assertEqual(session.get(), "token-value")
        session.clear()
        with self.assertRaises(PermissionError):
            session.get()

    def test_rejects_empty_token(self):
        session = bridge.DriveSession()
        with self.assertRaises(ValueError):
            session.set("")


class RemoteTokenTests(unittest.TestCase):
    def test_remote_token_disabled_accepts_request(self):
        self.assertTrue(bridge.remote_token_valid("", None, None))

    def test_accepts_bearer_token(self):
        self.assertTrue(
            bridge.remote_token_valid(
                "secret-token",
                "Bearer secret-token",
                None,
            )
        )

    def test_accepts_legacy_header_token(self):
        self.assertTrue(
            bridge.remote_token_valid(
                "secret-token",
                None,
                "secret-token",
            )
        )

    def test_rejects_missing_or_wrong_token(self):
        self.assertFalse(
            bridge.remote_token_valid("secret-token", None, None)
        )
        self.assertFalse(
            bridge.remote_token_valid(
                "secret-token",
                "Bearer wrong-token",
                None,
            )
        )


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


class ChatPayloadTests(unittest.TestCase):
    def test_builds_safe_non_streaming_payload(self):
        payload = bridge.build_chat_payload(
            {"messages": [{"role": "user", "content": "你好"}]},
            "qwen.gguf",
        )
        self.assertEqual(payload["model"], "qwen.gguf")
        self.assertEqual(payload["messages"][0]["content"], "你好")
        self.assertFalse(payload["stream"])
        self.assertEqual(payload["max_tokens"], 512)

    def test_rejects_unknown_role(self):
        with self.assertRaises(ValueError):
            bridge.build_chat_payload(
                {"messages": [{"role": "tool", "content": "x"}]},
                "model.gguf",
            )

    def test_rejects_invalid_temperature(self):
        with self.assertRaises(ValueError):
            bridge.build_chat_payload(
                {"messages": [{"role": "user", "content": "x"}], "temperature": 3},
                "model.gguf",
            )

    def test_rejects_invalid_max_tokens(self):
        with self.assertRaises(ValueError):
            bridge.build_chat_payload(
                {"messages": [{"role": "user", "content": "x"}], "max_tokens": 0},
                "model.gguf",
            )


if __name__ == "__main__":
    unittest.main()
