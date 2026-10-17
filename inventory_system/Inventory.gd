class_name Inventory
extends Node

# Reusable slot-based storage. All capacity values come from the game.
# Each slot holds a single item ID and a quantity up to stack_capacity.
# Capacity can only grow after the one-time configure() call.

signal contents_changed()
signal capacity_changed(slot_count: int, stack_capacity: int)

var _slots: Array[InventorySlot] = []
var _stack_capacity := 0
var _slot_count := 0 # Number of usable slots; _slots can retain occupied overflow slots.
var _configured := false
const SNAPSHOT_VERSION := 1


func configure(slot_count: int, stack_capacity: int) -> bool:
	if _configured or slot_count < 0 or stack_capacity <= 0:
		return false

	_configured = true
	_stack_capacity = stack_capacity
	_slot_count = slot_count
	for i in slot_count:
		_slots.append(InventorySlot.new())
	capacity_changed.emit(_slots.size(), _stack_capacity)
	return true


func is_configured() -> bool:
	return _configured


func get_slot_count() -> int:
	return _slot_count


func get_physical_slot_count() -> int:
	# Includes legacy occupied overflow slots; every one remains visible and removable.
	return _slots.size()


func is_over_capacity() -> bool:
	if not _configured:
		return false
	for i in _slots.size():
		var slot: InventorySlot = _slots[i]
		if i >= _slot_count and not slot.is_empty():
			return true
		if not slot.is_empty() and slot.quantity > _stack_capacity:
			return true
	return false


# Non-destructive downgrade: occupied overflow stays accessible for removal.
# Additions may only use the first slot_count slots and must respect the new
# per-stack limit. Inactive empty trailing slots are safely discarded.
func set_capacity(slot_count: int, stack_capacity: int) -> bool:
	if not _configured or slot_count < 0 or stack_capacity <= 0:
		return false
	if slot_count == _slot_count and stack_capacity == _stack_capacity:
		return true
	while _slots.size() < slot_count:
		_slots.append(InventorySlot.new())
	while _slots.size() > slot_count and _slots.back().is_empty():
		_slots.pop_back()
	_slot_count = slot_count
	_stack_capacity = stack_capacity
	capacity_changed.emit(_slot_count, _stack_capacity)
	return true


func get_stack_capacity() -> int:
	return _stack_capacity


# No shrinking, redistribution, or destructive capacity changes.
func add_slots(count: int) -> bool:
	if not _configured or count <= 0:
		return false

	if count > 9223372036854775807 - _slot_count:
		return false
	return set_capacity(_slot_count + count, _stack_capacity)


func increase_stack_capacity(amount: int) -> bool:
	if not _configured or amount <= 0:
		return false

	if amount > 9223372036854775807 - _stack_capacity:
		return false
	return set_capacity(_slot_count, _stack_capacity + amount)


func get_slot(index: int) -> InventorySlot:
	if index < 0 or index >= _slots.size():
		return null
	return _slots[index].copy()


func get_slots() -> Array[InventorySlot]:
	return _snapshot()


func get_item_quantity(item_id: StringName) -> int:
	if item_id == &"":
		return 0

	var total := 0
	for slot in _slots:
		if slot.item_id == item_id:
			total += slot.quantity
	return total


func can_add(item_id: StringName, quantity: int) -> bool:
	if not _valid_request(item_id, quantity):
		return false
	return _plan_add(_snapshot(), item_id, quantity)


func can_remove(item_id: StringName, quantity: int) -> bool:
	return _valid_request(item_id, quantity) and get_item_quantity(item_id) >= quantity


# Automatically fills matching stacks before consuming empty slots.
# All-or-nothing, including requests spanning several slots.
func add(item_id: StringName, quantity: int) -> bool:
	if not _valid_request(item_id, quantity):
		return false

	var plan := _snapshot()
	if not _plan_add(plan, item_id, quantity):
		return false
	_apply_plan(plan)
	contents_changed.emit()
	return true


# Removes across multiple stacks, starting at the lowest slot index.
func remove(item_id: StringName, quantity: int) -> bool:
	if not _valid_request(item_id, quantity):
		return false

	var plan := _snapshot()
	if not _plan_remove(plan, item_id, quantity):
		return false
	_apply_plan(plan)
	contents_changed.emit()
	return true


# Precise operations for click/drag interactions in a slot-based UI.
func add_to_slot(index: int, item_id: StringName, quantity: int) -> bool:
	if not _valid_request(item_id, quantity):
		return false

	var plan := _snapshot()
	if not _plan_add_to_slot(plan, index, item_id, quantity):
		return false
	_apply_plan(plan)
	contents_changed.emit()
	return true


func remove_from_slot(index: int, quantity: int) -> bool:
	if not _configured or quantity <= 0:
		return false

	var plan := _snapshot()
	if not _plan_remove_from_slot(plan, index, quantity):
		return false
	_apply_plan(plan)
	contents_changed.emit()
	return true


# Internal planning API used by InventoryTransfer. No signals or mutations
# of the live inventory occur until every validation has passed.
func _snapshot() -> Array[InventorySlot]:
	var result: Array[InventorySlot] = []
	for slot in _slots:
		result.append(slot.copy())
	return result


func _apply_plan(plan: Array[InventorySlot]) -> void:
	_slots = plan


func _valid_request(item_id: StringName, quantity: int) -> bool:
	return _configured and item_id != &"" and quantity > 0


func _plan_add(plan: Array[InventorySlot], item_id: StringName, quantity: int) -> bool:
	var remaining := quantity

	for index in _slot_count:
		var slot: InventorySlot = plan[index]
		if slot.item_id != item_id:
			continue
		var moved := mini(remaining, maxi(0, _stack_capacity - slot.quantity))
		slot.quantity += moved
		remaining -= moved
		if remaining == 0:
			return true

	for index in _slot_count:
		var slot: InventorySlot = plan[index]
		if not slot.is_empty():
			continue
		var moved := mini(remaining, _stack_capacity)
		slot.item_id = item_id
		slot.quantity = moved
		remaining -= moved
		if remaining == 0:
			return true

	return false


func _plan_remove(plan: Array[InventorySlot], item_id: StringName, quantity: int) -> bool:
	var remaining := quantity
	for slot in plan:
		if slot.item_id != item_id:
			continue
		var moved := mini(remaining, slot.quantity)
		slot.quantity -= moved
		remaining -= moved
		if slot.is_empty():
			slot.item_id = &""
		if remaining == 0:
			return true

	return false


func _plan_add_to_slot(
	plan: Array[InventorySlot], index: int, item_id: StringName, quantity: int
) -> bool:
	if index < 0 or index >= _slot_count:
		return false
	var slot := plan[index]
	if not slot.is_empty() and slot.item_id != item_id:
		return false
	if quantity > _stack_capacity - slot.quantity:
		return false
	slot.item_id = item_id
	slot.quantity += quantity
	return true


func _plan_remove_from_slot(
	plan: Array[InventorySlot], index: int, quantity: int
) -> bool:
	if index < 0 or index >= plan.size():
		return false
	var slot := plan[index]
	if quantity > slot.quantity:
		return false
	slot.quantity -= quantity
	if slot.is_empty():
		slot.item_id = &""
	return true


# Data-only snapshot; no Inventory/Node/Callable references.
func export_state() -> Dictionary:
	var entries: Array[Dictionary] = []
	for slot in _slots:
		entries.append({"item_id": slot.item_id, "quantity": slot.quantity})
	return {
		"version": SNAPSHOT_VERSION, "configured": _configured,
		"slot_count": _slot_count, "stack_capacity": _stack_capacity,
		"slots": entries
	}


# Rejects the entire snapshot before changing live state.
# Non-empty inactive/overstack slots are allowed (capacity was reduced).
func restore_state(snapshot: Dictionary) -> bool:
	if snapshot.get("version") != SNAPSHOT_VERSION:
		return false
	if not snapshot.has("configured") or typeof(snapshot["configured"]) != TYPE_BOOL:
		return false
	if (
		not snapshot.has("slot_count") or typeof(snapshot["slot_count"]) != TYPE_INT
		or not snapshot.has("stack_capacity") or typeof(snapshot["stack_capacity"]) != TYPE_INT
		or not snapshot.get("slots") is Array
	):
		return false
	var configured: bool = snapshot["configured"]
	var slots_count: int = snapshot["slot_count"]
	var stack_capacity: int = snapshot["stack_capacity"]
	var entries: Array = snapshot["slots"]
	if slots_count < 0 or entries.size() < slots_count:
		return false
	if configured and stack_capacity <= 0:
		return false
	if not configured and (stack_capacity != 0 or slots_count != 0 or not entries.is_empty()):
		return false
	var restored: Array[InventorySlot] = []
	for entry in entries:
		if not entry is Dictionary or not entry.has("item_id") or not entry.has("quantity"):
			return false
		var id: Variant = entry["item_id"]
		var amount: Variant = entry["quantity"]
		if not id is StringName or typeof(amount) != TYPE_INT or amount < 0:
			return false
		if (amount == 0 and id != &"") or (amount > 0 and id == &""):
			return false
		restored.append(InventorySlot.new(id, amount))
	_configured = configured
	_slot_count = slots_count
	_stack_capacity = stack_capacity
	_slots = restored
	capacity_changed.emit(_slot_count, _stack_capacity)
	contents_changed.emit()
	return true
