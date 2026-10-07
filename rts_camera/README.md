# RTS Camera

A compact RTS / city-builder camera for Godot 4.

## Current core

- Camera-relative WASD panning through configurable Input Map actions.
- Screen-space pan speed stays visually consistent across zoom, pitch, FOV, aspect ratio and terrain.
- Zoom follows a configurable pitch arc: close views become lower and more forward-looking, distant views become more top-down.
- Free LOOK rotation is independent from the zoom rig, so the camera can look toward the horizon or sky without destroying its ground navigation anchor.
- Optional ORBIT rotation moves the camera rig around the current ground focus.
- Right-mouse world dragging with no pixel sensitivity constant.
- Multiplicative, high-precision-aware wheel zoom.
- Cursor-anchored zoom.
- Plane or Physics Ground resolution through one shared ground-contact path.
- Optional focus bounds or view-aware bounds.
- Optional UI-aware edge scrolling with a soft speed ramp near the viewport edge.
- Physics Ground can use manual render interpolation without unsafe physics queries from render frames.
- Keyboard panning is suppressed while a text-editing Control owns GUI focus.
- Transient drag/rotate/zoom state is cleared when the game window loses focus.

## Setup

Add these Input Map actions:

- `camera_left`
- `camera_right`
- `camera_forward`
- `camera_back`

The included demo registers WASD for these actions at runtime.

Instantiate `RTSCamera.tscn`. Its root position is the initial ground focus. The Camera3D child transform does not need to be configured; the controller derives the camera pose from the logical rig state.

Default mouse controls:

- Middle mouse: rotate yaw and pitch using the selected rotation mode.
- Right mouse: grab and drag the world.
- Wheel: cursor-anchored zoom.

Middle-mouse rotation captures the pointer by default so yaw is not limited by the window edge. The previous mouse mode and cursor position are restored on release. Rotation uses Godot's screen-relative mouse delta for resolution-independent sensitivity.

## Camera model

The controller deliberately separates the physical camera rig from the viewing direction.

The ground focus is the navigation anchor. Zoom and rig yaw decide where the camera is positioned relative to that anchor. The zoom distance also feeds a configurable pitch curve:

- `near_pitch` is the rig pitch at minimum zoom.
- `far_pitch` is the rig pitch at maximum zoom.
- `zoom_arc_curve` shapes the transition between them.

The normalized zoom value is eased before pitch interpolation, so the camera travels through a smooth spatial arc rather than changing height and viewing angle linearly.

LOOK rotation changes only the viewing direction. The camera eye and ground focus stay fixed while the mouse is held. Look pitch is allowed from `min_look_pitch` to `max_look_pitch`, independent of the rig pitch, so looking above the horizon does not require inventing a ground intersection.

ORBIT rotation changes the rig yaw and adds a persistent pitch offset to the zoom arc. With zero look offset, ORBIT keeps the camera pointed toward its ground focus.

Manual LOOK offsets are preserved while zooming. This means zoom still changes the underlying camera pose, while the player's chosen relative viewing direction remains intact. `reset_look()` returns the viewing direction to the natural rig direction.

## Movement feel

Keyboard and edge panning are expressed in screen space rather than guessed world-units-per-second. The controller samples the ground around the viewport center to derive local world distance per screen pixel, then applies `pan_screen_speed` in viewport-heights per second. This naturally adapts to zoom, viewing angle, FOV, aspect ratio and sloped Physics Ground.

If the center of the screen is looking above the ground or a local sample cannot resolve a surface, an analytic perspective fallback keeps movement available.

## Ground modes

`PLANE` is the default and resolves all camera/world interaction against the horizontal `ground_height` plane. It stays render-frame driven and requires no physics world.

`PHYSICS` resolves camera/world interaction through 3D ray queries. Because direct physics-space queries must stay in the physics-safe path when threaded physics is in use, the camera performs its logical update in `_physics_process()` in this mode. Pointer events are buffered in order and consumed there.

For Physics Ground:

- Put valid camera surfaces on the layers selected by `ground_collision_mask`.
- Prefer a dedicated collision layer for terrain or other valid camera surfaces.
- `ground_required_group` can optionally add semantic filtering. A collider matches when it or one of its Node ancestors belongs to the group.
- Non-matching hits are skipped and the ray continues behind them, up to `ground_max_skips`.
- `ground_probe_up` and `ground_probe_down` define the vertical probe used to keep the navigation focus attached to terrain while panning.
- `ground_query_distance` limits arbitrary view rays.
- `ground_collide_with_areas` is off by default so trigger volumes do not become camera ground accidentally.

The public `resolve_ground_ray()` method is the single ground-contact path used internally by screen picking, zoom anchoring and view-footprint bounds.

Physics Ground uses manual render interpolation by default. Logical camera state remains fixed-timestep and physics-safe, while the rendered pose interpolates between the last two physics states. RMB drag and MMB rotation bypass that interpolation while held so direct manipulation does not gain an extra tick of input latency. The controller disables Godot's automatic interpolation on its own node branch to avoid double interpolation.

## Bounds

Bounds are disabled by default and use a `Rect2` in world X/Z coordinates.

`FOCUS` bounds only constrain the navigation focus.

`VIEW` bounds constrain the actual finite ground footprint visible through the perspective camera. The footprint uses the real camera eye and free viewing direction, including zoom arc, manual LOOK offsets, FOV, keep-aspect mode and viewport aspect ratio.

If the camera is looking far enough upward that all viewport corners cannot resolve ground, VIEW bounds fall back to focus bounds rather than pretending a finite ground footprint exists.

When the visible footprint is larger than the configured bounds on an axis, it is centered on that axis instead of oscillating between opposite edges.

Bounds are the final spatial constraint: at an edge they intentionally take priority over exact cursor anchoring.

`get_visible_ground_rect()` exposes the current finite ground footprint when available; `has_finite_ground_footprint()` reports whether that footprint is valid.

## Edge scrolling

Edge scrolling is disabled by default. When enabled, it feeds the same screen-space pan pipeline as WASD. `edge_scroll_speed_multiplier` scales its maximum speed independently of keyboard input.

It automatically stops while the window is unfocused, while the camera is being dragged or rotated, during a Godot GUI drag operation, and while the pointer is over a Control unless `edge_scroll_over_gui` is enabled.

## Programmatic API

The compact control API is:

- `focus_on(position, immediate)`
- `zoom_to(distance, immediate)`
- `rotate_to(yaw_degrees, pitch_degrees, immediate)`
- `reset_look(immediate)`
- `snap()`

`rotate_to()` follows the selected rotation mode. In LOOK mode the requested angles are absolute viewing angles. In ORBIT mode they describe the rig orientation.

## Defaults

The defaults assume Godot's normal metric 3D convention:

- Perspective FOV: 45 degrees.
- Initial zoom: 30 m.
- Minimum zoom: 5 m.
- Maximum zoom: 120 m.
- Near rig pitch: 20 degrees.
- Far rig pitch: 60 degrees.
- Zoom arc curve: 0.75.
- Free look pitch: -85 to +85 degrees.
- Orbit pitch limits: 5 to 85 degrees.
- Pan screen speed: 0.75 viewport heights per second at full input.
- Movement smoothing: 16.
- Zoom factor: 0.85 per wheel unit.
- Zoom smoothing: 18.
- Mouse yaw sensitivity: 0.2 degrees/pixel.
- Mouse pitch sensitivity: 0.2 degrees/pixel.
- Rotation smoothing: 18.
- Edge scroll margin: 24 px.
- Edge scroll curve: 2.0.

Invalid min/max relationships are normalized once on startup so malformed Inspector values cannot leave the controller in an impossible state.
