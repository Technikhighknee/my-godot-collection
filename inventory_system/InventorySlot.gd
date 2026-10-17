class_name InventorySlot
extends RefCounted

# Inventory getters return detached copies of slots.
var item_id: StringName
var quantity: int


func _init(id: StringName = &"", amount: int = 0) -> void:
	item_id = id
	quantity = amount


func is_empty() -> bool:
	return quantity == 0


func copy() -> InventorySlot:
	return InventorySlot.new(item_id, quantity)
