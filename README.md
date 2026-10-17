# my-godot-collection

Some Godot bits and bobs.

## Collection

- [Strategy Camera](strategy_camera/) — 3D strategy / city-builder camera.
- [Selection System](selection_system/) — selection, marquee, and right-click targeting for 3D world objects.
- [Movement System](movement_system/) — ground navigation and walking for 3D characters.
- [Action System](action_system/) — available measures, target requirements, and execution lifecycle.
- [Inventory System](inventory_system/) — slot-based storage, atomic transfers and multi-item batch transactions; capacities supplied by the game.
- [Building System](building_system/) — persistent building identities, placements, generic properties and installed upgrade levels.
- [Production System](production_system/) — persistent production stations, queued jobs, work progress and inventory-backed material handling.
- [Place System](place_system/) — independent 3D rooms, persistent actors, cross-room travel, portals and interior display.
- [Character System](character_system/) — identities, mandatory first/last names, optional parents/spouses and live PlaceActor binding; no Family system.
- [Dynasty System](dynasty_system/) — regular and shadow dynasties, exclusive membership and shared treasury.
- [Ownership System](ownership_system/) — dynasty, city or unowned buildings; separate dynasty-member assignment.

## Deploy tool

>You're probably thinking, “Jason... why don't you just copy them by hand?”
>No. That primitive act of manually moving files is personally insulting to me. I need manifest files, byte-by-byte comparison, selective conflict resolution, and atomic writes.

Each deployable Godot package declares its files in its own `manifest.json`. The project manifest
chooses the installed folder names, and `deploy.py` installs **entire packages** into
`packages/` next to the project manifest:

```json
{
  "packages": {
    "strategy_camera": "StrategyCamera",
    "selection_system": "SelectionSystem",
    "movement_system": "MovementSystem",
    "action_system": "ActionSystem",
    "inventory_system": "InventorySystem",
    "place_system": "PlaceSystem",
    "character_system": "CharacterSystem",
    "dynasty_system": "DynastySystem",
    "ownership_system": "OwnershipSystem",
    "building_system": "BuildingSystem",
    "production_system": "ProductionSystem"
  }
}
```

Running:

```powershell
python .\tools\deploy.py C:\Users\posch\Documents\1400\manifest.json -y
```

installs `packages/StrategyCamera/`, `packages/SelectionSystem/`,
`packages/MovementSystem/`, `packages/ActionSystem/`, `packages/InventorySystem/`,
`packages/PlaceSystem/`, `packages/CharacterSystem/` and
`packages/DynastySystem/` and `packages/OwnershipSystem/` in that Godot project.
Names and casing come from the values in the manifest; the keys identify repository packages.
Manifest values are single folder names, not arbitrary paths. Files in the package are
installed with their internal relative layout intact.

**Owned directories:** the installed package folders are disposable copies, not workspaces.
The installer stages a complete replacement, saves the entire existing folder as a ZIP under
`~/.my-godot-collection/backups/` (outside the Godot project), and then swaps the directory.
Local edits and extra files are preserved **in that backup**, not mixed with the new package.
`-y` skips confirmation but NEVER skips backups. If preparation or backup fails, nothing is
replaced; a swap failure attempts to restore the previous directory.

On the first new-style deploy, an older `StrategyCamera/` folder next to the project
manifest is also backed up and retired to avoid duplicate Godot `class_name`
declarations. Other project folders are untouched. Update game paths from
`res://StrategyCamera/...` to `res://packages/StrategyCamera/...`.

For a single package, you can still supply its **exact managed folder** directly:

```powershell
python .\tools\deploy.py strategy_camera C:\Projects\Game\packages\StrategyCamera -y
```

A missing `-y` prompts once before replacing directories. This is an intentionally
opinionated installer, not a per-file synchronizer. Do not use a project root as a destination.

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
