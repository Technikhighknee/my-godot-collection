# Map System

An opinionated map foundation for a 3D game in Godot 4.

The map describes the physical world at the start of a new game. After that, runtime/save state owns what happens to it.

The core rules are intentionally small:

- Maps are portable JSON, not Godot scenes or resources.
- Map coordinates are `[x, z]` world coordinates.
- Rotation is stored in degrees and applied as Y rotation in Godot.
- Roads are center-line polylines with a width and a semantic definition ID.
- Settlements own one or more build-area polygons.
- Water is represented explicitly as flat polygons with a world-space height and semantic definition ID.
- Preplaced buildings are normal game buildings. The map only says which definition exists where at game start.
- The same `BuildingPlacement` logic is intended for player and AI construction.
- Definition IDs are semantic IDs for game content such as buildings, objects, and road types. A map never contains `res://` paths.

There is deliberately no editor code in this package.

## Map format

```json
{
  "name": "Lübeck",
  "terrain": {
    "size": [1200, 900],
    "heightmap": "terrain.height.exr",
    "min_height": -5,
    "max_height": 85,
    "surface_map": "terrain.surface.png",
    "surface_palette": ["terrain.grass", "terrain.dirt", "terrain.rock"]
  },
  "roads": [
    {
      "id": "road_market_north",
      "definition": "road.cobblestone",
      "width": 5,
      "points": [[400, 300], [430, 340], [470, 355]]
    }
  ],
  "settlements": [
    {
      "id": "luebeck",
      "name": "Lübeck",
      "build_areas": [
        [[320, 290], [690, 300], [720, 610], [300, 590]]
      ]
    }
  ],
  "water": [
    {
      "id": "river_trave",
      "definition": "water.river",
      "height": 2.5,
      "polygon": [[250, 650], [900, 620], [920, 700], [260, 730]]
    }
  ],
  "buildings": [
    {
      "id": "blacksmith_01",
      "definition": "building.blacksmith",
      "position": [430, 395],
      "rotation": 12
    }
  ],
  "objects": [
    {
      "id": "market_well",
      "definition": "object.well",
      "position": [500, 440],
      "rotation": 0
    }
  ]
}
```

All road, settlement, water, building, and object IDs share one namespace and must be unique inside the map. A road `definition` describes its game-facing type (for example paving, movement rules, or later material lookup); `width` remains per-road map geometry.

`size` defines the X/Z world extent. `heightmap` is an EXR path relative to the map JSON; map files therefore remain portable and contain no Godot resource paths. Pixel values are normalized from `min_height` to `max_height`.

Use single-channel floating-point EXR heightmaps. Height data stays high precision instead of being quantized through an 8-bit image import path. The heightmap resolution controls sample density independently of world size: a 601×451 image can describe a 1200×900 world without implying one pixel per meter.

The top-left heightmap sample maps to `[0, 0]`; the bottom-right sample maps to `[size.x, size.z]`. Runtime height queries use the same two-triangle split as the rendered terrain mesh, so queried heights, terrain collision geometry, road surfaces, and placed entities agree on the actual ground surface.

`surface_map` is an indexed grayscale PNG with exactly one pixel per terrain grid cell, so a heightmap with 33×25 samples uses a 32×24 surface map. Pixel value `0` maps to `surface_palette[0]`, `1` to `surface_palette[1]`, and so on. The palette contains semantic game IDs rather than Godot materials, keeping the map portable while still describing whether a cell is grass, dirt, rock, or another game-defined surface. Surface assignment is intentionally categorical at this stage: one terrain cell has one surface definition. Texture blending can be layered on later without changing the semantic ground type used by gameplay.

## Loading

`GameMapLoader.load_file(path)` parses and structurally validates the map. Invalid maps return `null` and report the concrete validation errors.

Validation currently rejects:

- missing or unknown fields;
- duplicate IDs;
- points outside terrain bounds;
- zero/negative road widths;
- degenerate roads;
- invalid build-area polygons;
- malformed water polygons;
- malformed building/object placements.

```gdscript
var game_map := GameMapLoader.load_file("res://maps/luebeck/luebeck.map.json");
if game_map == null:
    return;
```

The loader returns a `GameMap`, which keeps the validated portable JSON together with its source path and loaded `TerrainHeightField`. That runtime context lets multiple consumers resolve map-relative assets without putting runtime paths into the JSON. `res://` heightmaps are loaded through Godot's resource pipeline so they continue to work after export; external/runtime map files use direct image loading.

`TerrainHeightField` is the shared terrain truth and exposes interpolated height, normal, and slope queries. `TerrainSurfaceField` provides the corresponding semantic ground type:

```gdscript
var y := game_map.terrain.height_at(Vector2(x, z));
var normal := game_map.terrain.normal_at(Vector2(x, z));
var slope_degrees := game_map.terrain.slope_at(Vector2(x, z));
var surface_definition := game_map.terrain_surfaces.definition_at(Vector2(x, z));
```

## Building the initial world

`GameMapBuilder` owns map geometry: heightmap terrain, terrain collision, terrain-conforming road meshes, and explicit water surfaces. Terrain visual geometry and collision are produced from the same height samples. Roads, buildings, and objects query the same `TerrainHeightField` for their Y position.

It does **not** own a building registry. Instead, the game supplies two tiny spawner callbacks. That keeps definition lookup and the actual gameplay entities outside the map package.

```gdscript
func spawn_building(definition_id: String, _entry: Dictionary) -> Node3D:
    return building_catalog.instantiate(definition_id);

func spawn_object(definition_id: String, _entry: Dictionary) -> Node3D:
    return object_catalog.instantiate(definition_id);

func map_material(kind: String, definition_id: String) -> Material:
    return map_materials.get(kind + ":" + definition_id);

var root := GameMapBuilder.build(
    game_map,
    self,
    spawn_building,
    spawn_object,
    map_material
);
```

The returned building/object nodes receive the map entry's position and rotation and are parented under the generated map root. The optional material provider resolves semantic terrain, road, and water definition IDs to normal Godot `Material` resources. Its signature is `(kind: String, definition_id: String) -> Material`, where `kind` is `terrain`, `road`, or `water`. If no provider is supplied, the builder uses debug materials so a map remains directly inspectable without game-specific assets. Generated terrain, road, and water meshes use world-space X/Z as UV coordinates, so ordinary repeating materials can choose their own meter-scale tiling instead of stretching one texture across the whole map.

This means a preplaced `building.blacksmith` can be instantiated through the same catalog/factory that player or AI construction uses. There is no special "map building" type.

The builder constructs the complete map subtree before attaching it to `parent`. A failed road build or entity spawn therefore does not leave a half-built map in the scene tree.

## Runtime building placement

`BuildingPlacement.check(...)` contains the geometry rules needed to decide whether a normal building can be placed.

A minimal building definition for placement looks like this:

```gdscript
{
    "footprint": [8.0, 12.0],
    "requires_build_area": true,
    "entrance": [0.0, 6.0],
    "max_road_distance": 10.0,
    "max_slope": 8.0,
}
```

Only `footprint` is mandatory. If `max_road_distance` is present, `entrance` is mandatory too. Buildings without `max_road_distance` do not require road access. `requires_build_area` defaults to `true`, so rural/special buildings can explicitly opt out. `max_slope` is optional and rejects footprints whose sampled terrain exceeds that slope in degrees.

```gdscript
var result := BuildingPlacement.check(
    game_map,
    definition,
    Vector2(430, 395),
    12.0,
    occupied_buildings
);

if result.valid:
    print("Can build in: ", result.settlement_id);
else:
    print("Cannot build: ", result.reason);
```

`occupied_buildings` contains only the geometry needed for collision checks:

```gdscript
[
    {
        "id": "blacksmith_01",
        "position": [430, 395],
        "rotation": 12,
        "footprint": [8, 12]
    }
]
```

Placement currently checks:

- the entire rotated footprint stays inside the map;
- the entire footprint fits inside a settlement build area unless the definition opts out;
- the footprint does not overlap water;
- the footprint does not overlap a road;
- the footprint does not overlap an occupied building;
- when road access is required, the transformed entrance is close enough to the nearest road edge;
- when `max_slope` is present, the terrain under the footprint stays within that slope.

Successful checks also return `ground_height` at the building origin and the maximum sampled `terrain_slope` under its footprint. Placement results keep stable `water_id` and `road_id` fields; overlap failures populate the relevant one.

Road rendering and road exclusion both derive their area from the same centerline + width data using Godot's `Geometry2D`, so they do not have competing interpretations of road width. For rendering, that exact road polygon is clipped against the terrain triangle grid before being lifted onto the height field. Long road segments therefore conform to the terrain instead of spanning hills or valleys as a few large triangles. The same shared terrain-grid clipping is also used by building slope checks, so roads and placement cannot silently disagree about which terrain triangles exist beneath a polygon.

## What is intentionally not here

- No map editor.
- No Godot editor plugin.
- No second representation of preplaced buildings.
- No attempt to infer water from terrain height.
- No save-game state in map files.
- No `res://` paths in map files.
- No map-version migration machinery while there are no released consumers to migrate.
- No generic feature/component/factory hierarchy.
- No speculative chunking, biome, or terrain-layer architecture.

The format can grow when the game proves it needs another concept.
