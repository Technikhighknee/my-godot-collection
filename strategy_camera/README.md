# Strategy Camera

An opinionated 3D strategy / city-builder camera for Godot 4.

The component deliberately has one camera model instead of a collection of modes.

## Controls

- WASD: pan relative to camera yaw.
- Screen edge: immediate full-speed edge scrolling using the same pan model as WASD.
- Right mouse: grab and drag the world.
- Middle mouse horizontal: rotate the camera around its ground focus.
- Middle mouse vertical: look up/down relative to the natural zoom pose.
- Wheel: zoom, anchored to the world under the cursor when that intersection is stable.

## Camera model

The root position is the initial ground focus. Its Y coordinate defines the horizontal ground plane. Its Y rotation defines the initial camera yaw.

Zoom follows one built-in camera arc:

- Close: lower and more forward-looking.
- Far: higher and more top-down.
- Middle-mouse vertical rotation adds a persistent pitch offset on top of that arc.

That last point is intentional: manually looking up or down never disables the zoom arc. The arc remains the base pose and the user's input remains an offset.

Horizontal rotation is equally simple: it rotates both the camera eye and its viewing yaw around the same ground focus. There is no LOOK/ORBIT mode switch.

## Opinionated defaults

The feel constants live in the script rather than the Inspector:

- Zoom: 5–120 m, initially 30 m.
- Natural pitch: 25° close to 65° far.
- Raised rig target: 1.5 m.
- Free pitch: -85° to +85°.
- FOV: 45° from the scene.
- Pan speed: 0.75 visible-heights per second.
- Edge scroll margin: 24 px; entering it immediately uses normal pan speed.
- Wheel factor: 0.85.
- Mouse sensitivity: 0.2°/pixel.

If one of these values proves wrong in actual play, change the opinionated default. Do not turn every value into a setting preemptively.

## What is intentionally not in the core

- Multiple rotation modes.
- Physics-terrain following.
- Terrain presentation smoothing.
- View-aware bounds.
- Runtime ground-mode switching.
- Configurable mouse buttons or input action names.
- A large programmatic transition API.

Edge scrolling is intentionally part of the core because it reuses the same movement model without adding a second camera behavior. It is disabled while dragging or rotating, while the window is unfocused, and while the pointer is over UI. After pointer capture or a world drag ends, it waits for deliberate mouse movement before engaging so cursor restoration cannot trigger an accidental pan.

The remaining features can return only when a concrete game needs them and the feature can remain conceptually small.

## Input Map

The camera expects:

- `camera_left`
- `camera_right`
- `camera_forward`
- `camera_back`

The included demo registers WASD for these actions.

## Small API

- `focus_on(position, immediate)`
- `zoom_to(height, immediate)`
- `get_focus_position()`
- `get_zoom()`
- `get_yaw()`
- `get_pitch()`
