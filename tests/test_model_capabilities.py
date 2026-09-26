import unittest

from runtime.model_capabilities import capability_for


class ModelCapabilityTests(unittest.TestCase):
    def test_known_automatic_model(self):
        capability = capability_for("qwen3_14b_q6")
        self.assertEqual(capability["availability"], "automatic")
        self.assertEqual(capability["adapter"], "llama.cpp")

    def test_incomplete_drive_model_is_not_runnable(self):
        capability = capability_for("flux_1_dev")
        self.assertEqual(capability["availability"], "incomplete")
        self.assertIn("主权重", capability["reason"])

    def test_unknown_model_is_explicit(self):
        capability = capability_for("not-in-vault", category="ocr")
        self.assertEqual(capability["availability"], "unknown")
