# Strategy Camera

Camera controls for 3D strategy and city-building scenes.

Use `StrategyCamera.tscn`, or attach `StrategyCamera.gd` to a `Node3D` with a `Camera3D` child named `Camera3D`.

Required Input Map actions: `camera_left`, `camera_right`, `camera_forward`, `camera_back`.

## Controls

- WASD and screen edges: pan on the ground plane.
- Mouse wheel: change height.
- MMB horizontal/vertical movement: adjust yaw and tilt.
- RMB hold: capture pointer and pan after a configurable delay (default 250 ms).
- A short RMB click remains available for scene interactions.

Pan speed scales with camera height; close-range pan speed has a minimum. Height uses logarithmic steps. Tilt limits vary with height.

## Camera bounds

`set_bounds(Rect2)` constrains the **focus point** to a world-space X/Z rectangle.
The rectangle's X maps to world X and its Y maps to world Z. This applies to
keyboard, edge and right-mouse panning, `focus_on()`, and following a target.
Use `clear_bounds()` to allow unbounded movement again.

The camera is tilted and can still see beyond a map boundary near its edge;
bounds restrict the focus, not the entire visible frustum.

To define bounds directly in a scene, add a `Marker3D` with
`CameraBounds3D.gd` attached and configure its `size` in X/Z.
The marker provides `get_world_bounds() -> Rect2` in world coordinates;
the host scene passes that rectangle to `StrategyCamera.set_bounds()`.
This keeps individual map/interior dimensions in the host project,
while the reusable bounds component stays in the camera package.

## Ground tracking

With `ground_tracking_enabled = true` (default), a vertical physics ray at the
focus X/Z position updates the ground-relative camera reference height. This
keeps the same zoom height above rising and falling terrain. Ground elevation
is smoothed visually, and an unsuccessful raycast leaves the last known height.

Ground geometry must be on the configured `ground_collision_mask` (default:
physics layer 2, mask value 2). Give floors both their usual collision layer
and layer 2 if actors should still collide normally; e.g. a layer mask of 3
means layers 1 and 2. Keep roofs, furniture and other obstructions off layer 2.
`ground_probe_up` and `ground_probe_down` control the vertical ray reach.
Following a character tracks the character's own elevation instead.

## Following

`follow(target: Node3D)` tracks the target's position while allowing rotation and zoom. Panning, `focus_on()` or `stop_following()` ends follow mode; follow also ends when the target leaves the tree.

For an external cursor overlay, the camera emits `pointer_pan_started(anchor)` / `pointer_pan_ended(anchor)` and `pointer_rotation_started(anchor)` / `pointer_rotation_ended(anchor)` during mouse capture.

## API

- `follow(target)`, `stop_following()`, `is_following()`
- `focus_on(position, immediate = false)`
- `set_bounds(bounds: Rect2)`, `clear_bounds()`
- `set_height(height, immediate = false)`
- `get_focus_position()`, `get_height()`, `get_yaw()`, `get_tilt()`

## Defaults

| Setting | Value |
| --- | ---: |
| FOV | 45° |
| Height range | 0.35–120 |
| Initial height | 28.7135 |
| Ground probe layer | Physics layer 2 |
| Ground probe reach | 512 m up / 1024 m down |
| Wheel step | 5% of logarithmic height range |
| Tilt limits | 65° / 25° minimum (near / far), 90° maximum |
| Pan speed | 1.5 screen-heights / second |
| Edge margin | 24 px |
| RMB hold delay | 250 ms |
| Rotation sensitivity | 0.2° / px |
