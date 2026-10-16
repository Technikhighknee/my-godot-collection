class_name Inventory
extends Node

# Reusable slot-based storage. All capacity values come from the game.
# Each slot holds a single item ID and a quantity up to stack_capacity.
# Capacity can only grow after the one-time configure() call.

signal contents_changed()
signal capacity_changed(slot_count: int, stack_capacity: int)

var _slots: Array[InventorySlot] = []
var _stack_capacity := 0
var _configured := false


func configure(slot_count: int, stack_capacity: int) -> bool:
	if _configured or slot_count < 0 or stack_capacity <= 0:
		return false

	_configured = true
	_stack_capacity = stack_capacity
	for i in slot_count:
		_slots.append(InventorySlot.new())
	capacity_changed.emit(_slots.size(), _stack_capacity)
	return true


func is_configured() -> bool:
	return _configured


func get_slot_count() -> int:
	return _slots.size()


func get_stack_capacity() -> int:
	return _stack_capacity


# No shrinking, redistribution, or destructive capacity changes.
func add_slots(count: int) -> bool:
	if not _configured or count <= 0:
		return false

	for i in count:
		_slots.append(InventorySlot.new())
	capacity_changed.emit(_slots.size(), _stack_capacity)
	return true


func increase_stack_capacity(amount: int) -> bool:
	if not _configured or amount <= 0:
		return false

	_stack_capacity += amount
	capacity_changed.emit(_slots.size(), _stack_capacity)
	return true


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

	for slot in plan:
		if slot.item_id != item_id:
			continue
		var moved := mini(remaining, _stack_capacity - slot.quantity)
		slot.quantity += moved
		remaining -= moved
		if remaining == 0:
			return true

	for slot in plan:
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
	if index < 0 or index >= plan.size():
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
