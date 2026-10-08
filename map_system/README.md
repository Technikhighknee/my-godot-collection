# Map System

An opinionated map foundation for a 3D game in Godot 4.

The map describes the physical world at the start of a new game. After that, runtime/save state owns what happens to it.

The core rules are intentionally small:

- Maps are portable JSON, not Godot scenes or resources.
- Map coordinates are `[x, z]` world coordinates.
- Rotation is stored in degrees and applied as Y rotation in Godot.
- Roads are center-line polylines with a width.
- Settlements own one or more build-area polygons.
- Preplaced buildings are normal game buildings. The map only says which definition exists where at game start.
- The same `BuildingPlacement` logic is intended for player and AI construction.
- Definition IDs are semantic IDs. A map never contains `res://` paths.

There is deliberately no editor code in this package.

## Map format

```json
{
  "name": "Lübeck",
  "terrain": {
    "size": [1200, 900],
    "heightmap": "terrain.height.png",
    "min_height": -5,
    "max_height": 85
  },
  "roads": [
    {
      "id": "road_market_north",
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

All road, settlement, building, and object IDs share one namespace and must be unique inside the map.

`size` defines the X/Z world extent. `heightmap` is a PNG path relative to the map JSON; map files therefore remain portable and contain no Godot resource paths. Pixel values are normalized from `min_height` to `max_height`.

Use 16-bit grayscale PNG heightmaps for production maps. Lower-bit-depth PNGs can be loaded by Godot but reduce terrain precision. The heightmap resolution controls sample density independently of world size: a 601×451 image can describe a 1200×900 world without implying one pixel per meter.

The top-left heightmap sample maps to `[0, 0]`; the bottom-right sample maps to `[size.x, size.z]`. Runtime height queries use the same two-triangle split as the rendered terrain mesh, so queried heights, terrain collision geometry, road surfaces, and placed entities agree on the actual ground surface.

## Loading

`GameMapLoader.load_file(path)` parses and structurally validates the map. Invalid maps return an empty dictionary and report the concrete validation errors.

Validation currently rejects:

- missing or unknown fields;
- duplicate IDs;
- points outside terrain bounds;
- zero/negative road widths;
- degenerate roads;
- invalid build-area polygons;
- malformed building/object placements.

```gdscript
var game_map := GameMapLoader.load_file("res://maps/luebeck/luebeck.map.json");
if game_map == null:
    return;
```

The loader returns a `GameMap`, which keeps the validated portable JSON together with its source path and loaded `TerrainHeightField`. That runtime context lets multiple consumers resolve map-relative assets without putting runtime paths into the JSON.

`TerrainHeightField` is the shared terrain truth and exposes interpolated height, normal, and slope queries:

```gdscript
var y := game_map.terrain.height_at(Vector2(x, z));
var normal := game_map.terrain.normal_at(Vector2(x, z));
var slope_degrees := game_map.terrain.slope_at(Vector2(x, z));
```

## Building the initial world

`GameMapBuilder` owns map geometry: heightmap terrain, terrain collision, and road meshes. Terrain visual geometry and collision are produced from the same height samples. Roads, buildings, and objects query the same `TerrainHeightField` for their Y position.

It does **not** own a building registry. Instead, the game supplies two tiny spawner callbacks. That keeps definition lookup and the actual gameplay entities outside the map package.

```gdscript
func spawn_building(definition_id: String, _entry: Dictionary) -> Node3D:
    return building_catalog.instantiate(definition_id);

func spawn_object(definition_id: String, _entry: Dictionary) -> Node3D:
    return object_catalog.instantiate(definition_id);

var root := GameMapBuilder.build(
    game_map,
    self,
    spawn_building,
    spawn_object
);
```

The returned building/object nodes receive the map entry's position and rotation and are parented under the generated map root.

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
- the footprint does not overlap a road;
- the footprint does not overlap an occupied building;
- when road access is required, the transformed entrance is close enough to the nearest road edge;
- when `max_slope` is present, the terrain under the footprint stays within that slope.

Successful checks also return `ground_height` at the building origin and the maximum sampled `terrain_slope` under its footprint.

Road rendering and road exclusion both derive their area from the same centerline + width data using Godot's `Geometry2D`, so they do not have competing interpretations of road width. For rendering, that exact road polygon is clipped against the terrain triangle grid before being lifted onto the height field. Long road segments therefore conform to the terrain instead of spanning hills or valleys as a few large triangles.

## What is intentionally not here

- No map editor.
- No Godot editor plugin.
- No second representation of preplaced buildings.
- No save-game state in map files.
- No `res://` paths in map files.
- No map-version migration machinery while there are no released consumers to migrate.
- No generic feature/component/factory hierarchy.
- No speculative chunking, biome, or terrain-layer architecture.

The format can grow when the game proves it needs another concept.
