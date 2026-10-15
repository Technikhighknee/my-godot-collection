from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "map_system"

class OfflineMapSourceTests(unittest.TestCase):
    def test_map_examples_remain_portable_authoring_sources(self) -> None:
        for filename in ("example.map.json", "coastal_relief.map.json"):
            with self.subTest(filename=filename):
                path = SAMPLES / filename
                doc = json.loads(path.read_text(encoding="utf-8"))
                self.assertTrue(doc["terrain"]["size"])
                self.assertTrue(doc["terrain"]["surface_palette"])
                for field in ("heightmap", "surface_map"):
                    ref = Path(doc["terrain"][field])
                    self.assertFalse(ref.is_absolute())
                    self.assertNotIn("..", ref.parts)
                    self.assertTrue((SAMPLES / ref).is_file())

    def test_no_second_deployable_godot_map_builder(self) -> None:
        self.assertFalse((SAMPLES / "manifest.json").exists())
        self.assertFalse(list(SAMPLES.rglob("*.gd")))
        self.assertTrue((ROOT / "dev_tool/src/projects/map-geometry.ts").is_file())
        self.assertTrue((ROOT / "dev_tool/src/projects/map-glb.ts").is_file())
        self.assertTrue((ROOT / "dev_tool/src/projects/godot-scene.ts").is_file())

if __name__ == "__main__":
    unittest.main()
