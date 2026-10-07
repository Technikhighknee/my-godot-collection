# RTS Camera

A compact RTS / city-builder camera for Godot 4.

## Current core

- WASD-style panning through configurable Input Map actions.
- Pan speed scales with zoom.
- Framerate-independent movement and zoom smoothing.
- Middle-mouse world dragging with no pixel sensitivity constant.
- Multiplicative, high-precision-aware wheel zoom.
- Cursor-anchored zoom.
- Fixed camera angle with no dependency on the Camera3D editor transform.
- Transient drag/zoom state is cleared when the game window loses focus.
- Small programmatic API: `focus_on()`, `zoom_to()`, `snap()`.

The current ground resolver is intentionally a horizontal plane at `ground_height`. Terrain, rotation, bounds and edge scrolling are later capabilities rather than dependencies of the core.

## Setup

Add these Input Map actions:

- `camera_left`
- `camera_right`
- `camera_forward`
- `camera_back`

The included demo registers WASD for these actions at runtime.

Instantiate `RTSCamera.tscn`. Its root position is the initial world focus. The Camera3D child transform does not need to be configured; the controller derives it from the focus, zoom and angle.

The defaults assume Godot's normal metric 3D scale, where one world unit is one meter:

- Camera angle: 50 degrees.
- Perspective FOV: 45 degrees.
- Initial zoom: 30 m.
- Minimum zoom: 5 m.
- Maximum zoom: 120 m.
- Pan speed: 4 m/s close to 110 m/s at maximum zoom.
- Movement smoothing: 16.
- Zoom factor: 0.85 per wheel unit.
- Zoom smoothing: 18.

These values are chosen so a one-meter-scale object remains meaningfully inspectable at maximum zoom-in while the default and maximum distances still provide useful strategy-scale coverage.
