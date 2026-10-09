# 1400 Map Editor

Local browser-based map viewer/editor foundation for the Godot map system. Lives
inside `my-godot-collection/map_system/editor`; it is **not** a standalone repo or
a game package. The application is currently a **read-only 3D viewer (M1)**.

## Run

Requirements: Node.js >= 22.10.0, npm, modern browser with WebGL2.

```sh
cd map_system/editor
npm install
npm test
npm run typecheck
npm start
```

Open `http://127.0.0.1:4371/`. The default map is
`../godot/coastal_relief.map.json`. To inspect another map:

```sh
npm start -- ../godot/example.map.json --port 4372
```

The server listens on **127.0.0.1 only**. It loads and validates the selected
map once at startup; refresh the process if the map changed on disk. It does not
expose file selection or write APIs. Browser requests can access only the
snapshot metadata, decoded terrain/surface buffers, application assets and
Three.js modules explicitly allowlisted by the server.

**Controls:** left-drag orbit, right-drag pan, scroll zoom, `F` or Reset camera
to frame the terrain. The sidebar toggles wireframe, semantic surface color
preview, roads, water, build areas and entity markers. Hover to see X/Z/elevation
and the exact surface definition at the cursor.

## Accuracy and limits

- Preserves Godot's world X/Z coordinates, triangle split, normalized FLOAT32
  heights, world min/max height scaling and categorical surface cells.
- Uses the original JSON definitions and exact loaded EXR/PNG samples; it never
  re-encodes or modifies source files for viewing.
- Supports ZIP/ZIPS/uncompressed single-channel FLOAT32 EXR (R/Y) and
  noninterlaced 8-bit grayscale PNG. Other formats fail explicitly.
- Terrain surface colors are **diagnostic previews**, not Godot's procedural
  tile textures or fragment shader blending. Roads use an approximate terrain-
  conforming ribbon; water uses flat polygon shapes. Buildings and objects are
  markers, not runtime meshes. These are visualization boundaries, not changes
  to the map semantics.
- The first viewport deliberately limits heightmaps to 1.5 million samples,
  rather than allocating an unbounded GPU mesh.

## Core API

`src/core/map.ts` and `src/io/map-io.ts` contain the unchanged-format M0
foundation: `validateMap`, `validateDocument`, `heightAt`, `loadMap`, and
`serializeMap`. The serializer operates in memory and **does not publish**.
No editing or persistence feature should bypass document validation. Original
Godot runtime remains the final authority for map compatibility.

## Next milestones

- **M2:** sculpting and surface painting with deterministic stroke sampling,
  localized updates, bounded undo/redo, and explicit dirty state.
- **M3:** controlled file writes, multi-asset publication/recovery, and a verified
  Godot load/export roundtrip. No "Save" button before this is correct.

## Licensing

Copyright © 2026 Jason Posch. All rights reserved. Source is publicly visible
for inspection, but is not open source. See [NOTICE.md](NOTICE.md) for rights
and third-party licenses. npm package metadata uses `UNLICENSED` and `private`.
