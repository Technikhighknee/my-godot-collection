# Movement System

3D navigation and physical movement for a `CharacterBody3D`.

## Scene setup

Attach `MovementAgent3D.gd` to a `NavigationAgent3D` directly below a `CharacterBody3D`:

```text
CharacterBody3D
├── CollisionShape3D
└── MovementAgent3D (NavigationAgent3D)
```

The body needs a collider and a navigable world. Keep the navigation agent at the body's origin and configure its desired path/target distances for the character's size. `MovementAgent3D` controls body velocity and calls `move_and_slide()` in physics processing.

## Usage

```gdscript
movement.move_to(destination)
movement.stop()
if movement.is_moving():
    print(movement.get_destination())
```

Navigation uses Godot's `NavigationAgent3D`; collision uses `CharacterBody3D`. Optional avoidance uses the agent's native settings.

Properties include `move_speed`, `acceleration`, `gravity_scale`, `navigation_timeout`, `stuck_timeout` and `progress_distance`.

## API

- `move_to(destination: Vector3) -> bool`
- `stop()`
- `is_moving() -> bool`
- `get_destination() -> Vector3`

Signals: `movement_started(destination)`, `movement_arrived(destination)`, `movement_stopped()`, `movement_failed(destination, reason)`.

Failure reasons: `navigation_unavailable`, `unreachable`, `stuck`. Replacing an active destination emits a stop for the previous movement.
