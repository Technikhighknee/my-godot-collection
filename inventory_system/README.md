# Inventory System (Godot 4)

Slot-based storage for characters, carts, buildings, and sales areas. All
numbers and upgrade decisions come **from the game**; this package contains no
hardcoded building types, starting capacities, upgrade tiers, prices, weights,
item definitions, or UI.

## Setup

Add an `Inventory` node beneath any object that stores goods. Configure it
once with the values supplied by the game:

```gdscript
@onready var storage: Inventory = $StorageInventory

func _ready() -> void:
    storage.configure(initial_slot_count, initial_stack_capacity)
```

`initial_slot_count` can be zero; `initial_stack_capacity` must be greater
than zero. All slots start empty. The inventory is not usable until configured.

A single object can own several independent inventories (for example, storage
and sales area). A cart and citizen use the same implementation with their own
game-supplied values.

## Capacity increases

```gdscript
storage.add_slots(extra_slots)
storage.increase_stack_capacity(extra_units_per_slot)
```

Both methods increase capacity by the positive amount supplied by the game.
There are no downgrade or shrink operations, no upgrade-level tables, no
redistribution, and no deletion of existing goods.

Each slot holds **one item ID** (`StringName`) and an integer quantity up to
the inventory's current per-slot capacity. One item type may occupy multiple
slots. Existing stacks are filled before empty slots are used.

## Using an inventory

```gdscript
storage.add(&"wood", 15)                 # Fully add or add nothing
storage.remove(&"wood", 4)               # Fully remove or remove nothing
storage.can_add(&"iron", 20)
storage.can_remove(&"wood", 5)
storage.get_item_quantity(&"wood")

var first_slot: InventorySlot = storage.get_slot(0)
print(first_slot.item_id, first_slot.quantity)

# Exact slot operations, suitable for inventory UI:
storage.add_to_slot(1, &"wood", 6)
storage.remove_from_slot(1, 2)
```

`get_slot(index)` returns a **copy** of the slot. An invalid index returns
`null`. `get_slots()` returns snapshots of all slots. Editing a returned
snapshot cannot bypass the inventory API. Empty slots use `item_id == &""`
and `quantity == 0`.

All operations reject invalid requests (including zero/negative quantities,
empty item IDs, absent goods, insufficient free slots, and incompatible
occupied slots) **without changing any contents**.

## Transferring goods

`InventoryTransfer` provides three static operations:

```gdscript
# Move an item quantity across any matching source/destination slots.
InventoryTransfer.transfer(warehouse, cart, &"wood", 25)

# Take from one particular source slot; auto-place at destination.
InventoryTransfer.transfer_from_slot(warehouse, 0, cart, 5)

# Specific source and destination slots, including moving/splitting
# stacks inside a single inventory.
InventoryTransfer.transfer_slot(warehouse, 0, cart, 2, 5)
InventoryTransfer.transfer_slot(warehouse, 0, warehouse, 3, 5)
```

All returns are `bool`; failed transfers change **neither** inventory.
The transfer first verifies the full quantity and available space, then writes
both inventories before emitting change signals. Automatic placement fills
existing matching stacks first and subsequently uses empty slots.

Ordinary `transfer()` and `transfer_from_slot()` require **different**
inventories; use `transfer_slot()` for same-inventory moves. Slot-to-slot
transfers require an empty or matching destination slot; automatic swapping of
two different item types is not performed.

The **game** decides whether a transfer is allowed (location, ownership,
purchase, theft, etc.) and when it is invoked. The inventory package
deliberately has no distance, economy, movement, or permission logic.

## Notifications

- `contents_changed()` fires once after a successful add/remove/slot edit,
  or once for each inventory involved in a successful two-inventory transfer.
  Neither inventory's observers see a half-applied transfer.
- `capacity_changed(slot_count, stack_capacity)` fires after configuration
  and capacity increases.

## API

`Inventory`:

- `configure(slot_count, stack_capacity) -> bool` (one-time)
- `is_configured() -> bool`
- `add_slots(count) -> bool`
- `increase_stack_capacity(amount) -> bool`
- `get_slot_count() -> int`, `get_stack_capacity() -> int`
- `get_slot(index) -> InventorySlot`, `get_slots() -> Array[InventorySlot]`
- `get_item_quantity(item_id) -> int`
- `can_add(item_id, quantity) -> bool`, `can_remove(item_id, quantity) -> bool`
- `add(item_id, quantity) -> bool`, `remove(item_id, quantity) -> bool`
- `add_to_slot(index, item_id, quantity) -> bool`
- `remove_from_slot(index, quantity) -> bool`

`InventoryTransfer`:

- `transfer(source, destination, item_id, quantity) -> bool`
- `transfer_from_slot(source, source_index, destination, quantity) -> bool`
- `transfer_slot(source, source_index, destination, destination_index, quantity) -> bool`

## Deployment

Add `"inventory_system": "InventorySystem"` to your project's
`manifest.json` and deploy with `tools/deploy.py`. No autoload is needed.

## Atomic multi-item batches

`InventoryBatch.apply(changes)` handles multiple item deltas across one or several inventories atomically. Each change is `{"inventory": inventory_node, "item_id": &"wood", "delta": -3}` (negative removes, positive adds). Transactions stage every change in temporary slot snapshots and commit all changes only when every step succeeds. `InventoryBatch.can_apply(changes)` checks without mutation. Changes are processed in the supplied order; construct removal-before-addition lists when reusing capacity. All `contents_changed` signals are emitted only after every affected inventory has committed. No partial resource consumption occurs.
