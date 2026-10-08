# Strategy Camera

An opinionated 3D strategy / city-builder camera for Godot 4.

## Setup

Attach `StrategyCamera.gd` to a `Node3D` with a direct `Camera3D` child named `Camera3D`:

```text
StrategyCamera
└── Camera3D
```

The script makes that camera current during `_ready()`.

Add these Input Map actions:

- `camera_left`
- `camera_right`
- `camera_forward`
- `camera_back`

The script asserts during `_ready()` if any required action is missing. As with Godot assertions generally, that check only exists in builds where assertions are enabled.

## Controls

- **WASD** — pan relative to camera yaw.
- **Screen edges** — pan using the same movement model at full speed.
- **Mouse wheel** — lower or raise camera height.
- **MMB horizontal** — rotate yaw.
- **MMB vertical** — change tilt.
- **RMB click** — ignored by the camera and left available to gameplay.
- **RMB hold** — after 120 ms, capture the pointer and pan.

RMB panning, MMB rotation, WASD and edge scrolling are mutually exclusive where necessary; pointer capture is restored cleanly when the interaction ends, the window loses focus, or the camera leaves the scene tree.

## Camera model

The `StrategyCamera` node represents the current ground focus. The `Camera3D` sits vertically above that focus at the current height.

Wheel input changes height only. It does not move the focus toward the cursor and does not perform a radial dolly.

Tilt uses this convention:

- `0°` — straight down.
- `90°` — straight ahead at the horizon.
- Minimum tilt — `65°` at minimum height, opening to `25°` at maximum height.
- Maximum tilt — always `90°`.

Vertical rotation is stored as a normalized position inside the currently valid tilt range. Because only the minimum changes with height, zooming naturally shifts the available view from close/forward toward far/top-down without a separate camera-arc state.

Height input is logarithmic. Each wheel step moves 5% through the `0.35–120` height range, so the steps retain similar perceptual weight across the range.

## Panning

WASD, edge scrolling and RMB panning all use the same yaw-relative ground axes.

All panning modes use one shared pan scale derived from camera height and FOV. Below `12` units of camera height, that scale stops shrinking so close zoom remains responsive instead of turning WASD, edge scrolling, and RMB dragging into slow motion.

RMB is intentionally click-safe. Pressing and releasing before the 120 ms hold delay does nothing to the camera and is not consumed. Once the hold activates, the pointer is captured and relative mouse motion drives the pan.

Actual RMB pan movement breaks target following. Merely pressing or holding RMB does not.

## Following

`follow(target)` binds the camera focus directly to a `Node3D`'s world position. The target owns translation while camera height and rotation remain independently controllable.

Starting follow:

- requires a valid target that is already inside the scene tree;
- rejects the camera itself and its descendants;
- immediately moves the focus to the target;
- points yaw toward the target from the previous focus when there is a horizontal direction to use;
- resets tilt to the current minimum.

While following, MMB rotation and wheel height changes remain available.

Follow ends when:

- WASD moves the camera;
- edge scrolling moves the camera;
- RMB panning actually moves the camera;
- `focus_on(...)` is called;
- `stop_following()` is called;
- the target leaves the scene tree.

Ending follow keeps the camera at its current world focus; there is no return position or stored follow offset.

## Custom cursor integration

The camera does not own or render cursors.

By default, Godot's captured pointer mode hides the system cursor during RMB panning and MMB rotation. Games with their own software cursor can keep that cursor visually pinned by listening to:

```gdscript
pointer_pan_started(anchor: Vector2)
pointer_pan_ended(anchor: Vector2)

pointer_rotation_started(anchor: Vector2)
pointer_rotation_ended(anchor: Vector2)
```

Each start signal provides the cursor position at the moment that interaction takes over. An external cursor system can freeze its visual at that anchor and resume normal tracking on the matching end signal.

## API

### `follow(target: Node3D) -> void`

Bind the ground focus to a moving target.

### `stop_following() -> void`

Stop following without moving the current focus.

### `is_following() -> bool`

Return whether a valid target is currently being followed.

### `focus_on(position: Vector3, immediate := false) -> void`

Move the ground focus to a world position. Calling it also ends target following.

With `immediate = false`, the camera moves toward the new focus using the normal movement smoothing.

### `set_height(height: float, immediate := false) -> void`

Set the target camera height, clamped to the supported range.

With `immediate = false`, the height change uses the normal height smoothing.

### `get_focus_position() -> Vector3`

Return the current, already-smoothed focus position.

### `get_height() -> float`

Return the current, already-smoothed camera height.

### `get_yaw() -> float`

Return yaw in degrees.

### `get_tilt() -> float`

Return the current tilt in degrees.

## Defaults

| Setting | Value |
| --- | ---: |
| Height range | `0.35–120` |
| Initial height | `28.7135` |
| Wheel step | `5%` of logarithmic height range |
| Near minimum tilt | `65°` |
| Far minimum tilt | `25°` |
| Maximum tilt | `90°` |
| Pan speed | `1.5` screen-heights / second |
| Minimum pan scale | equivalent to `12` units camera height |
| Edge scroll margin | `24 px` |
| RMB hold delay | `120 ms` |
| Mouse yaw sensitivity | `0.2° / px` |
| Mouse tilt sensitivity | `0.2° / px` |
