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

`angle` is the camera elevation above the horizontal ground plane, so a normal RTS value is positive. The included default is 50 degrees. The scene uses a 45 degree perspective FOV.
