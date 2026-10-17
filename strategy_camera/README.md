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

## Following

`follow(target: Node3D)` tracks the target's position while allowing rotation and zoom. Panning, `focus_on()` or `stop_following()` ends follow mode; follow also ends when the target leaves the tree.

For an external cursor overlay, the camera emits `pointer_pan_started(anchor)` / `pointer_pan_ended(anchor)` and `pointer_rotation_started(anchor)` / `pointer_rotation_ended(anchor)` during mouse capture.

## API

- `follow(target)`, `stop_following()`, `is_following()`
- `focus_on(position, immediate = false)`
- `set_height(height, immediate = false)`
- `get_focus_position()`, `get_height()`, `get_yaw()`, `get_tilt()`

## Defaults

| Setting | Value |
| --- | ---: |
| FOV | 45° |
| Height range | 0.35–120 |
| Initial height | 28.7135 |
| Wheel step | 5% of logarithmic height range |
| Tilt limits | 65° / 25° minimum (near / far), 90° maximum |
| Pan speed | 1.5 screen-heights / second |
| Edge margin | 24 px |
| RMB hold delay | 250 ms |
| Rotation sensitivity | 0.2° / px |
