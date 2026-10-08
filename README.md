# my-godot-collection

Some Godot bits and bobs.

## Collection

- [Strategy Camera](strategy_camera/) — 3D strategy / city-builder camera.
- [Map System](map_system/) — portable maps, road geometry, and runtime building placement.

## Deploy tool

>You're probably thinking, “Jason... why don't you just copy them by hand?”
>No. That primitive act of manually moving files is personally insulting to me. I need manifest files, byte-by-byte comparison, selective conflict resolution, and atomic writes.

Each package declares its files in its own `manifest.json`. The project manifest
chooses the installed folder names, and `deploy.py` installs **entire packages** into
`packages/` next to the project manifest:

```json
{
  "packages": {
    "strategy_camera": "StrategyCamera",
    "map_system": "MapSystem"
  }
}
```

Running:

```powershell
python .\tools\deploy.py C:\Users\posch\Documents\1400\manifest.json -y
```

installs `packages/StrategyCamera/` and `packages/MapSystem/` in that Godot project.
Names and casing come from the values in the manifest; the keys identify repository packages.
Manifest values are single folder names, not arbitrary paths. Files in the package are
installed with their internal relative layout intact.

**Owned directories:** the installed package folders are disposable copies, not workspaces.
The installer stages a complete replacement, saves the entire existing folder as a ZIP under
`~/.my-godot-collection/backups/` (outside the Godot project), and then swaps the directory.
Local edits and extra files are preserved **in that backup**, not mixed with the new package.
`-y` skips confirmation but NEVER skips backups. If preparation or backup fails, nothing is
replaced; a swap failure attempts to restore the previous directory.

On the first new-style deploy, the older `MapSystem/` and `StrategyCamera/` folders next
to the project manifest are also backed up and retired to avoid duplicate Godot `class_name`
declarations. Other project folders are untouched. Update any game paths from
`res://MapSystem/...` to `res://packages/MapSystem/...` and likewise for the camera.

For a single package, you can still supply its **exact managed folder** directly:

```powershell
python .\tools\deploy.py map_system C:\Projects\Game\packages\MapSystem -y
```

A missing `-y` prompts once before replacing directories. This is an intentionally
opinionated installer, not a per-file synchronizer. Do not use a project root as a destination.

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
