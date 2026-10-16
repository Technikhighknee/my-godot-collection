# Place System — executable Godot test project

A standalone Godot 4.4+ sandbox using the **actual** packages in this repo,
not a mockup. The scene files are reusable room templates; each building
receives independent live instances of them.

## Setup (Windows / PowerShell)

From the **repository root**, on branch `feat/gameplay-systems`:

```powershell
python .\tools\deploy.py .\examples\place_system_demo\manifest.json -y
```

Then open `examples/place_system_demo/project.godot` with Godot 4.4+
and press **F6/F5** to run `scenes/main.tscn`. The first editor import
may be necessary to register the packages' `class_name` scripts.

You can alternatively run the same project from a terminal:

```powershell
godot --path .\examples\place_system_demo
```

The deploy command uses the repository's existing package manager. It puts
**copies** of PlaceSystem, MovementSystem, ActionSystem, InventorySystem,
and SelectionSystem under the demo project's `packages/` directory.
Generated/deployed packages are ignored by version control in the demo.

## Scenes

```text
scenes/
  main.tscn       Outer scene, PlaceManager3D and RoomView HUD
  exterior.tscn   Small town, two tavern fronts and exterior door portals
  hall.tscn       Reused by BOTH taverns; hall with door to kitchen
  kitchen.tscn    Reused by BOTH taverns; door back to hall
  actor.tscn      Persistent identity, ActionController, Inventory, Traveler
  body.tscn       CharacterBody3D, MovementAgent3D and SelectionTarget3D
```

The layouts use primitive meshes, static floor collision and explicit
navigation polygons (built by `scripts/walkable.gd`). They are test geometry,
not game-ready assets or navmesh baking workflows.

## Demonstration

There are two buildings:

- **Tavern A:** `a_hall`, `a_kitchen`
- **Tavern B:** `b_hall`, `b_kitchen`

Both halls instantiate **the same** `hall.tscn`. Both kitchens instantiate
**the same** `kitchen.tscn`, but every physical world and gameplay instance
is distinct.

Each tavern starts with a persistent worker in its hall. The worker runs
real `ActionController` executions on a Timer and uses `Inventory.add()`
to produce test goods. Its gameplay logic is not inside a viewable room.

The on-screen HUD shows per-worker location, goods, completed jobs and
travel state. Switch views between outside, the halls and kitchens and
verify that BOTH goods counts continue rising.

Kitchen portals start **locked** independently for each tavern. Use
**Unlock A kitchen** or **Unlock B kitchen** to open that building's portal
connection. The locked kitchen instance already exists in this test, but
the route graph prevents entry until unlocked.

**A → kitchen** commands cross-room travel. **A → outside** lets a
character walk back to the exterior. With kitchen unlocked, issue
Outside then Kitchen to demonstrate the full exterior → hall → kitchen
portal route. B has equivalent controls.

Click a physical worker to select it, then right-click navigable floor
in the current view to issue a regular movement command, not an Action.
The scene's SelectionSystem provides targets and ground clicks; the
PlaceTraveler owns the movement order.

The simple work action can overlap with a user-requested travel; this is
intentionally just an integration workload. Exclusive work/travel rules
are game-defined and should be added when implementing actual production.

## Automated smoke test

After installing packages:

```powershell
godot --headless --path .\examples\place_system_demo --script res://scripts/smoke_test.gd
```

The script checks:
- Four unique interior runtime instances, with separate navigation maps.
- Two persistent characters with distinct physical bodies.
- Two working ActionController/Inventory processes in unseen rooms.
- Kitchen portal upgrades affect only the intended building.
- Actor identity and inventory survive hall → kitchen and
  kitchen → hall → exterior journeys.

Exit code `0` means the test passed. On failure it logs a clear diagnostic
and exits with a nonzero code.

## Boundaries

This is deliberately not a full 1400 game or a benchmark. It does not
save/load, implement actual tavern production, or instantiate hundreds of
interiors. To validate performance at large scale, extend the demo after
the basic behavior is proven.

**Important:** The scene files and script links are authored and checked
statically. The project has not yet been executed in a Godot runtime by
the assistant. Any Godot import or runtime errors should be corrected
before treating the architecture as verified.
