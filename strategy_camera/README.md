# Strategy Camera

An opinionated 3D strategy / city-builder camera for Godot 4.

The camera deliberately has one spatial model instead of zoom modes, orbit modes, or cursor-anchored special cases.

## Controls

- WASD: pan relative to camera yaw.
- Screen edge: full-speed panning using the same movement model.
- Right mouse hold: after a short hold, capture the cursor and pan in the same screen direction as WASD / edge panning. A normal right click is left untouched.
- Middle mouse horizontal: rotate yaw.
- Middle mouse vertical: change tilt.
- Wheel: lower or raise the camera's physical height above the ground.

## Camera model

The root position is the camera's ground position. Its Y coordinate defines the horizontal ground plane.

Wheel input changes only one thing: camera height. It does not move the ground focus, does not zoom toward the cursor, and does not perform a radial dolly.

Tilt uses a deliberately simple convention:

- 0° = straight down.
- 90° = straight ahead at the horizon.
- The maximum is always 90°.
- Only the minimum depends on height: 65° at minimum height, opening to 25° at maximum height.

There is no explicit zoom arc. Instead, vertical mouse input is stored as a normalized position inside the currently allowed tilt range. When height changes, the moving minimum changes the actual tilt naturally while the fixed 90° maximum stays put. At the minimum tilt this reproduces the classic close/forward to far/top-down camera motion without maintaining a second arc state.

Height itself is logarithmic for input purposes. Each wheel step moves 5% through the 5–120 m height range, so every step has the same perceptual weight and the endpoints do not get a special partial transition.

## Following

`follow(target)` binds the camera's ground focus to a `Node3D`. The target's world position becomes the moving ground point, including Y, while height and rotation remain camera-owned.

Starting follow points the camera toward the target as far as the current tilt contract allows. After that, middle-mouse rotation and wheel height changes do not break follow.

Manual translation does:

- WASD breaks follow before moving.
- Edge scrolling breaks follow before moving.
- Right-mouse panning breaks follow on the first actual mouse movement after the hold has activated. A normal right click does not affect follow.
- `stop_following()` releases the target without moving the camera.
- If the target leaves the scene tree, follow releases automatically.

Calling `focus_on()` is also an explicit focus override and therefore releases follow.

## Panning

WASD, edge scrolling, and right-mouse dragging all use the same yaw-relative ground axes and the same height-derived world scale.

Right mouse is click-safe: pressing and releasing it before the hold delay does nothing to the camera and is not consumed, leaving the click available to gameplay code. Holding it for 120 ms activates camera panning and captures the cursor. From there, moving the mouse right pans right and moving it toward the top pans forward. Because this mapping does not intersect a mouse ray with the ground, it stays stable at every camera tilt.

## Opinionated defaults

The feel constants live in the script rather than the Inspector:

- Height: 5–120 m, initially 28.7 m.
- Height step: 5% of the logarithmic range.
- Minimum tilt: 65° close to 25° far away.
- Maximum tilt: 90°.
- FOV: 45° from the scene.
- Pan speed: 1.5 screen-heights per second.
- Edge scroll margin: 24 px.
- Right-mouse pan hold delay: 120 ms.
- Mouse sensitivity: 0.2°/pixel.

## What is intentionally not in the core

- Zoom-to-cursor.
- Ground-ray dragging.
- A separate camera arc.
- Multiple rotation modes.
- Physics-terrain following.
- Terrain presentation smoothing.
- View-aware bounds.
- Runtime ground-mode switching.
- Configurable mouse buttons or input action names.
- A large transition API.

## Input Map

The camera expects:

- `camera_left`
- `camera_right`
- `camera_forward`
- `camera_back`

Define these actions in your project's Input Map. The camera asserts during `_ready()` if any are missing, and the assertion message names every missing action.

## Small API

- `follow(target)`
- `stop_following()`
- `is_following()`
- `focus_on(position, immediate)`
- `set_height(height, immediate)`
- `get_focus_position()`
- `get_height()`
- `get_yaw()`
- `get_tilt()`
