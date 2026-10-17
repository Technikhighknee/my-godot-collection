class_name InventorySlot
extends RefCounted

# A snapshot of one slot, not a scene node or an item definition.
# Inventory.get_slot() returns a copy; modifying it cannot change inventory.
var item_id: StringName
var quantity: int


func _init(id: StringName = &"", amount: int = 0) -> void:
	item_id = id
	quantity = amount


func is_empty() -> bool:
	return quantity == 0


func copy() -> InventorySlot:
	return InventorySlot.new(item_id, quantity)
