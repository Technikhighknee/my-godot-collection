# Map System

This directory contains two distinct tools that share the same on-disk map format:

- [godot/](godot/) — the deployable Godot 4 runtime library, map files and assets.
- [editor/](editor/) — Node.js / TypeScript map-editor tooling (M0 data core; browser UI comes later).

The two directories deliberately have separate responsibilities. The Godot deploy
manifest is `godot/manifest.json`; deploying `map_system` still installs the
*contents* of `godot/` into the project's managed `packages/MapSystem/` folder,
not a nested `godot/` directory. Existing runtime paths such as
`res://packages/MapSystem/coastal_relief.map.json` remain valid.

Editor sources and npm dependencies are never installed as part of the game.
Maps remain plain JSON, single-channel EXR heightmaps and grayscale PNG surface
images. See [godot/README.md](godot/README.md) for the interchange contract.

**Copyright © 2026 Jason Posch. All rights reserved.** The repository is
public for inspection; public availability does not grant software reuse rights.
