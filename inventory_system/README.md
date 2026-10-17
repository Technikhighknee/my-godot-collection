# Inventory System

Slot-based storage, atomic transfers and transactions across multiple inventories.

## Inventory

`Inventory` is a node configured once with a usable slot count and per-slot stack capacity:

```gdscript
storage.configure(8, 20)
storage.add(&"wood", 15)
storage.remove(&"wood", 4)
```

Each slot contains one item ID and quantity. Matching stacks are filled before empty slots. Item and capacity changes are all-or-nothing.

Capacity can change through `set_capacity(slot_count, stack_capacity)`, `add_slots(count)` or `increase_stack_capacity(amount)`. Shrinking retains occupied overflow slots and oversized stacks; `is_over_capacity()` reports that state. Goods in overflow remain removable.

`get_slot()` and `get_slots()` return copies. `export_state()` and `restore_state()` handle versioned snapshots.

## Transfers

`InventoryTransfer` has three static operations:

- `transfer(source, destination, item_id, quantity)`: automatic placement.
- `transfer_from_slot(source, source_index, destination, quantity)`: one source slot, automatic placement.
- `transfer_slot(source, source_index, destination, destination_index, quantity)`: explicit slots, including moves within one inventory.

Transfer failures leave both inventories unchanged. Content notifications fire after all affected inventories commit.

## Batches

`InventoryBatch.can_apply(changes)` checks a transaction, and `apply(changes)` commits it atomically. A change contains an `inventory`, `item_id`, and signed `delta`.

`plan_distribution(inventories, items, adding)` plans removal or placement across an ordered list of inventories. The returned `changes` can be passed to `apply`.

## API and signals

`Inventory`: `configure`, `is_configured`, `get_slot_count`, `get_physical_slot_count`, `get_stack_capacity`, `set_capacity`, `is_over_capacity`, `add_slots`, `increase_stack_capacity`, `get_slot`, `get_slots`, `get_item_quantity`, `can_add`, `can_remove`, `add`, `remove`, `add_to_slot`, `remove_from_slot`, `export_state`, `restore_state`.

Signals: `contents_changed`, `capacity_changed`.
