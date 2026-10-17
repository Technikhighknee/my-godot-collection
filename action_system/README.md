# Action System

Actions attached to a Godot node, with availability rules, targeting, execution state and cooldowns.

## Usage

Add `ActionController` as a child of the node offering actions. Register an `ActionDefinition` with an ID, title, target kind and callback:

```gdscript
actions.register_action(ActionDefinition.new(
    &"inspect", "Inspect", ActionDefinition.TargetKind.OBJECT,
    func(_actor: Node, target: Variant, execution: ActionExecution) -> void:
        print((target as Node3D).name)
        execution.complete()
))
```

Target kinds are `NONE`, `OBJECT` (live `Node3D`) and `LOCATION` (finite `Vector3`).

- `request_action(id)` executes a targetless action or emits `target_required(id, kind)`.
- `submit_target(target)` validates and executes the pending action. Invalid targets leave targeting active; `cancel_targeting()` clears it.
- `execute_action(id, target)` starts an action directly.
- Optional `available(actor)` and `valid_target(actor, target)` Callables restrict invocation. Call `notify_actions_changed()` when availability changes.
- `ActionExecution` remains running until its callback calls `complete()`, `fail(reason)` or `cancel()`. A cancel handler can release external work.
- `cooldown_seconds` starts a cooldown after successful completion. Cooldowns use Godot's scaled, pausable time.

An actor can have multiple running actions. Their concurrency and interaction with other components are controlled by the invoking code.

## API

`ActionController`: `register_action`, `unregister_action`, `get_actions`, `get_action`, `notify_actions_changed`, `is_available`, `request_action`, `submit_target`, `cancel_targeting`, `execute_action`, `is_awaiting_target`, `get_pending_action`, `get_running_actions`, `cancel_execution`, `cancel_all`, `is_on_cooldown`, `get_cooldown_remaining`.

Signals: `actions_changed`, `target_required`, `targeting_canceled`, `action_rejected`, `action_started`, `action_finished`, `cooldown_started`, `cooldown_finished`.

Rejection reasons: `unknown_action`, `unavailable`, `invalid_target`, `cooldown`.
