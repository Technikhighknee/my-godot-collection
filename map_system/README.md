# Portable Map Source Examples

This directory holds **authoring examples and test fixtures** for the
[Dev Tool](../dev_tool/). It is **not** a deployable Godot package.

## Authoritative path

1. The Dev Tool Map Editor reads and writes `*.map.json`, EXR heightmaps and
   indexed PNG surface maps.
2. The Node.js offline scene builder uses the same source data and builds
   `geometry/terrain.glb`, and optional `geometry/roads.glb` and
   `geometry/water.glb`.
3. `ProjectLibrary.exportGodotScene` packages those **already-baked GLBs**
   into a Godot `.tscn`. Godot imports the terrain collision; it does **not**
   regenerate map meshes during gameplay.

See [scene production](../dev_tool/ARCHITECTURE.md) for the current implementation.

## Map source

Example files: `example.map.json` and `coastal_relief.map.json`.
Associated images live in `assets/`. The JSON document records:

- `name`: human-readable map name.
- `terrain.size`: world X/Z dimensions in metres.
- `terrain.heightmap`: relative single-channel EXR path, sampled between
  `min_height` and `max_height`.
- `terrain.surface_map`: relative grayscale PNG path; one categorical
  palette index per terrain cell.
- `terrain.surface_palette`: semantic IDs such as `terrain.grass`,
  `terrain.dirt` and `terrain.rock`.
- Optional `terrain.surface_materials`: saved project material references
  keyed by surface ID, with a `tile_size` and optional `profile`.
- `roads`: width-bearing polylines with ID and semantic `definition`.
- `settlements`: named regions with `build_areas` polygons.
- `water`: one possible `water.sea` height and independently sourced
  `water.lake` regions.
- `buildings` and `objects`: initial placements with ID, semantic
  definition, X/Z position and Y rotation in degrees.

```json
{
  "name": "Lübeck",
  "terrain": {
    "size": [1200, 900],
    "heightmap": "assets/terrain.height.exr",
    "min_height": -5,
    "max_height": 85,
    "surface_map": "assets/terrain.surface.png",
    "surface_palette": ["terrain.grass", "terrain.dirt", "terrain.rock"],
    "surface_materials": {
      "terrain.dirt": {"asset": "asset:dirt", "tile_size": 4}
    }
  },
  "roads": [{"id": "north", "definition": "road.cobblestone",
    "width": 5, "points": [[400, 300], [470, 355]]}],
  "settlements": [],
  "water": [{"id": "sea", "definition": "water.sea", "height": 2.5}],
  "buildings": [],
  "objects": []
}
```

The heightmap uses grid samples; the surface PNG has one fewer cell in
each axis. The terrain height sampler uses the same two-triangle cell split
as the offline mesh. Definition IDs are **semantic**, not Godot `res://`
paths. Model placement references use `asset:<id>` in the project library.

## Where did the Godot MapSystem scripts go?

They were retired from this branch because the offline pipeline supersedes
runtime `GameMapBuilder`, `TerrainGeometry`, `TerrainTextureMaterial`,
and related GDScript loaders/fields. They remain available through Git
history but must not be redeployed or resurrected alongside generated scenes.

Ideas worth carrying forward into the **one** offline art pipeline:
world-space material tiling, material boundary blending, large-scale
pigment/color variation, and distortion that affects visible texture
sampling without changing semantic terrain classifications. Those are
visual goals, not a reason to keep a separate Godot procedural renderer.
