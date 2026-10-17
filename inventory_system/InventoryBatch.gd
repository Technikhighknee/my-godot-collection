class_name InventoryBatch
extends RefCounted

# Atomic multi-item, multi-inventory transaction.
# Each entry is { "inventory": Inventory, "item_id": StringName, "delta": int }.
# Positive deltas add goods, negative deltas remove them.
# Changes are prepared on snapshots; no mutation occurs if any step fails.
# All signals are emitted after every touched inventory has been committed.

static func apply(changes: Array[Dictionary]) -> bool:
	if changes.is_empty():
		return false
	var plans: Dictionary = {}
	var order: Array[Inventory] = []
	for change in changes:
		if not (
			change.has("inventory") and change.has("item_id") and change.has("delta")
		):
			return false
		var inventory: Variant = change["inventory"]
		var item_id: Variant = change["item_id"]
		var delta: Variant = change["delta"]
		if (
			not inventory is Inventory or not is_instance_valid(inventory)
			or not inventory.is_configured()
			or not item_id is StringName or item_id == &""
			or typeof(delta) != TYPE_INT or delta == 0
			or delta == -9223372036854775807 - 1
		):
			return false
		if not plans.has(inventory):
			plans[inventory] = inventory._snapshot()
			order.append(inventory)
		var plan: Array[InventorySlot] = plans[inventory]
		var quantity: int = absi(delta)
		var ok: bool
		if delta < 0:
			ok = inventory._plan_remove(plan, item_id, quantity)
		else:
			ok = inventory._plan_add(plan, item_id, quantity)
		if not ok:
			return false
	for inventory in order:
		var plan: Array[InventorySlot] = plans[inventory]
		inventory._apply_plan(plan)
	for inventory in order:
		inventory.contents_changed.emit()
	return true


static func can_apply(changes: Array[Dictionary]) -> bool:
	if changes.is_empty():
		return false
	var plans: Dictionary = {}
	for change in changes:
		if not (
			change.has("inventory") and change.has("item_id") and change.has("delta")
		):
			return false
		var inventory: Variant = change["inventory"]
		var item_id: Variant = change["item_id"]
		var delta: Variant = change["delta"]
		if (
			not inventory is Inventory or not is_instance_valid(inventory)
			or not inventory.is_configured()
			or not item_id is StringName or item_id == &""
			or typeof(delta) != TYPE_INT or delta == 0
			or delta == -9223372036854775807 - 1
		):
			return false
		if not plans.has(inventory):
			plans[inventory] = inventory._snapshot()
		var plan: Array[InventorySlot] = plans[inventory]
		var quantity: int = absi(delta)
		if delta < 0:
			if not inventory._plan_remove(plan, item_id, quantity):
				return false
		elif not inventory._plan_add(plan, item_id, quantity):
			return false
	return true
