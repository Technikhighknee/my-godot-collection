# Strategy Camera

Camera controls for 3D strategy and city-building scenes.

Use `StrategyCamera.tscn`, or attach `StrategyCamera.gd` to a `Node3D` with a `Camera3D` child named `Camera3D`.

The scene contains three internal components:

- `components/CameraInput.gd` handles mouse capture, input events, hold-to-pan and edge scrolling.
- `components/CameraMovement.gd` owns focus, height, rotation, interpolation, following and bounds.
- `components/CameraGroundTracker.gd` samples ground height on the configured collision mask.

`StrategyCamera.gd` preserves the public API and exported settings; other systems should only talk to this facade. The components are supplied automatically when the camera script is attached directly rather than instantiated from the scene.

Required Input Map actions: `camera_left`, `camera_right`, `camera_forward`, `camera_back`.

## Controls

- WASD and screen edges: pan on the ground plane.
- Mouse wheel: change height when `zoom_enabled = true` (default). Disable it on fixed-height cameras, such as interiors.
- MMB horizontal/vertical movement: adjust yaw and tilt.
- RMB hold: capture pointer and pan after a configurable delay (default 250 ms).
- A short RMB click remains available for scene interactions.

For a fixed-height camera, set `zoom_enabled = false` and initialize the desired ground-relative height once with `set_height(height, true)`. Keyboard/mouse panning, rotation, ground tracking and the ceiling limit still work. The height remains configurable by game code, but cannot be changed with the mouse wheel.

Pan speed scales with camera height; close-range pan speed has a minimum. Height uses logarithmic steps. Tilt limits vary with height. The exported `near_min_tilt_degrees` and `far_min_tilt_degrees` can be tuned per camera instance (for example, a more top-down camera inside a compact room).

## Camera bounds

`set_bounds(Rect2)` restricts the camera's **focus point** to a world-space
X/Z rectangle (Rect2 X → world X; Rect2 Y → world Z). It applies to keyboard,
edge and right-mouse panning, `focus_on()`, and following. Use
`clear_bounds()` to remove the X/Z limit. The frustum can still extend beyond
these focus limits, especially at shallow angles.

The optional **camera ceiling** limits the camera's actual world-space Y,
independently of its viewing angle. Use `set_ceiling_y(world_y)` to set an
absolute ceiling or `clear_ceiling()` to remove it. `max_height` remains the
ordinary maximum zoom height above the current ground reference (120 m by
default). The effective zoom limit is whichever is lower: `max_height` or
the distance from the current focus height to the ceiling.
`get_effective_max_height()` returns that distance, capped to the supported
zoom range. Rotation does not change the ceiling or force a new zoom level.

In a scene, add a `Marker3D` with `CameraBounds3D.gd`. Its `size` gives the
X/Z rectangle. For an interior, set `ceiling_path` to a ceiling `Node3D`
(for example, `../Structure/Ceiling`). The bounds marker reads the ceiling's
global Y and subtracts `ceiling_clearance` (default: 0.5 m). No numerical
height has to be configured for each room. Omitting the path means there is
no vertical ceiling, as in an exterior map.

The host scene passes `get_world_bounds()` and `get_camera_ceiling_y()` to
the camera's corresponding setters. A missing ceiling resolves to `INF`,
which clears the vertical restriction. This leaves the reusable camera unaware
of the game's buildings and room layout.

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
- `set_ceiling_y(world_y: float)`, `clear_ceiling()`, `get_effective_max_height()`
- `set_height(height, immediate = false)`
- `get_focus_position()`, `get_height()`, `get_yaw()`, `get_tilt()`

## Defaults

| Setting | Value |
| --- | ---: |
| FOV | 45° |
| Height range | 0.35–120 m (optional world-space ceiling) |
| Initial height | 28.7135 |
| Ground probe layer | Physics layer 2 |
| Ground probe reach | 512 m up / 1024 m down |
| Wheel step | 5% of logarithmic height range |
| Tilt limits | 65° / 25° minimum (near / far), 90° maximum |
| Pan speed | 1.5 screen-heights / second |
| Edge margin | 24 px |
| RMB hold delay | 250 ms |
| Rotation sensitivity | 0.2° / px |
