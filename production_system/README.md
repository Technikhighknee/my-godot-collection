# Production System (Godot 4)

A headless, game-independent production state machine, with persistent stations, repeatable orders, input reservations, work progress, and buffered output. No hard-coded recipes, goods, workers, buildings, AI, movement, actions, UI, time source or game permissions.

## Model
- A `ProductionStation` has a stable ID, ordered lists of game-bound input/output inventory IDs, queued orders, and at most one active production cycle.
- Orders name a game-defined recipe ID and a cycle count: positive for finite, `-1` for continuous.
- The game supplies `recipe_resolver(recipe_id, station_id) -> Dictionary` returning `{"inputs": {StringName: int}, "outputs": {StringName: int}, "work": positive_int}`.
- One cycle freezes the resolved quantities and work requirement. New cycles use the latest definition. The game determines permissions and work speed and calls `contribute_work(station_id, units)` using its own simulation clock.
- Input/outputs can contain zero items (empty Dictionary): e.g. raw extraction without material inputs.
- Inputs are removed atomically from Inventory via `InventoryBatch` at the start of a cycle. A fully worked cycle retains finished outputs in the saved cycle until they are atomically deposited. Production does not proceed if the target inventory lacks space.

## Lifecycle
1. Bind stable inventory IDs to configured Inventory instances with `bind_inventory`. Stations take an ordered nonempty `Array[StringName]` for input IDs and another for output IDs, e.g. `register_station(&"work_1", [&"store_a", &"store_b"], [&"finished_a"])`. Items are distributed deterministically, preferring earlier inventories, with all-or-nothing batches.
2. Register stations referencing those inventory IDs and enqueue orders.
3. Call `advance(station_id)` to begin a cycle and reserve inputs; if inputs are unavailable, retry later. No update loop is run implicitly.
4. After reservation call `contribute_work(station_id, positive_work_units)`. The game gates this by actual worker presence/permissions and calculates rate. Contributions beyond the remaining requirement are capped and the accepted amount is returned.
5. After completion call `advance(station_id)` to deposit pending output; if storage is full, retry later.
6. Call `advance` again to start the next cycle, when the next one is desired.

Pausing prevents `advance` and `contribute_work`; it does not destroy state. Queued orders may be re-ordered/removed. Canceling an active order refunds input material atomically, even if paused; if unable to refund it remains active until space is available. A completed but undelivered batch cannot be canceled by losing its outputs: it must be delivered first. Removing a station with work or queued orders is rejected.

## API
- `bind_inventory(id, inventory)`, `unbind_inventory(id)`
- `register_station(id, input_inventory_id, output_inventory_id)`, `unregister_station(id)`, `get_station(id)`, `get_stations()`
- `enqueue_order(station_id, order_id, recipe_id, cycles=1)`
- `remove_queued_order(station_id, order_id)`, `move_queued_order(station_id, order_id, index)`
- `set_paused(station_id, bool)`, `advance(station_id) -> bool`
- `contribute_work(station_id, units) -> int`
- `cancel_active_order(station_id) -> bool`
- `export_state() -> Dictionary`, `restore_state(snapshot) -> bool`
- `station_registered`, `station_removed`, `station_changed`, `cycle_started`, `cycle_completed`, `state_restored` signals

## Persistence
`export_state` returns a versioned snapshot with all queued orders, frozen active-cycle specs, reserved inputs, pending outputs, progress and stable inventory binding IDs. Rebind inventory nodes first and restore both Inventory and Production from the same game-level save checkpoint. No events are replayed and no goods are moved by `restore_state`.

`restore_state` verifies all IDs, queues and phase invariants before replacing the registry. Missing inventory IDs or inconsistent material ownership reject the snapshot. Definition migrations are a game responsibility.

## Boundaries
- InventoryBatch currently changes available goods atomically; input reservation/output buffers are owned and saved by Production, not mirrored in Inventory.
- Each station may consume inputs from and deposit outputs into multiple inventories. Atomic planning prevents partial multi-inventory consumption or deposit.
- Stable IDs and pure callbacks required. `get_station` and `get_stations` return detached copies; changing them does not mutate the registry.
- The game handles cancellation of actor actions and any building removal before unregistering stations.

## Deployment
Add `"production_system": "ProductionSystem"` and `"inventory_system": "InventorySystem"` to the project's package manifest; deploy with `tools/deploy.py`.
