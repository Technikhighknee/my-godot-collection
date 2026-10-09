# 1400 Dev Tool

## Tools

- **Home:** the start page at `/` lists available tools and shows the active map workspace.
- **Map Editor:** open from the home screen or directly at `/tools/map-editor/`. It remains a Node.js / TypeScript browser editor for the Godot map format in `../map_system/`.
- **Asset ProcGen:** open from the home screen or at `/tools/asset-procgen/`. Generate a seeded broadleaf/oak mesh, compare four actual 3D-generated seed variants, save/load a versioned JSON recipe and export an independent glTF 2.0 binary (.glb) with bark/foliage primitives. The renderer and exported geometry share a pure deterministic generator. No Node dependencies beyond those already used by the Map Editor.

## Asset ProcGen

Asset ProcGen builds a tree in three independent stages: an oak growth profile produces a
hierarchical skeleton (trunk, four generations of branches, terminal shoots and
leaf anchors); a wood mesher creates curved, outward-facing tubes; and a separate
foliage mesher places individual lobed leaves along those shoots. Coarse shoot
competition leaves natural gaps in the crown. There are no visible or hidden
leaf-volume meshes.

In the viewport, **Full tree** is the default. **Wood only** hides the leaves,
while **Skeleton** shows generation-colored branch centerlines for inspecting growth.
The two diagnostic views never change the exported asset. Seed variants share
the same recipe parameters but derive independent growth shapes.

The JSON recipe stores the generator name \`oak\`, its internal revision,
a seed, and six bounded parameters. It can be saved and loaded without creating
any assets on disk. GLB export includes separate bark and foliage primitives
with vertex colors, PBR materials, and the embedded recipe. Both geometry
meshing stages operate on one deterministic skeleton; the seed and structural
IDs do not depend on traversal order or on how the 3D preview is rendered.
Exports are standalone and can be loaded without the generator.

This is a stylized structural-growth system, not a biological simulation or
a finished botanical species library. Trees are intentionally authored for the
look of the intended game, and leaf geometry is opaque rather than
texture-atlased. The current foliage budget is intended for individual asset
review; efficient distant forest rendering will require LODs/instancing.

The tool navigation is shared visually; existing map editing, saving and API operations are unchanged. Returning home from the Map Editor triggers the browser's unsaved-changes warning when necessary.

## Run

Requires Node.js >= 22.10, npm, and a WebGL2 browser.

```sh
cd dev_tool
npm ci
npm test
npm run typecheck
npm start
```

Open <http://127.0.0.1:4371/> for the Dev Tool main menu, then choose **Map Editor** (or open <http://127.0.0.1:4371/tools/map-editor/> directly). The **Maps** button in the editor can open or create maps in the startup map’s directory. To choose a different workspace, select its initial map on startup:

```sh
npm start -- ../map_system/example.map.json --port 4372
```

## Map workspace

- **Open:** choose an existing `*.map.json` from the active map folder; opening another map reloads the editor. Unsaved changes require confirmation.
- **Create:** provide a new lowercase filename slug, name, physical dimensions, height-sample grid, height range and surface palette. New maps start with flat terrain at elevation 0 (clamped to the configured range), and the first palette entry across every cell. The editor writes EXR/PNG/JSON without overwriting existing paths and registers all three files in a present Godot deployment manifest.
- **Settings:** rename a map, adjust its height range or change surface definition IDs. Changing the height range changes world-space elevations without modifying normalized EXR samples; changing palette labels changes the meaning of saved surface indices. Both require deliberate confirmation of unsaved edits and a reload. Map width/depth and sample resolution remain fixed after creation.
- **Active assets:** inspect the current EXR and PNG paths in the panel. Terrain painting and sculpting continue to manage immutable generated revisions. The editor does not automatically delete older asset versions.

The workspace is intentionally limited to one directory and does **not** expose an arbitrary file browser or delete maps. The map picker verifies linked EXR/PNG assets before marking entries valid. Changes from another process are detected by revision and asset integrity checks. Creating a map uses a final JSON publish point; if interrupted before publication, unused generated assets or manifest entries may remain, but existing maps are not replaced.

## Controls

- **Grid (`G` toggles; Grid button opens settings):** optional coordinate grid (0.25–100 m), hold `Alt` while placing or dragging to bypass it. Grid affects points/markers, not brush strokes. Numerical X/Z point, vertex, and marker fields support precise placement.
- **Multi-select markers:** `Shift`+click or `Ctrl`+click to toggle; `Ctrl+A` selects all markers of the current type; drag one selected marker to move the group. Each group operation is one Undo step.
- **Duplicate:** `D` or Duplicate selection starts a cursor-aligned preview for selected markers or a road. Hover to position it; green is valid, red is invalid. `LMB` commits one undoable duplicate, `Esc` cancels. `R` rotates marker duplicates in 15° steps. No changes occur until placement succeeds.
- **Hotbar:** `1–5` selects Select, Sculpt, Paint, Draw, or Place. `Q/E` cycles the current tool’s modes (sculpt, surfaces, roads/areas, entities/lakes). Context settings replace the long sidebar. Tools remember their last mode. Hotkeys never intercept focused form controls.
- **Camera (every tool):** middle drag to orbit, right drag or hold `Space` and left-drag to pan, wheel to zoom **toward the cursor**. `F` focuses the selected marker/road/build area or resets the map view if nothing is selected.
- **Edit roads:** select, create, move points, insert/append, delete or change width.
- **Water:** set a single global sea level and click the terrain to place lake sources with independent water levels. Ocean water only reaches terrain below sea level connected to a submerged boundary; lakes flood terrain reachable from their point. Shorelines derive from the triangular heightmap and react to Sculpt edits. No freehand water polygons. A lake source must remain below its water level. Existing polygon-water maps must be migrated.
- **Settlements:** draw closed build-area polygons, edit/insert/remove vertices, create settlements with multiple build areas, rename or remove areas. Finish with `Enter` (or click the first point), `Esc` cancels. Invalid and self-intersecting polygons cannot be committed.
- **Buildings & objects:** select visible markers, drag them to new positions, change definition/rotation, place or delete markers. `R` rotates placed or selected markers by 15° (`Shift+R` reverses); `Delete` removes the current selection (including roads/areas when selected). New IDs are generated automatically; type a real definition ID before placing.
- **Sculpt:** raise, lower, smooth or flatten with a circular brush. Hold `Shift` to reverse raise/lower, `Ctrl` to temporarily smooth (takes precedence over `Shift`), even mid-stroke. `Shift+wheel` changes brush radius, `Ctrl+wheel` changes brush strength; neither zooms the camera. Releasing modifiers restores the chosen sculpt mode. One drag is one undo entry. Flatten samples the height at stroke start.
- **Paint:** choose a surface definition or hold `I` and click an existing surface to sample it without painting. `Q/E` cycles definitions, `Shift+wheel` resizes the brush, and `Ctrl+wheel` changes its strength.
- **Undo/Redo:** `Ctrl+Z`, `Ctrl+Shift+Z` / `Ctrl+Y` (one history across all tools).
- **Save map:** `Ctrl+S`. Nothing changes on disk before saving.

Terrain saves create immutable content-addressed EXR/PNG assets. The map JSON is
published last; the original files stay intact. If `../map_system/manifest.json` exists,
new assets are included for deployment. Old generated assets are not removed
automatically. External file changes cause a save conflict.

The editor is bound to `127.0.0.1`; writes require same-origin requests. Binary map reads use conditional revisions to avoid mixing map assets across workspace switches. Preview colors and road ribbons approximate Godot rendering;
height geometry, triangular interpolation and stored surface indices use its map contract.
Building/object markers are placeholders, not actual game assets. The editor validates
known building definitions against footprints, build areas, slopes, roads and water
both in the browser and before saving. Rules depend on the supplied definition
catalog; Godot remains authoritative for final geometric placement decisions.

Copyright © 2026 Jason Posch. All rights reserved. See [NOTICE.md](NOTICE.md).

## M6 — building placement checks

The Godot map still stores only `id`, `definition`, `[x,z]`, and clockwise
`rotation` for each building. Building **definitions are not embedded in maps**.
For local preview and save-time checks, the editor reads
[`placement-definitions.json`](tools/map-editor/placement-definitions.json) at startup. The two
included definitions (`building.house` and `building.workshop`) are **editable
examples**, not canonical game content. Supply your own file with:

```sh
npm start -- ../map_system/coastal_relief.map.json --definitions ./tools/map-editor/placement-definitions.json
```

Each `buildings` entry contains `id` and `footprint` `[width,depth]` (meters),
with optional `requires_build_area` (default `true`), `max_slope` (degrees,
less than 90), `entrance` (local `[x,z]`), and `max_road_distance` (meters).
Road distance is measured from the transformed entrance to the *nearest road
edge*, not its centerline. All fields correspond to Godot's
`BuildingPlacement.check()` definition parameters. This registry is an
**editor-only** aid; the eventual game must provide its own building definitions
when using the Godot placement API.

Choose **Building**, enter a known definition ID (autocomplete), then press
**Place marker** and move over the terrain. The footprint is green when the
placement check succeeds and red otherwise. Click to place; select and drag
to relocate. Invalid new/changed building positions are rejected in the
browser **and again by the Node server before saving**. Undo/Redo remains
shared with all other edits. Terrain editing can invalidate an existing
building: a save rechecks known buildings when roads, water, build areas or
heightmap change. Pre-existing markers with definitions missing from the
catalogue are shown as unverified, retained unchanged, and cannot be moved
until their definitions are supplied. Unknown neighboring footprints block
new placement to avoid pretending no collision exists.

The browser/server checks use the same map coordinates, rectangle rotation,
triangle-based slope and definition contract as Godot. Road collision in the
Node tool is a **centerline-buffer approximation**, whereas
Godot uses `Geometry2D.offset_polyline` miter geometry. The Godot runtime is
still authoritative at this boundary; the preview is not a pixel-exact
replacement for Godot geometry. Editor preview is geometry, not a rendered
building model. This feature does **not** make the editor a building modeller.

## Terrain-derived water format

```json
"water": [
  { "id": "sea", "definition": "water.sea", "height": 0 },
  { "id": "hill_lake", "definition": "water.lake", "height": 18, "source": [140, 90] }
]
```

The lake coordinate is illustrative: it must lie strictly below its water level in the actual map. Maps may omit the sea (`"water": []`). Coastline geometry and water collision are derived, never serialized as polygons. Sea flooding starts from submerged map boundaries; lakes from their source triangle. Lakes and seas are static and require no fluid simulation. Water levels do not sculpt terrain. **Legacy `water[].polygon` maps are not backward-compatible** and require an explicit migration. Rivers are a future separate feature.
