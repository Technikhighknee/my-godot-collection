# Action System (Godot 4)

A small gameplay-**measure interface** for characters, carts, buildings and
other Godot nodes. It knows which measures an object offers, whether they are
available, what kind of target they expect, and when an invocation finishes.

It does **not** implement walking, production, purchases, inventory, combat,
animations, buttons or input. Those belong to the game and other packages.

## Scene setup

Attach `ActionController.gd` to an ordinary `Node` directly beneath the
object that offers measures:

```text
Citizen (CharacterBody3D)
├── MovementAgent3D (NavigationAgent3D)
├── SelectionTarget3D (Area3D)
└── ActionController (Node)
```

It works exactly the same way under a building or cart. No autoload or scene
singleton is required. Scripts `ActionDefinition.gd` and
`ActionExecution.gd` are data/runtime helpers; they are not scene nodes.
The package does not contain handwritten scene UIDs.

## Defining a measure

Game code registers definitions (ID, display title, target type, executor and
optional game-defined availability/target predicates).

```gdscript
@onready var actions: ActionController = $Citizen/ActionController

func _ready() -> void:
    actions.register_action(ActionDefinition.new(
        &"inspect", "Inspect", ActionDefinition.TargetKind.OBJECT,
        _inspect_target
    ))

func _inspect_target(_actor: Node, target: Variant, execution: ActionExecution) -> void:
    print("Inspecting: ", (target as Node3D).name)
    execution.complete()
```

For dynamic availability and target rules, pass two additional Callables:
`available(actor: Node) -> bool` and
`valid_target(actor: Node, target: Variant) -> bool`.
Examples: the game checks the character's profession, ownership, a building's
upgrade, or whether a target is in range. The package does not invent those
rules. `is_available(id)` can be called when building the action bar, and the
rules are **rechecked when starting** an invocation. Call
`notify_actions_changed()` when a game-state change affects availability, so
the UI can update without polling.

## Optional cooldowns

Each `ActionDefinition` can declare a cooldown in seconds. Zero (the default)
means **no cooldown**. The cooldown is tracked independently by the
`ActionController` belonging to each character, building or cart.

```gdscript
var bribe := ActionDefinition.new(
    &"bribe", "Bribe", ActionDefinition.TargetKind.OBJECT, _perform_bribe
)
bribe.cooldown_seconds = 30.0
actions.register_action(bribe)
```

The last optional constructor argument can also specify the cooldown:
`ActionDefinition.new(id, title, kind, perform, available, valid_target, 30.0)`.
Cooldowns must be finite and non-negative when the measure is registered.

- **Starts:** after `execution.complete()` only. A running action is not
  cooling down yet. A failed or canceled action never starts a cooldown.
- **Blocks:** `request_action()` and `execute_action()` reject cooling-down
  measures with `action_rejected(id, &"cooldown")`. `is_available(id)`
  returns false while cooling down; other measures remain available.
- **Inspect:** `get_cooldown_remaining(id) -> float` reports seconds left;
  `is_on_cooldown(id) -> bool` is a convenience check.
- **Signals:** `cooldown_started(id, seconds)` and `cooldown_finished(id)`
  fire at the transitions. `actions_changed()` fires at both transitions,
  so the UI can refresh without a per-frame signal.
- **Time:** Godot's built-in, one-shot `Timer` respects
  `Engine.time_scale` and normal scene-tree pausing. A controller needs no
  extra nodes or timers in its scene.
- **Removal:** unregistering the measure clears its cooldown. Removing and
  re-registering an action ID does not cause old running invocations to
  start cooldowns on the replacement.
- **Concurrent actions:** if an action is running more than once, each
  successful completion restarts its cooldown from the full duration.
  Cooldowns do not retroactively cancel other running invocations.

Target kinds:
- `NONE`: immediate invocation, no target.
- `OBJECT`: a live `Node3D` (character, cart, building, etc.).
- `LOCATION`: a finite world `Vector3`.

## Picking targets (without owning input)

For a measure requiring a target, call:

```gdscript
actions.request_action(&"inspect")
```

The controller emits `target_required(id, target_kind)`. The **game** then
routes the appropriate `SelectionSystem` signal to the controller:

```gdscript
func _on_target_selected(target: Node3D) -> void:
    if actions.is_awaiting_target():
        actions.submit_target(target)

func _on_location_selected(position: Vector3) -> void:
    if actions.is_awaiting_target():
        actions.submit_target(position)
    else:
        # Normal right-click movement belongs to game logic.
        pass
```

A wrong target is rejected with `action_rejected(id, reason)`; targeting
remains active so the player can try again. Use `cancel_targeting()` (e.g.
Escape) to return to ordinary input. A `NONE` action executes immediately.
NPC logic can bypass manual targeting via `execute_action(id, target)`.

The SelectionSystem's right-click signals only fire when it has a selection.
The game chooses which selected object's controller receives the event.

## Execution lifecycle

Each accepted activation creates an independent `ActionExecution`, initially
`RUNNING`. The game's executor must call one of:

- `execution.complete()` — done.
- `execution.fail(&"reason")` — failed.
- `execution.cancel()` — canceled.

The controller emits `action_started(execution)` and
`action_finished(execution)`; read `execution.status` and
`execution.failure_reason` after settlement.

For long-running actions, the game subscribes to signals from a system such
as `MovementAgent3D` and settles the execution on arrival/error. Register
`execution.set_cancel_handler(callable)` to stop outstanding work if the
player cancels. The game must disconnect any other signal callbacks when the
execution finishes; the controller cannot know which systems the executor
uses.

A finished execution cannot finish again. `get_running_actions()` gives
the current invocations, and `cancel_execution(run)` or `cancel_all()`
cancels them. Removing the owner node cancels its unfinished executions.

**Concurrency is a game rule:** the controller does not silently cancel an
existing measure when another is activated. A character can enforce exclusive
actions by canceling/rejecting conflicting invocations; a building may support
independent ongoing measures. This is not an action queue or scheduler.

Unregistering a definition removes it from the menu without retroactively
canceling an already-running invocation.

## API

- `register_action(definition) -> bool` (rejects invalid and duplicate IDs)
- `unregister_action(id)`
- `get_actions() -> Array[ActionDefinition]`
- `notify_actions_changed()` (signal a game-driven availability change)
- `get_action(id) -> ActionDefinition`
- `is_available(id) -> bool` (includes cooldown status)
- `is_on_cooldown(id) -> bool`
- `get_cooldown_remaining(id) -> float`
- `request_action(id) -> bool`
- `is_awaiting_target() -> bool`
- `get_pending_action() -> StringName`
- `submit_target(target) -> ActionExecution`
- `cancel_targeting()`
- `execute_action(id, target = null) -> ActionExecution`
- `get_running_actions() -> Array[ActionExecution]`
- `cancel_execution(execution)`
- `cancel_all()`

Signals: `actions_changed()`, `target_required(id, target_kind)`,
`targeting_canceled(id)`, `action_rejected(id, reason)`,
`action_started(execution)`, `action_finished(execution)`,
`cooldown_started(id, seconds)`, `cooldown_finished(id)`.

Rejection reasons: `unknown_action`, `unavailable`, `invalid_target`,
`cooldown`.

## Deploy

Add `"action_system": "ActionSystem"` to the collection project manifest,
then deploy with `tools/deploy.py`.
