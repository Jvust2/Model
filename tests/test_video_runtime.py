import json
import tempfile
import unittest
from pathlib import Path

from runtime import video_runtime as video


def load_workflow(name: str) -> dict:
    path = Path(__file__).resolve().parents[1] / "runtime" / "workflows" / name
    return json.loads(path.read_text(encoding="utf-8"))


class AdapterTests(unittest.TestCase):
    def test_matches_wan_5b(self):
        match = video.adapter_for("Wan2.2-TI2V-5B", "wan2.2-ti2v-5b")
        self.assertIsNotNone(match)
        self.assertEqual(match[0], "wan2.2-ti2v-5b")

    def test_matches_hunyuan(self):
        match = video.adapter_for("HunyuanVideo-1.5")
        self.assertIsNotNone(match)
        self.assertEqual(match[0], "hunyuanvideo-1.5")

    def test_rejects_unadapted_video(self):
        self.assertIsNone(video.adapter_for("Wan2.2-Animate-14B"))


class WorkflowTests(unittest.TestCase):
    def test_wan_text_to_video_prunes_optional_image_and_collects_three_models(self):
        workflow = load_workflow("video_wan2_2_5B_ti2v.json")
        customized, keep = video.customize_workflow(
            workflow,
            "wan2.2-ti2v-5b",
            {
                "prompt": "a cat walking through snow",
                "negative_prompt": "blur",
                "width": 832,
                "height": 480,
                "frames": 49,
                "fps": 24,
                "steps": 20,
                "cfg": 5,
                "seed": 123,
            },
            "job123",
        )

        latent = next(node for node in customized["nodes"] if node["id"] == 55)
        start_image = next(
            item for item in latent["inputs"] if item["name"] == "start_image"
        )
        self.assertIsNone(start_image["link"])

        names = {
            item["name"]
            for item in video.model_requirements(customized, keep)
        }
        self.assertEqual(
            names,
            {
                "wan2.2_ti2v_5B_fp16.safetensors",
                "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
                "wan2.2_vae.safetensors",
            },
        )

        positive = next(
            node
            for node in customized["nodes"]
            if node.get("title") == "CLIP Text Encode (Positive Prompt)"
        )
        self.assertEqual(positive["widgets_values"][0], "a cat walking through snow")

        sampler = next(node for node in customized["nodes"] if node["type"] == "KSampler")
        self.assertEqual(sampler["widgets_values"][0], 123)
        self.assertEqual(sampler["widgets_values"][2], 20)
        self.assertEqual(sampler["widgets_values"][3], 5)

    def test_hunyuan_base_output_does_not_pull_super_resolution_models(self):
        workflow = load_workflow("video_hunyuan_video_1.5_720p_t2v.json")
        customized, keep = video.customize_workflow(
            workflow,
            "hunyuanvideo-1.5",
            {
                "prompt": "city at sunset",
                "width": 1280,
                "height": 720,
                "frames": 49,
                "fps": 24,
                "steps": 20,
                "cfg": 6,
                "seed": 456,
            },
            "job456",
        )

        requirements = video.model_requirements(customized, keep)
        names = {item["name"] for item in requirements}

        self.assertIn("hunyuanvideo1.5_720p_t2v_fp16.safetensors", names)
        self.assertIn("hunyuanvideo15_vae_fp16.safetensors", names)
        self.assertIn("qwen_2.5_vl_7b_fp8_scaled.safetensors", names)
        self.assertIn("byt5_small_glyphxl_fp16.safetensors", names)
        self.assertNotIn("hunyuanvideo1.5_1080p_sr_distilled_fp16.safetensors", names)
        self.assertNotIn("hunyuanvideo15_latent_upsampler_1080p.safetensors", names)

        latent = next(
            node for node in customized["nodes"]
            if node["type"] == "EmptyHunyuanVideo15Latent"
        )
        self.assertEqual(latent["widgets_values"], [1280, 720, 49, 1])

    def test_converts_frontend_workflow_to_api_prompt(self):
        workflow = {
            "nodes": [
                {
                    "id": 1,
                    "type": "Loader",
                    "mode": 0,
                    "inputs": [],
                    "widgets_values": ["model.safetensors"],
                },
                {
                    "id": 2,
                    "type": "Sampler",
                    "mode": 0,
                    "inputs": [{"name": "model", "link": 10}],
                    "widgets_values": [42, "fixed", 20],
                },
            ],
            "links": [[10, 1, 0, 2, 0, "MODEL"]],
        }
        object_info = {
            "Loader": {
                "input": {
                    "required": {
                        "model_name": [["model.safetensors"], {}],
                    }
                }
            },
            "Sampler": {
                "input": {
                    "required": {
                        "model": ["MODEL", {}],
                        "seed": ["INT", {}],
                        "steps": ["INT", {}],
                    }
                }
            },
        }

        prompt = video.workflow_to_api_prompt(
            workflow,
            object_info,
            {"1", "2"},
        )
        self.assertEqual(prompt["1"]["inputs"]["model_name"], "model.safetensors")
        self.assertEqual(prompt["2"]["inputs"]["model"], ["1", 0])
        self.assertEqual(prompt["2"]["inputs"]["seed"], 42)
        self.assertEqual(prompt["2"]["inputs"]["steps"], 20)

    def test_rejects_invalid_frame_count(self):
        workflow = load_workflow("video_wan2_2_5B_ti2v.json")
        with self.assertRaises(ValueError):
            video.customize_workflow(
                workflow,
                "wan2.2-ti2v-5b",
                {"prompt": "x", "frames": 50},
                "bad",
            )


if __name__ == "__main__":
    unittest.main()
