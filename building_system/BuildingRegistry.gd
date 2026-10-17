class_name BuildingRegistry
extends Node

# Registry for building identities and their game-defined persistent state.
# The game is responsible for all gameplay permissions and derived effects.

signal building_registered(building_id: StringName)
signal building_removed(building_id: StringName)
signal building_type_changed(building_id: StringName, old_type: StringName, new_type: StringName)
signal building_placement_changed(building_id: StringName)
signal building_property_changed(building_id: StringName, property_id: StringName, previous: Variant, current: Variant)
signal building_upgrade_changed(building_id: StringName, upgrade_id: StringName, old_level: int, new_level: int)
signal state_restored()

const SNAPSHOT_VERSION := 1

# Optional game policies; no callbacks are written into snapshots.
# property_validator(building, property_id, proposed_value) -> bool
# upgrade_validator(building, upgrade_id, proposed_level) -> bool
# type_validator(building, proposed_type_id) -> bool
var property_validator: Callable
var upgrade_validator: Callable
var type_validator: Callable

var _buildings: Dictionary = {} # StringName -> Building


func register_building(building: Building) -> bool:
	if not _valid_building(building) or _buildings.has(building.get_id()):
		return false
	_buildings[building.get_id()] = building
	building_registered.emit(building.get_id())
	return true


func unregister_building(building_id: StringName) -> bool:
	if not _buildings.erase(building_id):
		return false
	building_removed.emit(building_id)
	return true


func get_building(building_id: StringName) -> Building:
	return _buildings.get(building_id) as Building


func has_building(building_id: StringName) -> bool:
	return _buildings.has(building_id)


func get_buildings() -> Array[Building]:
	var result: Array[Building] = []
	for building in _buildings.values():
		result.append(building)
	return result


func set_type(building_id: StringName, type_id: StringName) -> bool:
	var building := get_building(building_id)
	if building == null or not _valid_id(type_id):
		return false
	if type_validator.is_valid() and not bool(type_validator.call(building, type_id)):
		return false
	if building._type_id == type_id:
		return true
	var previous := building._type_id
	building._type_id = type_id
	building_type_changed.emit(building_id, previous, type_id)
	return true


func set_placement(building_id: StringName, place_id: StringName, transform: Transform3D) -> bool:
	var building := get_building(building_id)
	if building == null or not _valid_id(place_id) or not _valid_transform(transform):
		return false
	if building._place_id == place_id and building._transform == transform:
		return true
	building._place_id = place_id
	building._transform = transform
	building_placement_changed.emit(building_id)
	return true


func set_property_value(building_id: StringName, property_id: StringName, value: Variant) -> bool:
	var building := get_building(building_id)
	if building == null or not _valid_id(property_id) or not _persistent_value(value):
		return false
	if building._properties.has(property_id):
		var old: Variant = building._properties[property_id]
		if typeof(old) != typeof(value):
			return false
	if property_validator.is_valid() and not bool(property_validator.call(building, property_id, value)):
		return false
	var previous: Variant = building.get_property_value(property_id)
	if building._properties.has(property_id) and previous == value:
		return true
	building._properties[property_id] = _copy_value(value)
	building_property_changed.emit(building_id, property_id, previous, _copy_value(value))
	return true


func erase_property(building_id: StringName, property_id: StringName) -> bool:
	var building := get_building(building_id)
	if building == null or not building.has_property(property_id):
		return false
	var previous: Variant = building.get_property_value(property_id)
	building._properties.erase(property_id)
	building_property_changed.emit(building_id, property_id, previous, null)
	return true


func set_upgrade_level(building_id: StringName, upgrade_id: StringName, level: int) -> bool:
	var building := get_building(building_id)
	if building == null or not _valid_id(upgrade_id) or level < 0:
		return false
	if upgrade_validator.is_valid() and not bool(upgrade_validator.call(building, upgrade_id, level)):
		return false
	var previous := building.get_upgrade_level(upgrade_id)
	if previous == level:
		return true
	if level == 0:
		building._upgrades.erase(upgrade_id)
	else:
		building._upgrades[upgrade_id] = level
	building_upgrade_changed.emit(building_id, upgrade_id, previous, level)
	return true


# Snapshot is pure data; restore is an all-or-nothing replacement.
# No ordinary mutation signals fire while restoring a save.
func export_state() -> Dictionary:
	var ids: Array[String] = []
	for building_id in _buildings:
		ids.append(String(building_id))
	ids.sort()
	var entries: Array[Dictionary] = []
	for id in ids:
		var building: Building = _buildings[StringName(id)]
		entries.append(building.to_snapshot())
	return { "version": SNAPSHOT_VERSION, "buildings": entries }


func restore_state(snapshot: Dictionary) -> bool:
	if snapshot.get("version") != SNAPSHOT_VERSION:
		return false
	var entries: Variant = snapshot.get("buildings")
	if not entries is Array:
		return false
	var restored: Dictionary = {}
	for item in entries:
		if not item is Dictionary:
			return false
		var required := ["id", "type_id", "place_id", "transform", "properties", "upgrades"]
		for key in required:
			if not item.has(key):
				return false
		if (
			not item["id"] is StringName or not item["type_id"] is StringName
			or not item["place_id"] is StringName
			or not item["transform"] is Transform3D
			or not item["properties"] is Dictionary
			or not item["upgrades"] is Dictionary
		):
			return false
		var building := Building.new(
			item["id"], item["type_id"], item["place_id"],
			item["transform"], item["properties"], item["upgrades"]
		)
		if not _valid_building(building) or restored.has(building.get_id()):
			return false
		restored[building.get_id()] = building
	_buildings = restored
	state_restored.emit()
	return true


func _valid_building(building: Building) -> bool:
	if (
		building == null or not _valid_id(building.get_id())
		or not _valid_id(building.get_type_id()) or not _valid_id(building.get_place_id())
		or not _valid_transform(building.get_transform())
	):
		return false
	if type_validator.is_valid() and not bool(type_validator.call(building, building.get_type_id())):
		return false
	for key in building._properties:
		var value: Variant = building._properties[key]
		if not key is StringName or not _valid_id(key) or not _persistent_value(value):
			return false
		if property_validator.is_valid() and not bool(property_validator.call(building, key, _copy_value(value))):
			return false
	for key in building._upgrades:
		var level: Variant = building._upgrades[key]
		if not key is StringName or not _valid_id(key) or typeof(level) != TYPE_INT or level <= 0:
			return false
		if upgrade_validator.is_valid() and not bool(upgrade_validator.call(building, key, level)):
			return false
	return true


static func _valid_id(id: StringName) -> bool:
	return not String(id).strip_edges().is_empty()


static func _valid_transform(value: Transform3D) -> bool:
	return (
		value.origin.is_finite() and value.basis.x.is_finite()
		and value.basis.y.is_finite() and value.basis.z.is_finite()
	)


static func _copy_value(value: Variant) -> Variant:
	if value is Array or value is Dictionary:
		return value.duplicate(true)
	return value


# Strictly limit persisted properties to Godot's data-only value types.
# No Object, Resource, Callable, RID or live Node references.
static func _persistent_value(value: Variant, depth: int = 0) -> bool:
	if depth > 16:
		return false
	match typeof(value):
		TYPE_NIL, TYPE_BOOL, TYPE_INT, TYPE_STRING, TYPE_STRING_NAME:
			return true
		TYPE_FLOAT:
			return is_finite(value)
		TYPE_VECTOR2, TYPE_VECTOR3, TYPE_VECTOR4, TYPE_COLOR, TYPE_VECTOR2I, TYPE_VECTOR3I, TYPE_VECTOR4I:
			return true
		TYPE_ARRAY:
			for part in value:
				if not _persistent_value(part, depth + 1):
					return false
			return true
		TYPE_DICTIONARY:
			for key in value:
				if not (key is String or key is StringName or key is int):
					return false
				if not _persistent_value(value[key], depth + 1):
					return false
			return true
		_:
			return false
