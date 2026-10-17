class_name DynastyRegistry
extends Node


signal dynasty_registered(dynasty: Dynasty)
signal membership_changed(
	character_id: StringName, old_dynasty_id: StringName, new_dynasty_id: StringName
)

var _characters: CharacterRegistry
var _dynasties: Dictionary = {}         # StringName -> Dynasty
var _dynasty_by_character: Dictionary = {} # StringName -> StringName
var _members: Dictionary = {}           # StringName -> Array[StringName]


func configure(characters: CharacterRegistry) -> bool:
	if _characters != null or not is_instance_valid(characters):
		return false
	_characters = characters
	_characters.character_removed.connect(_on_character_removed)
	return true


func register_dynasty(dynasty: Dynasty) -> bool:
	if dynasty == null or not dynasty.is_valid():
		return false
	var id := dynasty.get_id()
	if _dynasties.has(id):
		return false
	_dynasties[id] = dynasty
	var empty_members: Array[StringName] = []
	_members[id] = empty_members
	dynasty_registered.emit(dynasty)
	return true


func get_dynasty(id: StringName) -> Dynasty:
	return _dynasties.get(id) as Dynasty


func get_dynasties() -> Array[Dynasty]:
	var result: Array[Dynasty] = []
	for dynasty in _dynasties.values():
		result.append(dynasty)
	return result


func assign_member(character_id: StringName, dynasty_id: StringName) -> bool:
	if (
		not is_instance_valid(_characters)
		or _characters.get_character(character_id) == null
		or not _dynasties.has(dynasty_id)
	):
		return false
	var old_id: StringName = _dynasty_by_character.get(character_id, &"")
	if old_id == dynasty_id:
		return true
	if old_id != &"":
		var previous: Array[StringName] = _members[old_id]
		previous.erase(character_id)
	_dynasty_by_character[character_id] = dynasty_id
	var new_members: Array[StringName] = _members[dynasty_id]
	new_members.append(character_id)
	membership_changed.emit(character_id, old_id, dynasty_id)
	return true


func remove_member(character_id: StringName) -> bool:
	var old_id: StringName = _dynasty_by_character.get(character_id, &"")
	if old_id == &"":
		return false
	_dynasty_by_character.erase(character_id)
	var members: Array[StringName] = _members[old_id]
	members.erase(character_id)
	membership_changed.emit(character_id, old_id, &"")
	return true


func get_dynasty_id_for(character_id: StringName) -> StringName:
	var id: StringName = _dynasty_by_character.get(character_id, &"")
	return id


func get_dynasty_for(character_id: StringName) -> Dynasty:
	return get_dynasty(get_dynasty_id_for(character_id))


func get_members(dynasty_id: StringName) -> Array[StringName]:
	var result: Array[StringName] = []
	if _members.has(dynasty_id):
		var members: Array[StringName] = _members[dynasty_id]
		result = members.duplicate()
	return result


func _on_character_removed(character_id: StringName) -> void:
	remove_member(character_id)


func _exit_tree() -> void:
	if is_instance_valid(_characters):
		if _characters.character_removed.is_connected(_on_character_removed):
			_characters.character_removed.disconnect(_on_character_removed)
