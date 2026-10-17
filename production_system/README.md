# Production System (Godot 4)

A reusable, **time-agnostic work ledger** for station-based recipes: queued orders,
atomic input reservation, work units, buffered output, cancellations, and persistent
state. All time, worker availability, shift schedules, productivity rates, travel,
ETAs, and event scheduling belong to the game (or another capability). This package
has **no _process / _physics_process**, timer, clock, duration, or end timestamp.

## Responsibility

Each station has a unique ID and ordered input/output inventory bindings. Multiple
stations may operate simultaneously. Queued orders specify a game-defined recipe
ID and a positive repeat count (or `-1` for continuous). A station processes at
most one active recipe cycle at a time.

The game supplies a pure `recipe_resolver(recipe_id, station_id)` callback returning:

```gdscript
{
    "inputs": {&"wood": 3, &"iron": 2},
    "outputs": {&"tools": 1},
    "work": 1000
}
```

Inputs and outputs can be empty dictionaries; work is a positive integer. Recipe
quantities and total required work are resolved once at successful cycle start,
then kept unchanged until that cycle finishes or is canceled. Balancing changes
affect new cycles, not the middle of an ongoing one.

**The unit of work is game-defined, not a minute, tick, or second.** Never put
an expected completion time in the recipe, cycle, station, or snapshot.

## Event-driven lifecycle

There is **no per-frame `advance()`** method. The game initiates transitions
only at meaningful events:

1. Bind inventories and register a station, then enqueue an order.
2. `try_begin_cycle(station_id)` attempts to resolve the next recipe and
   **atomically reserve all inputs**. On success, its new cycle is immediately
   in `work` phase with `work_completed = 0`. If recipe or materials are
   unavailable, it returns `false`, without opening a cycle or consuming
   goods, and reports `recipe_unavailable` or `inputs_unavailable`.
3. When the game's planned workers have actually supplied work, it calls
   `contribute_work(station_id, work_units)`. This can be called at a **time
   boundary or event**, not every tick. The method returns the number of units
   accepted, capped to the remaining work. No employee or clock knowledge
   exists within this package.
4. At zero remaining work, the cycle enters `output` phase and buffers its
   finished products exactly once. The game calls
   `try_deliver_outputs(station_id)` at completion or after output capacity
   becomes available. Failed storage leaves all goods in the saved buffer.
5. The game calls `try_begin_cycle` again for the next queued/repeating cycle
   at the appropriate scheduling event. **No subsequent cycle starts
   automatically.**

`get_work_state(station_id)` returns a detached dictionary with
`phase`, `paused`, `block_reason`, `work_completed`, `work_required`,
and `work_remaining`. When no cycle is running, all work counts are zero.
Work completion and goods delivery are deliberately separate operations.

### Where does “in 1:40 h” come from?

**1400** (not Production) takes `work_remaining` and integrates the future
labor supplied by currently assigned workers, their shifts, breaks, absences,
productivity, and any other game rules. It shows the resulting **remaining
in-game duration**, not a wall-clock timestamp or a production-owned ETA.
If workers or rates change, the game first settles the work they provided
up to the in-game change boundary, changes their assignments or schedule,
and recalculates its prediction and next event.

For example, when two workers independently contribute 300 and 200 units
over an externally chosen interval, the game may call:

```gdscript
production.contribute_work(&"smithy", 300 + 200)
var remaining := production.get_work_state(&"smithy")["work_remaining"]
# The game computes remaining *in-game duration* using future work schedules.
```

Neither work rate nor assigned workers need to be stored in the Production
cycle. A pause or a night without workers simply means that no more work
is contributed for that interval. The game's event scheduler handles the
next relevant boundary; Production never estimates it.

**World gathering** (walking to a resource, mining, carrying cargo) is a
different action sequence. It need not use a production cycle or a
precomputed end time.

## Production phases and events

- `idle`: no cycle, possibly a queued order or unresolved input/recipe block
- `work`: inputs reserved; accepts externally supplied work units
- `output`: required work completed, products buffered, waiting for delivery

`paused` is independent from phase and disables new cycles, work contributions,
and delivery. `block_reason` is `recipe_unavailable`, `inputs_unavailable`,
`outputs_full`, or empty. Signals distinguish phase transitions, block/unblock,
pauses, work contribution, cycle completion, and final order completion.
The game should schedule follow-up operations **after** the triggering
synchronous call returns, not reenter a busy station inside a signal handler.

## Orders, inventories, and cancellations

The game can reorder or remove queued orders; the active order is pinned at
queue index 0. Each station binds ordered nonempty arrays of input and output
inventory IDs. Material placement across multiple inventories is deterministic
and atomic. Bindings can change while a cycle is active, without disturbing
its already-reserved goods.

Canceling an active order immediately removes it from the queue. Reserved
inputs and any completed but undelivered outputs become separate **persistent
settlements** so they never disappear merely because storage is full.
`settle_pending(station_id, order_id = &"")` atomically deposits a settlement
into the currently bound storage (oldest by default). The game may
`discard_settlement` explicitly when its rules intentionally destroy goods.
A station with queued, active, or unsettled work cannot be removed.

## Public API

- Inventory binding: `bind_inventory`, `unbind_inventory`,
  `set_station_inventories`
- Station lifecycle: `register_station`, `unregister_station`,
  `get_station`, `get_stations`
- Orders: `enqueue_order`, `move_queued_order`,
  `remove_queued_order`, `cancel_order`, `cancel_active_order`
- Work lifecycle: `try_begin_cycle`, `get_work_state`,
  `contribute_work`, `try_deliver_outputs`, `set_paused`
- Settlements: `settle_pending`, `discard_settlement`
- Persistence: `export_state`, `restore_state`

Signals:
`station_registered`, `station_removed`, `station_changed`,
`station_inventories_changed`, `station_paused_changed`,
`station_phase_changed`, `station_blocked`, `station_unblocked`,
`order_queued`, `queued_order_removed`, `order_canceled`,
`work_contributed`, `cycle_started`, `cycle_completed`,
`order_completed`, `settlement_created`, `settlement_resolved`,
`state_restored`.

## Persistence, integrity, and boundaries

Snapshots hold versioned **work requirements, completed units, phases, goods,
orders, settlements, and stable inventory bindings**, but never wall-clock or
game-clock values, labor rates, workers, timers or projected end times.
Input reservations and buffered output belong to Production, not Inventory.
Restore Inventories and Production from the same game-level checkpoint; the
Production snapshot alone cannot prove cross-system resource conservation.
Missing references, malformed queues or invalid work/phase combinations cause
restore rejection without modifying live production state.

Notifications are sent only after internal and inventory state commits.
Direct external mutations of `get_station` snapshots have no effect.
Callbacks that resolve recipes should be pure and side-effect-free.

The game's Scheduling/Action logic assigns workers, computes durations in
**in-game time**, handles shift boundaries and events, and issues explicit
Production calls at those boundaries. A future scheduling capability should
depend on these work-state APIs; **Production must not depend on a calendar,
timekeeping, AI, character, or movement system**.

## Deployment

Add `"production_system": "ProductionSystem"` and
`"inventory_system": "InventorySystem"` to the project's package manifest;
use `tools/deploy.py`. Integration in `1400` is separate.
