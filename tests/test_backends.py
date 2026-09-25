import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from runtime import backends


class BackendPlanTests(unittest.TestCase):
    def test_llama_plan_is_direct_chat_launch(self):
        plan = backends.model_plan("llama.cpp", "llm")
        self.assertEqual(plan["workspace"], "chat")
        self.assertTrue(plan["automatic_launch"])

    def test_video_plan_selects_video_workspace(self):
        plan = backends.model_plan("ComfyUI", "video")
        self.assertEqual(plan["workspace"], "video-generation")
        self.assertFalse(plan["automatic_launch"])
        self.assertIn("workflow", " ".join(plan["requirements"]).lower())

    def test_transformers_plan_selects_vision_for_ocr(self):
        plan = backends.model_plan("Transformers", "ocr")
        self.assertEqual(plan["workspace"], "vision")

    def test_backend_status_does_not_expose_paths(self):
        with tempfile.TemporaryDirectory() as temp:
            fake_llama = Path(temp) / "llama-server.exe"
            fake_llama.write_bytes(b"x")
            with mock.patch.dict(
                os.environ,
                {"MODEL_COMFYUI_ROOT": temp},
                clear=False,
            ):
                status = backends.backend_status(str(fake_llama))
        serialized = repr(status)
        self.assertNotIn(temp, serialized)
        self.assertTrue(status["backends"]["llama.cpp"]["detected"])
        self.assertTrue(status["backends"]["ComfyUI"]["detected"])


if __name__ == "__main__":
    unittest.main()
