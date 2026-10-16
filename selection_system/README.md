# Selection System (Godot 4)

Select world objects and report right-click destinations. No UI, movement,
orders, or ownership database.

## Setup

1. Deploy `selection_system` with `tools/deploy.py` like other packages.
2. Attach `SelectionSystem.gd` to a `Node` in the gameplay scene, optionally
   assign a `Camera3D` (otherwise the viewport's current camera is used).
3. Add a `SelectionTarget3D` (`Area3D`) with a `CollisionShape3D` to every
   selectable object. Set its collision layer to **2** and its collision mask
   to **0**. By default its subject is its `Node3D` parent; set `subject`
   explicitly for nested layouts. Put the target at the desired marquee anchor
   or assign `marquee_anchor`.
4. Put terrain / walkable world colliders on collision layer **1**. The two
   ray masks are independently configurable.

Example hierarchy:

```text
Citizen (CharacterBody3D)         House (StaticBody3D)
  SelectionTarget3D (Area3D)         SelectionTarget3D (Area3D)
    CollisionShape3D                   CollisionShape3D
```

## Game-owned rules

All valid targets can be **single-selected** unless `selectable_filter` is
provided and rejects the subject. **Multi-selection is opt-in**: assign
`multi_select_filter`, a `Callable` receiving the subject and returning bool.

A game with ownership can use a callback equivalent to:

```gdscript
selection_system.multi_select_filter = func(subject: Node3D) -> bool:
    return game_rules.is_locally_owned_unit(subject)
```

That policy excludes foreign units and buildings from Shift/Ctrl additions
and from marquee selection. It also prevents mixing a foreign single selection
with owned units. The selection package neither owns nor caches ownership.
Change the callback or call `clear_selection()` when game rules change.

## Input

- Left click: replace selection; empty world click: clear it.
- Shift/Ctrl + left click: add or toggle where multi-selection rules permit.
  An ineligible addition leaves the current selection alone.
- Left drag: select eligible targets whose **marquee anchors** fall within the
  screen rectangle. Shift/Ctrl + drag adds to an existing eligible selection.
  Drag does not automatically draw a rectangle.
- Right click (not a camera pan) with a nonempty selection: `target_requested(subject)`
  when a selectable marker is hit; otherwise `location_requested(world_position)`
  when a world collider is hit. Nothing is emitted without a selection.
  A right click never changes the selection.

The system reads selection and right-button presses in `_unhandled_input`
(so UI can consume those presses first), but observes right-button release
in `_input` before StrategyCamera can consume it. Releases over GUI controls
are ignored. Physics picking runs in `_physics_process`. It sends `marquee_changed(rect, active)` for an optional UI
overlay. World-location targeting requires a world collider; it doesn't invent
a ground plane. Marquee selection is screen-anchor based, not a 3D volume or
occlusion test.

## Strategy Camera integration

`StrategyCamera` captures the pointer after its configurable RMB hold delay
(default 250 ms) to pan. The selection system recognizes a right click only
if the pointer was **not** captured and the mouse was not dragged; it never
imposes another time limit or consumes RMB events. Release is observed before
the camera handles it.

## API

- `select(subject: Node3D, additive := false)`
- `clear_selection()`
- `get_selection() -> Array[Node3D]` (returns a copy)
- `has_selection() -> bool`
- `selectable_filter: Callable` (optional, applies to selection)
- `multi_select_filter: Callable` (required for multi-selection)

Signals:

- `selection_changed(selection: Array[Node3D])`
- `target_requested(target: Node3D)`
- `location_requested(position: Vector3)`
- `marquee_changed(rect: Rect2, active: bool)`

Selected objects are removed automatically when they leave the scene tree.
No gameplay commands or ownership data are stored here.
