class_name PlaceActor
extends Node

# Gameplay state persists while the physical body moves between places.

signal body_bound(body: CharacterBody3D, place_id: StringName)
signal body_unbound()
signal place_changed(from_place: StringName, to_place: StringName)

@export var actor_id: StringName = &""

var _manager: PlaceManager3D
var _body: CharacterBody3D


func bind_body(
	manager: PlaceManager3D, body: CharacterBody3D, place_id: StringName
) -> bool:
	if not is_inside_tree() or _manager != null:
		return false
	if not is_instance_valid(manager) or not is_instance_valid(body):
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
	_manager.portal_traversed.connect(_on_portal_traversed)
	body_bound.emit(body, place_id)
	return true


func unbind_body() -> void:
	if _manager == null:
		return

	var manager := _manager
	var body := _body
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
	if not is_bound():
		return &""
	return _manager.get_body_place(_body)


func get_place_position() -> Vector3:
	if not is_bound():
		return Vector3.ZERO
	return _body.global_position


func _on_portal_traversed(
	body: Node3D, from_place: StringName, to_place: StringName
) -> void:
	if body == _body:
		place_changed.emit(from_place, to_place)


func _exit_tree() -> void:
	unbind_body()
