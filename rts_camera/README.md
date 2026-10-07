# RTS Camera

A compact RTS / city-builder camera for Godot 4.

## Current core

- Camera-relative WASD-style panning through configurable Input Map actions.
- Pan speed scales with zoom.
- Framerate-independent movement, zoom and keyboard rotation smoothing.
- Middle-mouse world dragging with no pixel sensitivity constant.
- Multiplicative, high-precision-aware wheel zoom.
- Cursor-anchored zoom.
- Optional yaw rotation with Q/E-style actions and direct right-mouse dragging.
- Fixed camera elevation with no dependency on the Camera3D editor transform.
- Transient drag/rotate/zoom state is cleared when the game window loses focus.
- Small programmatic API: `focus_on()`, `zoom_to()`, `rotate_to()`, `snap()`.

The current ground resolver is intentionally a horizontal plane at `ground_height`. Terrain, bounds and edge scrolling are later capabilities rather than dependencies of the core.

## Setup

Add these Input Map actions:

- `camera_left`
- `camera_right`
- `camera_forward`
- `camera_back`
- `camera_rotate_left`
- `camera_rotate_right`

The included demo registers WASD and Q/E for these actions at runtime.

Instantiate `RTSCamera.tscn`. Its root position is the initial world focus. The Camera3D child transform does not need to be configured; the controller derives it from the focus, zoom, yaw and angle.

Default mouse controls:

- Middle mouse: grab and drag the world.
- Right mouse: rotate around the current focus.
- Wheel: cursor-anchored zoom.

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
- Keyboard rotation: 90 degrees/s.
- Mouse rotation: 0.2 degrees/pixel.
- Rotation smoothing: 18 for keyboard rotation; mouse rotation is direct.

Direct world dragging and mouse rotation intentionally bypass smoothing so the world remains attached to the pointer instead of feeling elastic.
