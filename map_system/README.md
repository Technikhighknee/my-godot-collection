# Map System

This directory contains two distinct tools sharing one on-disk map format:

- [godot/](godot/) — deployable Godot 4 runtime library, map files and assets.
- [editor/](editor/) — local Node.js / TypeScript browser tool (browser map editing with terrain sculpting, surface painting and guarded saves).

The two directories have separate responsibilities. The Godot deploy manifest
is `godot/manifest.json`; deploying `map_system` still installs the *contents*
of `godot/` into the project's managed `packages/MapSystem/` folder, not a
nested `godot/` directory. Existing runtime paths such as
`res://packages/MapSystem/coastal_relief.map.json` remain valid.

The editor and its npm dependencies are **never** installed as part of the game.
Maps remain plain JSON, single-channel FLOAT32 EXR heightmaps and grayscale PNG
surface images. See [godot/README.md](godot/README.md) for the interchange
contract and [editor/README.md](editor/README.md) to run the local editor.

**Copyright © 2026 Jason Posch. All rights reserved.** The repository is
public for inspection; public availability does not grant software reuse rights.
