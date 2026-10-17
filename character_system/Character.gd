class_name Character
extends RefCounted

# A person's identity. No Family object is created or required.
# A living character is represented physically by a bound PlaceActor,
# registered separately with CharacterRegistry.
signal name_changed()

var _id: StringName
var _first_name: String
var _last_name: String


func _init(character_id: StringName, first_name: String, last_name: String) -> void:
	_id = character_id
	_first_name = first_name.strip_edges()
	_last_name = last_name.strip_edges()


func is_valid() -> bool:
	return (
		_id != &""
		and not String(_id).strip_edges().is_empty()
		and not _first_name.is_empty()
		and not _last_name.is_empty()
	)


func get_id() -> StringName:
	return _id


func get_first_name() -> String:
	return _first_name


func get_last_name() -> String:
	return _last_name


func get_full_name() -> String:
	return "%s %s" % [_first_name, _last_name]


# Names can change (e.g. marriage); a name is never a family identifier.
func rename(first_name: String, last_name: String) -> bool:
	var given := first_name.strip_edges()
	var surname := last_name.strip_edges()
	if given.is_empty() or surname.is_empty():
		return false
	if given == _first_name and surname == _last_name:
		return true
	_first_name = given
	_last_name = surname
	name_changed.emit()
	return true
