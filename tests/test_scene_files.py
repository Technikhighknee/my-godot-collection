from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class PortableSceneTests(unittest.TestCase):
    def test_strategy_camera_scene_is_relocatable(self) -> None:
        package = ROOT / "strategy_camera"
        scene = (package / "StrategyCamera.tscn").read_text(encoding="utf-8")

        self.assertIn('[gd_scene format=3]', scene)
        self.assertIn(
            '[ext_resource type="Script" path="StrategyCamera.gd" id="1"]',
            scene,
        )
        self.assertIn('script = ExtResource("1")', scene)
        self.assertIn('[node name="Camera3D" type="Camera3D" parent="."]', scene)
        self.assertIn("fov = 45.0", scene)
        self.assertNotIn("uid=", scene)
        self.assertNotIn("unique_id=", scene)
        self.assertNotIn("res://", scene)

        manifest = json.loads((package / "manifest.json").read_text(encoding="utf-8"))
        self.assertIn("StrategyCamera.tscn", manifest["files"])
        self.assertIn("StrategyCamera.gd", manifest["files"])
        for path in manifest["files"]:
            with self.subTest(path=path):
                self.assertTrue((package / path).is_file())


if __name__ == "__main__":
    unittest.main()
