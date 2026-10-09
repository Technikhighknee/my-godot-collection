# 1400 Map Editor

Local Node.js / TypeScript browser editor for the Godot map format in `../godot/`.

## Run

Requires Node.js >= 22.10, npm, and a WebGL2 browser.

```sh
cd map_system/editor
npm ci
npm test
npm run typecheck
npm start
```

Open <http://127.0.0.1:4371/>. Choose a map on startup:

```sh
npm start -- ../godot/example.map.json --port 4372
```

## Controls

- **Navigate:** left drag to orbit, right drag to pan, wheel to zoom, `F` to reset.
- **Edit roads:** select, create, move points, insert/append, delete or change width.
- **Water & settlements:** draw closed polygons, edit/insert/remove vertices, create settlements with multiple build areas, adjust water heights and definitions, rename settlements or remove polygons. Finish with `Enter` (or click the first point), `Esc` cancels. Invalid and self-intersecting polygons cannot be committed.
- **Buildings & objects:** select visible markers, drag them to new positions, change definition/rotation, place or delete markers. New IDs are generated automatically; type a real definition ID before placing.
- **Sculpt:** raise, lower, smooth or flatten with a circular brush. Flatten samples the height at stroke start.
- **Paint:** choose a surface definition and paint its categorical cell IDs.
- **Undo/Redo:** `Ctrl+Z`, `Ctrl+Shift+Z` / `Ctrl+Y` (one history across all tools).
- **Save map:** `Ctrl+S`. Nothing changes on disk before saving.

Terrain saves create immutable content-addressed EXR/PNG assets. The map JSON is
published last; the original files stay intact. If `../godot/manifest.json` exists,
new assets are included for deployment. Old generated assets are not removed
automatically. External file changes cause a save conflict.

The editor is bound to `127.0.0.1`; writes require same-origin requests. The map
is chosen on startup. Preview colors and road ribbons approximate Godot rendering;
height geometry, triangular interpolation and stored surface indices use its map contract.
Building/object markers are placeholders, not actual game assets. Placement validates
IDs, map bounds and the JSON schema; Godot's definition-specific footprint, road,
slope and build-area checks require gameplay definitions and are **not** asserted here.

Copyright © 2026 Jason Posch. All rights reserved. See [NOTICE.md](NOTICE.md).

## M6 — building placement checks

The Godot map still stores only `id`, `definition`, `[x,z]`, and clockwise
`rotation` for each building. Building **definitions are not embedded in maps**.
For local preview and save-time checks, the editor reads
[`placement-definitions.json`](placement-definitions.json) at startup. The two
included definitions (`building.house` and `building.workshop`) are **editable
examples**, not canonical game content. Supply your own file with:

```sh
npm start -- ../godot/coastal_relief.map.json --definitions ./placement-definitions.json
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
