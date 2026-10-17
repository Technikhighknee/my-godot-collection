# Production System

Queued recipe production with inventory reservations, explicit work contributions, output delivery and persistent state.

## Recipe and station setup

Each station has an ID and ordered input/output inventory IDs. Bind configured `Inventory` nodes before registering stations.

Set `ProductionRegistry.recipe_resolver` to a Callable with signature `(recipe_id: StringName, station_id: StringName) -> Dictionary`. A recipe resolves to:

```gdscript
{
    "inputs": {&"wood": 3, &"iron": 2},
    "outputs": {&"tools": 1},
    "work": 100
}
```

Work is measured in integer units. The caller supplies those units when work occurs.

## Cycle lifecycle

1. `enqueue_order(station_id, order_id, recipe_id, cycles)` adds an order. A count of `-1` repeats indefinitely.
2. `try_begin_cycle(station_id)` resolves the recipe and reserves all required materials atomically.
3. `contribute_work(station_id, units)` records work up to the cycle's remaining requirement.
4. After work completes, `try_deliver_outputs(station_id)` transfers buffered products to output inventories.
5. Call `try_begin_cycle` to start the next cycle.

Phases: `idle`, `work`, `output`. A station can also be paused or blocked with `recipe_unavailable`, `inputs_unavailable` or `outputs_full`.

`get_work_state(station_id)` returns `phase`, `paused`, `block_reason`, `work_completed`, `work_required` and `work_remaining`. Scheduling and elapsed time are determined by the caller.

## Cancellation and persistence

Canceling active work preserves reserved inputs or completed output as settlements. Use `settle_pending` to deposit them into available storage, or `discard_settlement` when goods should be explicitly discarded.

`export_state` and `restore_state` handle versioned station snapshots. Restore the associated inventories from the same save state. Station getters return detached copies.

Signals are emitted after state changes; schedule follow-up operations after the current call rather than reentering the same station from a signal handler.

## API

Inventory: `bind_inventory`, `unbind_inventory`, `set_station_inventories`.

Stations: `register_station`, `unregister_station`, `get_station`, `get_stations`, `set_paused`.

Orders: `enqueue_order`, `move_queued_order`, `remove_queued_order`, `cancel_order`, `cancel_active_order`.

Cycles: `try_begin_cycle`, `contribute_work`, `get_work_state`, `try_deliver_outputs`.

Settlements: `settle_pending`, `discard_settlement`.

Persistence: `export_state`, `restore_state`.

Signals: `station_registered`, `station_removed`, `station_changed`, `station_inventories_changed`, `station_paused_changed`, `station_phase_changed`, `station_blocked`, `station_unblocked`, `order_queued`, `queued_order_removed`, `order_canceled`, `work_contributed`, `cycle_started`, `cycle_completed`, `order_completed`, `settlement_created`, `settlement_resolved`, `state_restored`.
