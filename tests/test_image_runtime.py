import unittest

from runtime.image_runtime import (
    ADAPTERS,
    PONY_CHECKPOINT,
    adapter_for,
    build_prompt,
    checkpoint_spec,
)


class ImageAdapterTests(unittest.TestCase):
    def test_matches_pony_v6(self):
        matched = adapter_for(
            "Pony Diffusion V6 XL",
            "pony_diffusion_v6_xl",
            "image_anime/Snupihog__Pony_Diffusion_V6_XL",
        )
        self.assertIsNotNone(matched)
        self.assertEqual(matched[0], "pony_diffusion_v6_xl")

    def test_rejects_unadapted_flux(self):
        self.assertIsNone(
            adapter_for("FLUX.2 Klein 4B FP8", "flux2_klein_4b_fp8")
        )

    def test_selects_complete_drive_checkpoint(self):
        spec = checkpoint_spec(
            {
                "files": [
                    {
                        "id": "1wWI6_t6VpOybaoeGn0sSskfKy3SDCrTu",
                        "name": PONY_CHECKPOINT,
                        "size": 6_938_041_050,
                    }
                ]
            },
            ADAPTERS["pony_diffusion_v6_xl"],
        )
        self.assertEqual(spec.name, PONY_CHECKPOINT)
        self.assertEqual(spec.size, 6_938_041_050)

    def test_rejects_incomplete_checkpoint(self):
        with self.assertRaises(ValueError):
            checkpoint_spec(
                {
                    "files": [
                        {
                            "id": "1wWI6_t6VpOybaoeGn0sSskfKy3SDCrTu",
                            "name": PONY_CHECKPOINT,
                            "size": 1024,
                        }
                    ]
                },
                ADAPTERS["pony_diffusion_v6_xl"],
            )

    def test_builds_sdxl_comfy_prompt(self):
        prompt = build_prompt(
            PONY_CHECKPOINT,
            {
                "prompt": "score_9, source_anime, adult traveler",
                "negative_prompt": "blurry, watermark",
                "width": 1024,
                "height": 1024,
                "steps": 28,
                "cfg": 5,
                "seed": 1234,
            },
            ADAPTERS["pony_diffusion_v6_xl"],
            "job123",
        )
        self.assertEqual(prompt["1"]["class_type"], "CheckpointLoaderSimple")
        self.assertEqual(prompt["1"]["inputs"]["ckpt_name"], PONY_CHECKPOINT)
        self.assertEqual(prompt["2"]["inputs"]["stop_at_clip_layer"], -2)
        self.assertEqual(prompt["6"]["inputs"]["steps"], 28)
        self.assertEqual(prompt["6"]["inputs"]["cfg"], 5.0)
        self.assertEqual(prompt["6"]["inputs"]["seed"], 1234)
        self.assertEqual(prompt["8"]["class_type"], "SaveImage")


if __name__ == "__main__":
    unittest.main()
