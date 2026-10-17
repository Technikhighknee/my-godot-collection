class_name InventoryTransfer
extends RefCounted

# Both inventories commit before contents_changed is emitted.


static func transfer(
	source: Inventory, destination: Inventory, item_id: StringName, quantity: int
) -> bool:
	if not _valid_pair(source, destination) or item_id == &"" or quantity <= 0:
		return false

	var source_plan := source._snapshot()
	var destination_plan := destination._snapshot()
	if not source._plan_remove(source_plan, item_id, quantity):
		return false
	if not destination._plan_add(destination_plan, item_id, quantity):
		return false

	_commit_pair(source, source_plan, destination, destination_plan)
	return true


static func transfer_from_slot(
	source: Inventory, source_index: int,
	destination: Inventory, quantity: int
) -> bool:
	if not _valid_pair(source, destination) or quantity <= 0:
		return false

	var origin := source.get_slot(source_index)
	if origin == null or origin.is_empty():
		return false

	var source_plan := source._snapshot()
	var destination_plan := destination._snapshot()
	if not source._plan_remove_from_slot(source_plan, source_index, quantity):
		return false
	if not destination._plan_add(destination_plan, origin.item_id, quantity):
		return false

	_commit_pair(source, source_plan, destination, destination_plan)
	return true


# Also supports moves and merges between slots of the same inventory.
static func transfer_slot(
	source: Inventory, source_index: int,
	destination: Inventory, destination_index: int, quantity: int
) -> bool:
	if (
		not is_instance_valid(source) or not is_instance_valid(destination)
		or not source.is_configured() or not destination.is_configured()
		or quantity <= 0
	):
		return false
	if source == destination and source_index == destination_index:
		return false

	var origin := source.get_slot(source_index)
	if origin == null or origin.is_empty():
		return false

	var source_plan := source._snapshot()
	if not source._plan_remove_from_slot(source_plan, source_index, quantity):
		return false

	if source == destination:
		if not source._plan_add_to_slot(
			source_plan, destination_index, origin.item_id, quantity
		):
			return false
		source._apply_plan(source_plan)
		source.contents_changed.emit()
		return true

	var destination_plan := destination._snapshot()
	if not destination._plan_add_to_slot(
		destination_plan, destination_index, origin.item_id, quantity
	):
		return false

	_commit_pair(source, source_plan, destination, destination_plan)
	return true


static func _valid_pair(source: Inventory, destination: Inventory) -> bool:
	return (
		is_instance_valid(source) and is_instance_valid(destination)
		and source != destination
		and source.is_configured() and destination.is_configured()
	)


static func _commit_pair(
	source: Inventory, source_plan: Array[InventorySlot],
	destination: Inventory, destination_plan: Array[InventorySlot]
) -> void:
	source._apply_plan(source_plan)
	destination._apply_plan(destination_plan)
	source.contents_changed.emit()
	destination.contents_changed.emit()
