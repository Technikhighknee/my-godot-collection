class_name InventoryBatch
extends RefCounted

# Transactions commit atomically and notify observers afterwards.
# Change entries contain inventory, item_id and signed delta.

static func apply(changes: Array[Dictionary], emit_signals: bool = true) -> bool:
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
	if emit_signals:
		for inventory in order:
			inventory.contents_changed.emit()
	return true


# Composite operations may defer notifications until their own state commits.
static func notify_contents_changed(changes: Array[Dictionary]) -> void:
	var touched: Dictionary = {}
	for change in changes:
		var inventory: Variant = change.get("inventory")
		if inventory is Inventory and is_instance_valid(inventory):
			touched[inventory] = true
	for inventory in touched:
		inventory.contents_changed.emit()


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


# Plan distribution on snapshots without changing inventory contents.
# Inventory order determines priority; item IDs are processed consistently.
# Returns {"ok": true, "changes": Array[Dictionary]} or {"ok": false}.
static func plan_distribution(
	inventories: Array[Inventory], items: Dictionary, adding: bool
) -> Dictionary:
	var snapshots: Dictionary = {}
	for inventory in inventories:
		if not is_instance_valid(inventory) or not inventory.is_configured() or snapshots.has(inventory):
			return {"ok": false}
		snapshots[inventory] = inventory._snapshot()
	var ids: Array[String] = []
	for item in items:
		if not item is StringName or item == &"":
			return {"ok": false}
		var quantity: Variant = items[item]
		if typeof(quantity) != TYPE_INT or quantity <= 0:
			return {"ok": false}
		ids.append(String(item))
	ids.sort()
	var changes: Array[Dictionary] = []
	for item_text in ids:
		var item_id := StringName(item_text)
		var remaining: int = items[item_id]
		for inventory in inventories:
			var plan: Array[InventorySlot] = snapshots[inventory]
			var available := 0
			if adding and inventory._plan_over_capacity(plan):
				continue
			if adding:
				for index in inventory.get_slot_count():
					var slot: InventorySlot = plan[index]
					var free := 0
					if slot.is_empty():
						free = inventory.get_stack_capacity()
					elif slot.item_id == item_id:
						free = maxi(0, inventory.get_stack_capacity() - slot.quantity)
					available += mini(remaining - available, free)
					if available == remaining:
						break
			else:
				for slot in plan:
					if slot.item_id == item_id:
						available += mini(remaining - available, slot.quantity)
						if available == remaining:
							break
			var part: int = mini(remaining, available)
			if part <= 0:
				continue
			var success: bool
			if adding:
				success = inventory._plan_add(plan, item_id, part)
			else:
				success = inventory._plan_remove(plan, item_id, part)
			if not success:
				return {"ok": false}
			changes.append({
				"inventory": inventory,
				"item_id": item_id,
				"delta": part if adding else -part
			})
			remaining -= part
			if remaining == 0:
				break
		if remaining > 0:
			return {"ok": false}
	return {"ok": true, "changes": changes}
