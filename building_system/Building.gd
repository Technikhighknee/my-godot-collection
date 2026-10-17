class_name Building
extends RefCounted

# A persistent building identity. All mutations go through BuildingRegistry.
# No ownership, inventory, room, model or upgrade-effect behavior lives here.

var _id: StringName
var _type_id: StringName
var _place_id: StringName
var _transform: Transform3D
var _properties: Dictionary
var _upgrades: Dictionary


func _init(
	building_id: StringName, building_type: StringName, location_id: StringName,
	placement: Transform3D = Transform3D.IDENTITY,
	properties: Dictionary = {}, upgrades: Dictionary = {}
) -> void:
	_id = building_id
	_type_id = building_type
	_place_id = location_id
	_transform = placement
	_properties = properties.duplicate(true)
	_upgrades = upgrades.duplicate(true)


func get_id() -> StringName:
	return _id


func get_type_id() -> StringName:
	return _type_id


func get_place_id() -> StringName:
	return _place_id


func get_transform() -> Transform3D:
	return _transform


func has_property(property_id: StringName) -> bool:
	return _properties.has(property_id)


func get_property_value(property_id: StringName) -> Variant:
	var value: Variant = _properties.get(property_id)
	if value is Dictionary or value is Array:
		return value.duplicate(true)
	return value


func get_properties() -> Dictionary:
	return _properties.duplicate(true)


func get_upgrade_level(upgrade_id: StringName) -> int:
	return _upgrades.get(upgrade_id, 0)


func has_upgrade(upgrade_id: StringName) -> bool:
	return get_upgrade_level(upgrade_id) > 0


func get_upgrades() -> Dictionary:
	return _upgrades.duplicate(true)


func to_snapshot() -> Dictionary:
	return {
		"id": _id, "type_id": _type_id, "place_id": _place_id,
		"transform": _transform, "properties": get_properties(),
		"upgrades": get_upgrades()
	}

# Safe detached value copy for registry-facing APIs.
func copy() -> Building:
	return Building.new(_id, _type_id, _place_id, _transform, _properties, _upgrades)
