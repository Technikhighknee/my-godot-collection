# my-godot-collection

Some Godot bits and bobs.

## Collection

- [Strategy Camera](strategy_camera/) — deployable Godot 3D strategy / city-builder camera.
- [Map format examples](map_system/) — portable JSON, EXR and PNG map sources for the offline Dev Tool. **Not a Godot runtime package.**
- [Dev Tool](dev_tool/) — Node.js/Three.js project workspace, procedural assets, maps and offline Godot export.

## One map production path

Map source documents belong to the Dev Tool. It generates finished
`terrain.glb`, `roads.glb` and `water.glb` offline and publishes a Godot scene.
The game consumes those imported resources; it does not install a separate
`MapSystem` script package or construct terrain from JSON at runtime.

See [Dev Tool architecture](dev_tool/ARCHITECTURE.md) and
[map format](map_system/README.md).

## Deploy tool

The installer is for **deployable Godot packages**, currently Strategy Camera.
It operates on complete manifest-owned package folders; it is not used for
Dev Tool maps, procedural textures, models or generated Godot scene exports.

Example project manifest:

```json
{
  "packages": {
    "strategy_camera": "StrategyCamera"
  }
}
```

```powershell
python .\tools\deploy.py C:\Projects\Game\manifest.json -y
```

The installer creates `packages/StrategyCamera/`, backs up any previously
installed managed package under `~/.my-godot-collection/backups/`, and then
atomically replaces it. The `-y` flag skips confirmation, **not** backups.
Don't use a Godot project root as a direct destination.

When upgrading an existing Godot project that previously installed the
retired `MapSystem` scripts, remove its old `packages/MapSystem/` directory
manually after backing up your project; this installer no longer deploys that
package. Generated scenes from the Dev Tool do not depend on it.

## Godot scene and resource files

For `.tscn` and `.tres` files authored outside the Godot editor, use
**relative paths** for references to files within the same package, so the
project manifest can freely choose the installed folder name. Keep
`ExtResource` and `SubResource` IDs local and unique within their file.
Do **not** invent `uid="uid://..."` values or node `unique_id` values.
If globally stable resource UIDs are needed, let Godot generate them and
commit its real metadata. Godot may rewrite relative paths to `res://` paths
when it saves a scene in the editor; check before committing that change
back into a relocatable package.


---

## Repository Notice

This repository is mainly for me.

I put stuff here because GitHub is convenient, version control is useful, and apparently saving random code in folders called `final_final_v2_really_final` is considered bad practice.

Why is the repo public?

Free CI, baby!

**Yes, the repository is public.**

**Yes, you can see the code.**

**No, that does not magically make it open source.**

A fair amount of the code in here was written with AI assistance, and there are parts I have not even properly read myself. So before you consider using any of this in something important (which, licensing-wise, you don't have permission to do in the first place), please remember that I am apparently comfortable publishing code that I have occasionally inspected with the rigorous engineering methodology known as "looks fine to me."

[MSG from several-hours-older-Jason: I did eventually read it. Calm down.]

[MSG from that same Jason: Also, my job here is not to manually type every implementation detail. I design the systems, make the decisions, review the results, reject the stupid versions, and decide what actually ships. AI does a lot of the implementation work. That's the arrangement. Somehow, it works out.]

You are welcome to look around.

You may learn something.

You may find something useful.

You may also find something deeply questionable that survived because it happened to work once.

Such is software.

Anyway, because visibility and permission are two completely different things:

## Copyright and Usage Notice

**Copyright © 2026 Jason Posch. All rights reserved.**

The source code in this repository is publicly available for inspection.

Except for rights arising from GitHub's Terms of Service and GitHub's platform functionality, no license or permission is granted to use, copy, modify, distribute, sublicense, sell, incorporate into another work, or create derivative works from this software without prior written permission from Jason Posch.

This repository is not open-source software. Its public availability does not grant permission to use the software.
