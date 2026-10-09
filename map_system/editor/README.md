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

## Roads (M2)

- **Navigate:** left-drag orbit, right-drag pan, wheel zoom, `F` reset.
- **Edit roads:** select a road in the sidebar or click its ribbon. Drag highlighted points over terrain.
- **New road:** click the beginning and end on terrain; edit handles to refine it.
- **Append / Insert:** add a point at the click position (Insert requires a nearby segment).
- **Remove point / Delete road / Width:** edit the selected road.
- **Undo/Redo:** `Ctrl+Z`, `Ctrl+Shift+Z` (or `Ctrl+Y`). Up to 100 undo steps.
- **Save roads:** button or `Ctrl+S`; changes remain in memory until saved.

Saving validates the complete map and replaces **only the selected map JSON** using
an atomic same-directory rename. `.exr` and `.png` assets remain untouched.
An external change to the JSON produces a conflict instead of silently overwriting
it. Saving is available only on the loopback interface, with same-origin checks;
there is no generic file API. The map is selected only at server startup.

The terrain preview preserves Godot's mesh sample positions and triangle split;
its colors and road ribbons are approximations, not Godot's material shader or
road geometry. Object meshes are markers. EXR/PNG decoding and validation come
from the existing M0 core.

**Next:** terrain sculpting and categorical surface painting, followed by
multi-file export safety checks before allowing those assets to be saved.

Copyright © 2026 Jason Posch. All rights reserved. See [NOTICE.md](NOTICE.md).
