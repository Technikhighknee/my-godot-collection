class_name PlaceActor
extends Node

# Persistent location survives the absence of a physical body.
signal body_bound(body: CharacterBody3D, place_id: StringName)
signal body_unbound()
signal place_changed(from_place: StringName, to_place: StringName)

@export var actor_id: StringName = &""

var _manager: PlaceManager3D
var _body: CharacterBody3D
var _location: PlaceLocation


# An unbound actor can move logically without a physical scene instance.
func set_location(location: PlaceLocation) -> bool:
	if is_bound() or location == null or not location.is_valid():
		return false
	_location = PlaceLocation.new(location.place_id, location.position)
	return true


func get_location() -> PlaceLocation:
	if is_bound():
		return PlaceLocation.new(get_place_id(), _body.global_position)
	if _location == null:
		return null
	return PlaceLocation.new(_location.place_id, _location.position)


func bind_body(
	manager: PlaceManager3D, body: CharacterBody3D, place_id: StringName
) -> bool:
	if not is_inside_tree() or _manager != null or place_id == &"":
		return false
	if not is_instance_valid(manager) or not is_instance_valid(body):
		return false
	if _location != null and _location.place_id != place_id:
		return false
	if actor_id == &"" or manager.get_actor_by_id(actor_id) != null:
		return false
	if not manager.register_physical_body(body, place_id):
		return false
	if not manager._associate_actor(body, self, actor_id):
		manager.unregister_physical_body(body)
		return false

	_manager = manager
	_body = body
	_location = PlaceLocation.new(place_id, body.global_position)
	_manager.portal_traversed.connect(_on_portal_traversed)
	body_bound.emit(body, place_id)
	return true


func unbind_body() -> void:
	if _manager == null:
		return

	var manager := _manager
	var body := _body
	# Keep the last actual position before removing the physical representation.
	if is_instance_valid(body):
		_location = PlaceLocation.new(manager.get_body_place(body), body.global_position)
	_manager = null
	_body = null

	if is_instance_valid(manager):
		if manager.portal_traversed.is_connected(_on_portal_traversed):
			manager.portal_traversed.disconnect(_on_portal_traversed)
		if is_instance_valid(body):
			manager.unregister_physical_body(body)
	body_unbound.emit()


func is_bound() -> bool:
	return is_instance_valid(_manager) and is_instance_valid(_body)


func get_place_manager() -> PlaceManager3D:
	return _manager if is_instance_valid(_manager) else null


func get_physical_body() -> CharacterBody3D:
	return _body if is_instance_valid(_body) else null


func get_place_id() -> StringName:
	if is_bound():
		return _manager.get_body_place(_body)
	return _location.place_id if _location != null else &""


func get_place_position() -> Vector3:
	if is_bound():
		return _body.global_position
	return _location.position if _location != null else Vector3.ZERO


func _on_portal_traversed(
	body: Node3D, from_place: StringName, to_place: StringName
) -> void:
	if body == _body:
		_location = PlaceLocation.new(to_place, body.global_position)
		place_changed.emit(from_place, to_place)


func _exit_tree() -> void:
	unbind_body()
