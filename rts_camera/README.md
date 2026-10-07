# RTS Camera

A compact RTS / city-builder camera for Godot 4.

## Current core

- Camera-relative WASD panning through configurable Input Map actions.
- Pan speed scales with zoom.
- Framerate-independent movement, zoom and programmatic rotation smoothing.
- Right-mouse world dragging with no pixel sensitivity constant.
- Middle-mouse yaw and pitch rotation.
- Two rotation modes:
  - `LOOK` (default): the camera stays in place and the focus moves across the ground, like binoculars.
  - `ORBIT`: the focus stays in place and the camera moves around it.
- Multiplicative, high-precision-aware wheel zoom.
- Cursor-anchored zoom.
- Optional focus bounds or view-aware bounds.
- Optional UI-aware edge scrolling with a soft speed ramp near the viewport edge.
- Keyboard panning is suppressed while a text-editing Control owns GUI focus.
- Transient drag/rotate/zoom state is cleared when the game window loses focus.
- Small programmatic API: `focus_on()`, `zoom_to()`, `rotate_to()`, `snap()`.

Ground resolution is centralized. The default is a zero-cost horizontal plane, while Physics Ground can follow real terrain without changing drag, LOOK, zoom anchoring or bounds logic.

## Setup

Add these Input Map actions:

- `camera_left`
- `camera_right`
- `camera_forward`
- `camera_back`

The included demo registers WASD for these actions at runtime.

Instantiate `RTSCamera.tscn`. Its root position is the initial world focus. The Camera3D child transform does not need to be configured; the controller derives it from focus, zoom, yaw and pitch.

Default mouse controls:

- Middle mouse: rotate yaw and pitch using the selected rotation mode.
- Right mouse: grab and drag the world.
- Wheel: cursor-anchored zoom.

## Rotation modes

`LOOK` keeps the camera's world position fixed while rotating. The new focus is the intersection of the view direction with the ground plane. Because zoom remains a hard distance constraint, the usable pitch range becomes narrower automatically at extreme zoom distances rather than silently moving the camera.

`ORBIT` keeps the focus fixed while yaw and pitch move the camera around it.

Direct mouse rotation is intentionally unsmoothed. Programmatic `rotate_to()` uses `rotation_smoothing`, and direct player input cancels an in-progress automatic LOOK rotation.

## Ground modes

`PLANE` is the default and resolves all camera/world interaction against the horizontal `ground_height` plane. It stays render-frame driven and requires no physics world.

`PHYSICS` resolves camera/world interaction through 3D ray queries. Because Godot only guarantees direct physics-space queries to be safe during `_physics_process()` when threaded physics is in use, the camera automatically performs its update on the physics path in this mode. Input events are buffered in order and consumed there, so RMB dragging, MMB LOOK/ORBIT and cursor zoom never query a potentially locked physics space.

For Physics Ground:

- Put valid camera surfaces on the layers selected by `ground_collision_mask`.
- Prefer a dedicated collision layer for terrain/walkable camera surfaces.
- `ground_required_group` can optionally add semantic filtering. If set, hits whose collider is not in that group are skipped and the ray continues behind them, up to `ground_max_skips`.
- `ground_probe_up` and `ground_probe_down` define the vertical probe used to keep the logical focus attached to terrain while panning.
- `ground_query_distance` limits arbitrary view rays.
- `ground_collide_with_areas` is off by default so trigger volumes do not become camera ground accidentally.

The public `resolve_ground_ray()` method is the single ground-contact path used internally by screen picking, LOOK rotation and view-footprint bounds. This keeps the interaction semantics consistent instead of having separate terrain logic in each feature.

## Bounds

Bounds are disabled by default and use a `Rect2` in world X/Z coordinates.

`FOCUS` bounds only constrain the logical focus point.

`VIEW` bounds constrain the actual ground footprint visible through the perspective camera. The footprint is derived from zoom, pitch, yaw, FOV, keep-aspect mode and the current viewport aspect ratio. When the visible footprint is larger than the configured bounds on an axis, it is centered on that axis instead of oscillating between opposite edges.

Bounds are the final spatial constraint: at an edge they intentionally take priority over exact cursor anchoring and LOOK eye preservation. Standard perspective Camera3D projection is supported by the view-footprint solver; unsupported projection customizations fall back to focus bounds rather than producing incorrect geometry.

`get_visible_ground_rect()` exposes the current finite ground footprint when available; `has_finite_ground_footprint()` reports whether that footprint is valid.

## Edge scrolling

Edge scrolling is disabled by default. When enabled, it feeds the same camera-relative pan pipeline as WASD instead of maintaining a second movement implementation.

It automatically stops while the window is unfocused, while the camera is being dragged or rotated, during a Godot GUI drag operation, and while the pointer is over a Control unless `edge_scroll_over_gui` is enabled. The edge strength ramps smoothly according to `edge_scroll_curve`, so movement does not switch from zero to full speed at a single pixel boundary.

Invalid min/max relationships are normalized once on startup so malformed Inspector values cannot leave the controller in an impossible state.

## Defaults

The defaults assume Godot's normal metric 3D scale, where one world unit is one meter:

- Initial pitch: 50 degrees.
- Pitch range: 25 to 75 degrees.
- Perspective FOV: 45 degrees.
- Initial zoom: 30 m.
- Minimum zoom: 5 m.
- Maximum zoom: 120 m.
- Pan speed: 4 m/s close to 110 m/s at maximum zoom.
- Movement smoothing: 16.
- Zoom factor: 0.85 per wheel unit.
- Zoom smoothing: 18.
- Mouse yaw sensitivity: 0.2 degrees/pixel.
- Mouse pitch sensitivity: 0.2 degrees/pixel.
- Rotation smoothing: 18.
- Edge scroll margin: 24 px.
- Edge scroll curve: 2.0.
