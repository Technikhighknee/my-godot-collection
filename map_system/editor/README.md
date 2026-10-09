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
