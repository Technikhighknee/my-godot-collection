# RTS Camera

A compact RTS / city-builder camera for Godot 4.

## Current core

- Camera-relative WASD panning through configurable Input Map actions.
- Pan speed scales with zoom.
- Framerate-independent movement, zoom and programmatic orbit smoothing.
- Right-mouse world dragging with no pixel sensitivity constant.
- Middle-mouse yaw and pitch orbit around the current focus.
- Multiplicative, high-precision-aware wheel zoom.
- Cursor-anchored zoom.
- Transient drag/orbit/zoom state is cleared when the game window loses focus.
- Small programmatic API: `focus_on()`, `zoom_to()`, `orbit_to()`, `snap()`.

The current ground resolver is intentionally a horizontal plane at `ground_height`. Terrain, bounds and edge scrolling are later capabilities rather than dependencies of the core.

## Setup

Add these Input Map actions:

- `camera_left`
- `camera_right`
- `camera_forward`
- `camera_back`

The included demo registers WASD for these actions at runtime.

Instantiate `RTSCamera.tscn`. Its root position is the initial world focus. The Camera3D child transform does not need to be configured; the controller derives it from focus, zoom, yaw and pitch.

Default mouse controls:

- Middle mouse: yaw and pitch around the current focus.
- Right mouse: grab and drag the world.
- Wheel: cursor-anchored zoom.

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

Direct world dragging and mouse orbit intentionally bypass smoothing so the world stays attached to the pointer and orbit input feels immediate.
