# Selection System

Selection of 3D scene objects, including click targeting, additive selection and marquee selection.

## Scene setup

Attach `SelectionSystem` to a `Node`. Optionally assign a `Camera3D`; otherwise it uses the viewport's current camera.

Selectable objects need a `SelectionTarget3D` (`Area3D`) with a `CollisionShape3D`. Defaults:

- Selection targets: collision layer `2`.
- World/terrain colliders: collision layer `1`.
- Target's subject: its parent `Node3D`, overridable through `subject`.
- Marquee position: target's position, overridable through `marquee_anchor`.

Collision masks, maximum ray distance and drag threshold are configurable.

## Input

- Left click: select an object; clicking empty space clears selection.
- Shift/Ctrl + click: add or toggle eligible subjects.
- Left drag: marquee-select subjects whose anchors fall inside the screen rectangle.
- Right click with a selection: emit `target_requested` for a target or `location_requested` for a world hit.

`selectable_filter(subject)` optionally restricts selection. `multi_select_filter(subject)` enables multi-selection for eligible subjects. Selected nodes are removed automatically when they leave the scene tree.

Right-click targeting cooperates with the Strategy Camera's hold-to-pan pointer capture.

## API

`select(subject, additive = false)`, `clear_selection()`, `get_selection()`, `has_selection()`.

Signals: `selection_changed(selection)`, `target_requested(target)`, `location_requested(position)`, `marquee_changed(rect, active)`.

`get_selection()` returns a copy. The marquee signal can drive a selection-rectangle overlay.
