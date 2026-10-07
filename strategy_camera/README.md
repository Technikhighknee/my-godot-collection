# Strategy Camera

A flexible 3D strategy / city-builder camera rig for Godot 4.

## Core behavior

- Camera-relative WASD panning through configurable Input Map actions.
- Optional soft edge scrolling through the same pan pipeline.
- Right-mouse grab-and-drag world movement.
- Middle-mouse LOOK or ORBIT rotation.
- Multiplicative wheel zoom with cursor anchoring when a stable ground point exists.
- A height-based zoom rig that becomes more forward-looking when close and more top-down when far away.
- Plane or Physics Ground resolution through one shared ground-contact path.
- Optional focus bounds or finite-view bounds.
- Manual render interpolation for Physics Ground mode.
- Direct pointer modes are exclusive and recover cleanly from lost/consumed releases.

## Setup

Add these Input Map actions:

- `camera_left`
- `camera_right`
- `camera_forward`
- `camera_back`

The included demo registers WASD for these actions at runtime.

Instantiate `StrategyCamera.tscn`. Its root position is the logical ground-navigation focus. The Camera3D child transform does not need to be configured manually.

Default mouse controls:

- Middle mouse: rotate using the selected rotation mode.
- Right mouse: grab and drag the world.
- Wheel: zoom.

Middle-mouse rotation captures the pointer by default so rotation is not limited by the window edge. The previous mouse mode and cursor position are restored afterward.

## Camera model

The controller separates three concepts:

1. Ground-navigation focus.
2. Physical camera rig.
3. Viewing direction.

This prevents free look, zoom geometry and terrain navigation from corrupting each other's state.

### Zoom path

`zoom` is the height parameter of the camera's natural zoom arc.

With no manual ORBIT pitch offset, this is the physical camera height above the ground-navigation focus. The natural pitch converts that height into a rig radius around the raised target.

The defaults are:

- Initial natural height: 30 m.
- Minimum natural height: 5 m.
- Maximum natural height: 120 m.

Manual ORBIT pitch does not change that radius. It moves the eye around the same sphere for the current zoom value, so rotating vertically cannot masquerade as a zoom operation. The actual eye height is therefore allowed to differ from the natural zoom height while ORBIT is offset.

Wheel zoom is multiplicative. The normalized zoom ratio is logarithmic as well, so equal multiplicative wheel steps move through the camera curve consistently.

### Zoom arc

The natural rig pitch changes with zoom height:

- `near_pitch`: 25 degrees.
- `far_pitch`: 65 degrees.
- `zoom_arc_curve`: 0.75.

The logarithmic zoom ratio is smoothstep-eased and then shaped by `zoom_arc_curve`. Close views therefore become lower and more forward-looking while distant views become more top-down, without a linear mechanical tilt.

### Raised rig target

The navigation focus stays on the ground, but the natural camera rig aims at a point `rig_target_height` above it.

Default:

- `rig_target_height = 1.5` m.

This prevents close camera poses from staring directly at the ground. In the natural, un-offset rig pose, the physical camera eye is exactly `zoom` units above the ground focus.

## Rotation modes

### LOOK

LOOK rotates only the viewing direction.

LOOK changes the viewing direction without moving the camera eye or ground focus.

The user input is stored as a yaw/pitch offset relative to the natural rig direction. That distinction is important: the offset survives, but the zoom arc continues underneath it. If zoom changes the natural rig pitch by 20 degrees, the viewed pitch also changes by 20 degrees unless it reaches the configured free-look limit.

Free look can still point toward the horizon or sky:

- `min_look_pitch = -85` degrees.
- `max_look_pitch = 85` degrees.

This keeps manual looking and the zoom arc composable instead of making the first LOOK input permanently disable the arc.

`reset_look()` smoothly returns the offsets to zero and reattaches the view to the natural rig direction.

### ORBIT

ORBIT keeps the view attached to the rig and rotates the rig around its raised target above the ground focus.

For a fixed zoom value, ORBIT rotates on a constant radius. Vertical rotation therefore changes elevation and horizontal position but not camera distance to the rig target.

Vertical ORBIT input is stored as an offset from the natural zoom-arc pitch, so later zooming still retains the characteristic camera curve.

Defaults:

- Minimum orbit pitch: 5 degrees.
- Maximum orbit pitch: 85 degrees.

## Zoom anchoring

Wheel zoom attempts to preserve the world point under the cursor.

If the current viewing ray does not resolve ground, or if the hit lies at an unstable near-horizon distance, the controller falls back to ordinary rig zoom rather than producing a giant translation.

The same shallow-angle guard is used for RMB world grabbing.

Direct wheel input takes ownership of the current zoom target on its first wheel event. Additional wheel events compound from that target until the zoom settles.

## World dragging

RMB drag is based on world-space ground intersections rather than pixel sensitivity.

If the pointer temporarily leaves valid ground, dragging pauses. As soon as a stable ground point is available again, the controller re-anchors there without a jump.

RMB and MMB are exclusive direct-pointer modes. Starting one cleanly terminates the other, including pointer capture and stale button state.

## Movement feel

WASD and edge scrolling use screen-space scale rather than hard-coded world speed.

The controller derives world-units-per-pixel from the natural camera rig and uses the actual viewing yaw for movement direction. This keeps movement speed stable even when free LOOK is near the horizon or pointing toward the sky.

`pan_screen_speed` is expressed in viewport-heights per second.

Default:

- `pan_screen_speed = 0.75`.

Manual pan input takes ownership of the focus target when it begins, so it does not accidentally continue an older programmatic `focus_on()` movement.

## Ground modes

### PLANE

`PLANE` resolves all world interaction against the horizontal `ground_height` plane.

It runs in the normal render-frame update path and does not require a physics world.

### PHYSICS

`PHYSICS` resolves ground through 3D physics rays.

Relevant settings:

- `ground_collision_mask`
- `ground_required_group`
- `ground_max_skips`
- `ground_query_distance`
- `ground_probe_up`
- `ground_probe_down`
- `ground_collide_with_areas`

A required group can be placed on the collider itself or one of its Node ancestors. Non-matching colliders are skipped until a valid ground surface is found or `ground_max_skips` is exhausted.

Physics-space queries remain inside the physics-safe update path.

Pointer events are buffered and consumed there. The first pointer hit of a physics tick uses the last visible camera presentation pose, so clicking or beginning a drag corresponds to what was actually rendered rather than a hidden fixed-timestep pose.

## Physics presentation

Physics Ground can use manual render interpolation through `physics_render_interpolation`.

Logical camera state remains fixed-timestep and physics-safe. Render frames interpolate the actual eye position and viewing angles between physics states.

Terrain elevation changes have an additional vertical follow layer:

- `terrain_height_smoothing` controls how quickly the visual rig catches up to changed ground elevation.
- `terrain_height_max_lag_ratio` caps the temporary vertical lag relative to the current zoom height, so large cliffs cannot leave the camera dangerously far behind the terrain.
- Active LOOK rotation freezes this vertical follow offset so the eye does not drift during free look.

The logical navigation focus remains on resolved ground; only the rendered rig carries the temporary vertical offset.

Direct RMB/MMB manipulation bypasses physics render interpolation while active to avoid adding an extra tick of perceived input latency.

Godot's automatic physics interpolation is disabled on the camera node branch to avoid double interpolation.

## Bounds

Bounds are disabled by default and use a `Rect2` in world X/Z coordinates.

### FOCUS

Only the ground-navigation focus is constrained.

### VIEW

When the view is attached to the rig, the controller projects all four perspective-frustum corners onto ground and constrains the resulting finite ground footprint.

The calculation includes:

- zoom height,
- rig pitch,
- rig yaw,
- raised rig target,
- FOV,
- Camera3D keep-aspect mode,
- viewport aspect ratio.

If the full viewport does not have a finite ground footprint, VIEW bounds fall back to focus bounds.

While free LOOK is detached, bounds also use focus mode. Pure free-looking therefore cannot move the camera eye merely because the visible ground footprint changed.

When the visible footprint is larger than the configured bounds on an axis, it is centered on that axis instead of oscillating between opposite edges.

## Edge scrolling

Edge scrolling is disabled by default.

It stops automatically while:

- the window is unfocused,
- RMB drag is active,
- MMB rotation is active,
- a Godot GUI drag is active,
- the pointer is over a Control unless `edge_scroll_over_gui` is enabled.

`edge_scroll_speed_multiplier` independently scales its maximum speed.

## Programmatic API

The compact public control API is:

- `focus_on(position, immediate)`
- `zoom_to(height, immediate)`
- `rotate_to(yaw_degrees, pitch_degrees, immediate)`
- `reset_look(immediate)`
- `snap()`

Queries:

- `get_focus_position()`
- `get_zoom()`
- `get_zoom_ratio()`
- `get_yaw()`
- `get_pitch()`
- `get_rig_pitch()`
- `get_visible_ground_rect()`
- `has_finite_ground_footprint()`

`get_zoom()` returns the natural zoom-height parameter. With a manual ORBIT pitch offset, the actual eye height can differ while the rig radius for that zoom value stays unchanged. `get_zoom_ratio()` returns the logarithmically normalized target zoom ratio.

`rotate_to()` follows the selected rotation mode:

- LOOK: absolute viewing yaw/pitch.
- ORBIT: rig yaw/pitch.

## Defaults

- Perspective FOV: 45 degrees.
- Initial zoom height: 30 m.
- Minimum zoom height: 5 m.
- Maximum zoom height: 120 m.
- Near rig pitch: 25 degrees.
- Far rig pitch: 65 degrees.
- Zoom arc curve: 0.75.
- Rig target height: 1.5 m.
- Free look pitch: -85 to +85 degrees.
- Orbit pitch: 5 to 85 degrees.
- Pan screen speed: 0.75 viewport heights per second.
- Movement smoothing: 16.
- Zoom factor: 0.85 per wheel unit.
- Zoom smoothing: 18.
- Mouse yaw sensitivity: 0.2 degrees/pixel.
- Mouse pitch sensitivity: 0.2 degrees/pixel.
- Rotation smoothing: 18.
- Terrain height smoothing: 10.
- Terrain height max lag: 0.5 × current zoom height.
- Edge scroll margin: 24 px.
- Edge scroll curve: 2.0.

Malformed min/max relationships are normalized once on startup so invalid Inspector values cannot leave the controller in an impossible state.
