# Movement System

Reusable **3D ground-walking navigation** for Godot 4. No selection,
ownership, input processing, action dispatcher, formation logic or animation.

## Scene setup

Add a `NavigationAgent3D` as a **direct child** of a `CharacterBody3D`
and attach `MovementAgent3D.gd` to that agent.

```text
Citizen (CharacterBody3D)
├── CollisionShape3D
├── Visuals
└── MovementAgent3D (NavigationAgent3D)
```

The CharacterBody3D must have a suitable collider and be placed with its feet
on the navigation mesh. Bake or supply a `NavigationRegion3D` for the walkable
world. Keep the NavigationAgent3D at the body's origin (zero local offset);
configure `path_desired_distance` and `target_desired_distance` to match
body dimensions and your scene's world scale. For slopes, set an appropriate
`CharacterBody3D.floor_snap_length`.

This component **owns `CharacterBody3D.velocity` and calls
`move_and_slide()` once per physics frame**. Don't run another movement script
on the same body. Models, animations, facing, and gameplay actions should read
the body's velocity or subscribe to signals; they do not drive this component.

## Use

```gdscript
@onready var movement: MovementAgent3D = $MovementAgent3D

func _ready() -> void:
    movement.movement_arrived.connect(_on_arrived)
    movement.movement_failed.connect(_on_failed)

func send_to(position: Vector3) -> void:
    movement.move_to(position)

func _on_arrived(_destination: Vector3) -> void:
    pass

func _on_failed(_destination: Vector3, reason: StringName) -> void:
    push_warning("Movement failed: %s" % reason)
```

The game decides which selected character receives `move_to()`. Clicking
a building does not automatically create a destination: the game chooses an
entrance or other reachable location and passes it to the movement agent.

## Public API

- `move_to(destination: Vector3) -> bool`: accepts a finite world position;
  returns false if the agent is not initialized or the position is invalid.
  A new valid goal cancels the previous goal, then starts the new one.
- `stop() -> void`: cancels the active movement, if any.
- `is_moving() -> bool`.
- `get_destination() -> Vector3`: returns the most recently accepted goal.

Signals: `movement_started(destination)`, `movement_arrived(destination)`,
`movement_stopped()`, `movement_failed(destination, reason)`.

Failure reasons: `navigation_unavailable` (navigation map did not sync),
`unreachable` (path ended short of the requested destination), `stuck`
(body could not make horizontal progress). Failed or canceled movement does
not report success. Replacing a goal emits `movement_stopped` for the old
goal before `movement_started` for the new one.

## Godot features used directly

- `NavigationAgent3D` handles path search, tracking, path updates and
  arrival thresholds.
- `CharacterBody3D.move_and_slide()` handles collision, terrain and slopes.
- `NavigationAgent3D.avoidance_enabled` enables optional native RVO local
  avoidance. Leave it off unless needed; Godot's avoidance has a runtime cost.
  Avoidance is local steering, not a replacement for navigable paths.
- Gravity comes from the project's `physics/3d/default_gravity`.

The system does **not** implement its own pathfinder or collision engine.
It also does not automatically traverse special off-mesh links (jumping,
ladders, teleports); those require game-specific traversal behavior.
Configure `move_speed`, `acceleration`, timeout and progress thresholds for
the scale of your game.

## Deployment

Include `"movement_system": "MovementSystem"` in the collection's project
manifest (alongside any other packages you want). Run `tools/deploy.py` as
documented in the repository root README.
