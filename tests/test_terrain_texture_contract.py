from __future__ import annotations

import json
import math
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "map_system"


def shader_style_weights(cells: list[list[int]], world_size: tuple[float, float], x: float, z: float) -> dict[int, float]:
    """Reference of the shader's cell-center bilinear lookup (no Godot required)."""
    nx = len(cells[0])
    nz = len(cells)
    sx = max(0.0, min(nx - 1.0, x / world_size[0] * nx - 0.5))
    sz = max(0.0, min(nz - 1.0, z / world_size[1] * nz - 0.5))
    x0, z0 = math.floor(sx), math.floor(sz)
    x1, z1 = min(x0 + 1, nx - 1), min(z0 + 1, nz - 1)
    tx, tz = sx - x0, sz - z0
    weights: dict[int, float] = {}
    for cell_x, cell_z, weight in [
        (x0, z0, (1.0 - tx) * (1.0 - tz)),
        (x1, z0, tx * (1.0 - tz)),
        (x0, z1, (1.0 - tx) * tz),
        (x1, z1, tx * tz),
    ]:
        if weight > 0.0:
            index = cells[cell_z][cell_x]
            weights[index] = weights.get(index, 0.0) + weight
    return weights


class TerrainTextureContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.shader = (PACKAGE / "rendering" / "TerrainTextureMaterial.gd").read_text(encoding="utf-8")
        cls.builder = (PACKAGE / "rendering" / "GameMapBuilder.gd").read_text(encoding="utf-8")
        cls.field = (PACKAGE / "terrain" / "TerrainSurfaceField.gd").read_text(encoding="utf-8")

    def test_every_required_file_is_deployable(self) -> None:
        manifest = json.loads((PACKAGE / "manifest.json").read_text(encoding="utf-8"))
        for filename in (
            "rendering/TerrainTextureMaterial.gd",
            "rendering/GameMapBuilder.gd",
            "terrain/TerrainSurfaceField.gd",
        ):
            with self.subTest(filename=filename):
                self.assertIn(filename, manifest["files"])
                self.assertTrue((PACKAGE / filename).is_file())

    def test_shader_reads_categorical_indices_not_vertex_colors(self) -> None:
        self.assertIn("uniform sampler2D surface_indices", self.shader)
        self.assertIn("uniform sampler2DArray layer_albedos", self.shader)
        self.assertIn("texelFetch(surface_indices, cell, 0)", self.shader)
        self.assertIn("texture(layer_albedos", self.shader)
        self.assertIn("UV / terrain_size", self.shader)
        self.assertIn("- vec2(0.5)", self.shader)
        self.assertIn("ALBEDO = mix(top, bottom, t.y)", self.shader)
        self.assertNotIn("COLOR", self.shader)

    def test_renderer_uses_texture_material_without_changing_legacy_provider(self) -> None:
        self.assertIn("terrain_texture_provider: Callable = Callable()", self.builder)
        self.assertIn("TerrainTextureMaterial.create(surface_field, texture_provider)", self.builder)
        self.assertIn("_build_terrain_surfaces(height_field, surface_field, material_provider)", self.builder)
        self.assertIn('var size := height_field.get_world_size()', self.builder)
        self.assertIn("surface.set_uv(Vector2(world_x, world_z))", self.builder)
        self.assertIn("func create_index_texture() -> ImageTexture", self.field)

    def test_blend_kernel_is_normalized_and_supports_high_indices(self) -> None:
        cells = [[0, 6], [2, 100]]
        for x, z in [(0, 0), (0.5, 0.5), (1.5, 1.5), (2, 2), (0, 2), (2, 0)]:
            with self.subTest(position=(x, z)):
                weights = shader_style_weights(cells, (2.0, 2.0), x, z)
                self.assertAlmostEqual(sum(weights.values()), 1.0)
                self.assertTrue(set(weights).issubset({0, 6, 2, 100}))
        self.assertEqual(shader_style_weights(cells, (2.0, 2.0), 1, 1), {0: 0.25, 6: 0.25, 2: 0.25, 100: 0.25})

    def test_blend_kernel_samples_cell_centers_and_clamps_edges(self) -> None:
        cells = [[1, 3], [5, 7]]
        self.assertEqual(shader_style_weights(cells, (4.0, 4.0), 1.0, 1.0), {1: 1.0})
        self.assertEqual(shader_style_weights(cells, (4.0, 4.0), 3.0, 3.0), {7: 1.0})
        self.assertEqual(shader_style_weights(cells, (4.0, 4.0), -20.0, -20.0), {1: 1.0})
        self.assertEqual(shader_style_weights(cells, (4.0, 4.0), 20.0, 20.0), {7: 1.0})


if __name__ == "__main__":
    unittest.main()
