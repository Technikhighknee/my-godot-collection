class_name OwnershipRegistry
extends Node

# Ownership of game-defined buildings. The owning entity is a dynasty,
# a city, or nobody. A dynasty-owned building can be assigned to a member
# shown as its owner in the game's UI; this never transfers legal ownership.
# No City System or Building System is created here.

enum OwnerType { NONE, DYNASTY, CITY }

signal ownership_changed(
	building_id: StringName, old_type: OwnerType, old_owner_id: StringName,
	new_type: OwnerType, new_owner_id: StringName
)
signal assigned_character_changed(
	building_id: StringName, old_character_id: StringName, new_character_id: StringName
)

var _dynasties: DynastyRegistry
var _owners: Dictionary = {} # StringName -> { "type", "owner_id", "character_id" }


func configure(dynasties: DynastyRegistry) -> bool:
	if is_instance_valid(_dynasties) or not is_instance_valid(dynasties):
		return false
	_dynasties = dynasties
	_dynasties.membership_changed.connect(_on_membership_changed)
	return true


# Atomically assigns or transfers economic ownership.
# For a DYNASTY, specify a registered member as the displayed owner.
# CITY uses an opaque game-supplied city ID; no City System dependency.
# NONE removes ownership. No partial changes on invalid inputs.
func set_building_owner(
	building_id: StringName, owner_type: OwnerType,
	owner_id: StringName = &"", character_id: StringName = &""
) -> bool:
	if not _valid_id(building_id):
		return false

	match owner_type:
		OwnerType.NONE:
			if owner_id != &"" or character_id != &"":
				return false
		OwnerType.CITY:
			if not _valid_id(owner_id) or character_id != &"":
				return false
		OwnerType.DYNASTY:
			if (
				not is_instance_valid(_dynasties)
				or not _valid_id(owner_id) or not _valid_id(character_id)
				or _dynasties.get_dynasty(owner_id) == null
				or _dynasties.get_dynasty_id_for(character_id) != owner_id
			):
				return false
		_:
			return false

	var old_type := get_owner_type(building_id)
	var old_owner_id := get_owner_id(building_id)
	var old_character_id := get_assigned_character_id(building_id)

	if (
		old_type == owner_type and old_owner_id == owner_id
		and old_character_id == character_id
	):
		return true

	if owner_type == OwnerType.NONE:
		_owners.erase(building_id)
	else:
		_owners[building_id] = {
			"type": owner_type,
			"owner_id": owner_id,
			"character_id": character_id
		}

	if old_type != owner_type or old_owner_id != owner_id:
		ownership_changed.emit(building_id, old_type, old_owner_id, owner_type, owner_id)
	if old_character_id != character_id:
		assigned_character_changed.emit(building_id, old_character_id, character_id)
	return true


# Changes only the person displayed as owner, never the owning dynasty.
# Empty ID explicitly leaves the building temporarily unassigned (e.g. death).
func assign_character(building_id: StringName, character_id: StringName) -> bool:
	if get_owner_type(building_id) != OwnerType.DYNASTY:
		return false

	var dynasty_id := get_owner_id(building_id)
	if character_id != &"" and (
		not _valid_id(character_id)
		or not is_instance_valid(_dynasties)
		or _dynasties.get_dynasty_id_for(character_id) != dynasty_id
	):
		return false

	var old_character_id := get_assigned_character_id(building_id)
	if old_character_id == character_id:
		return true

	var record: Dictionary = _owners[building_id]
	record["character_id"] = character_id
	assigned_character_changed.emit(building_id, old_character_id, character_id)
	return true


func get_owner_type(building_id: StringName) -> OwnerType:
	var record: Dictionary = _owners.get(building_id, {})
	var owner_type: OwnerType = record.get("type", OwnerType.NONE)
	return owner_type


func get_owner_id(building_id: StringName) -> StringName:
	var record: Dictionary = _owners.get(building_id, {})
	var owner_id: StringName = record.get("owner_id", &"")
	return owner_id


func get_assigned_character_id(building_id: StringName) -> StringName:
	var record: Dictionary = _owners.get(building_id, {})
	var character_id: StringName = record.get("character_id", &"")
	return character_id


# Returns a snapshot of building IDs owned by a single dynasty or city.
# NONE has no roster: the game owns the list of existing buildings.
func get_owned_buildings(owner_type: OwnerType, owner_id: StringName) -> Array[StringName]:
	var result: Array[StringName] = []
	if (
		(owner_type != OwnerType.DYNASTY and owner_type != OwnerType.CITY)
		or not _valid_id(owner_id)
	):
		return result
	for building_id in _owners:
		var record: Dictionary = _owners[building_id]
		if record["type"] == owner_type and record["owner_id"] == owner_id:
			result.append(building_id)
	return result


func _on_membership_changed(
	character_id: StringName, _old_dynasty_id: StringName, new_dynasty_id: StringName
) -> void:
	# Leaving/changing dynasties never transfers the building itself.
	# Only the obsolete displayed-owner assignment is cleared.
	for building_id in _owners.keys():
		var record: Dictionary = _owners[building_id]
		if (
			record["type"] == OwnerType.DYNASTY
			and record["character_id"] == character_id
			and record["owner_id"] != new_dynasty_id
		):
			assign_character(building_id, &"")


func _valid_id(id: StringName) -> bool:
	return id != &"" and not String(id).strip_edges().is_empty()


func _exit_tree() -> void:
	if is_instance_valid(_dynasties):
		if _dynasties.membership_changed.is_connected(_on_membership_changed):
			_dynasties.membership_changed.disconnect(_on_membership_changed)
