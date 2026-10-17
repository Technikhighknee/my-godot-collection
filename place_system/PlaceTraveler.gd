class_name PlaceTraveler
extends Node

# Moves through linked places using the physical body's MovementAgent3D.

signal travel_started(place_id: StringName, position: Vector3)
signal travel_arrived(place_id: StringName, position: Vector3)
signal travel_failed(reason: StringName)
signal travel_canceled()

var _actor: PlaceActor
var _movement: NavigationAgent3D
var _manager: PlaceManager3D
var _route: Array[Dictionary] = []
var _step_index := 0
var _destination_place: StringName = &""
var _destination_position := Vector3.ZERO
var _expected_goal := Vector3.ZERO
var _active := false
var _waiting_for_portal := false
var _starting_leg := false


func _ready() -> void:
	_actor = get_parent() as PlaceActor
	if _actor == null:
		push_error("PlaceTraveler must be a direct child of PlaceActor.")
		return

	_actor.body_bound.connect(_on_body_bound)
	_actor.body_unbound.connect(_on_body_unbound)
	_actor.place_changed.connect(_on_place_changed)
	if _actor.is_bound():
		_on_body_bound(_actor.get_physical_body(), _actor.get_place_id())


func travel_to(place_id: StringName, position: Vector3) -> bool:
	if _actor == null or not _actor.is_bound() or not position.is_finite():
		return false

	var manager := _actor.get_place_manager()
	if manager == null or manager.get_place(place_id) == null:
		return false

	if _active:
		cancel()

	var body := _actor.get_physical_body()
	var from_id := _actor.get_place_id()
	var route: Array[Dictionary] = []
	if from_id != place_id:
		route = manager.find_portal_route(from_id, place_id, body)
		if route.is_empty():
			travel_failed.emit(&"no_portal_route")
			return false

	if _movement == null or not is_instance_valid(_movement):
		travel_failed.emit(&"missing_movement_agent")
		return false

	_route = route
	_step_index = 0
	_destination_place = place_id
	_destination_position = position
	_active = true
	_waiting_for_portal = false
	travel_started.emit(place_id, position)
	_start_next_leg()
	return _active


func is_traveling() -> bool:
	return _active


func cancel() -> void:
	if not _active:
		return

	if _waiting_for_portal and is_instance_valid(_manager):
		_manager.cancel_pending_portal_transfer(_actor.get_physical_body())
	_active = false
	_waiting_for_portal = false
	_route.clear()
	if is_instance_valid(_movement) and _movement.has_method("stop"):
		_movement.call("stop")
	travel_canceled.emit()


func _on_body_bound(body: CharacterBody3D, _place_id: StringName) -> void:
	_disconnect_movement()
	_manager = _actor.get_place_manager()
	if _manager != null:
		_manager.portal_rejected.connect(_on_portal_rejected)

	for child in body.get_children():
		if (
			child is NavigationAgent3D
			and child.has_method("move_to")
			and child.has_method("stop")
			and child.has_signal("movement_arrived")
			and child.has_signal("movement_failed")
			and child.has_signal("movement_started")
			and child.has_signal("movement_stopped")
		):
			_movement = child as NavigationAgent3D
			_movement.connect("movement_arrived", _on_movement_arrived)
			_movement.connect("movement_failed", _on_movement_failed)
			_movement.connect("movement_started", _on_movement_started)
			_movement.connect("movement_stopped", _on_movement_stopped)
			return


func _on_body_unbound() -> void:
	cancel()
	_disconnect_movement()
	_manager = null


func _disconnect_movement() -> void:
	if is_instance_valid(_movement):
		if _movement.is_connected("movement_arrived", _on_movement_arrived):
			_movement.disconnect("movement_arrived", _on_movement_arrived)
		if _movement.is_connected("movement_failed", _on_movement_failed):
			_movement.disconnect("movement_failed", _on_movement_failed)
		if _movement.is_connected("movement_started", _on_movement_started):
			_movement.disconnect("movement_started", _on_movement_started)
		if _movement.is_connected("movement_stopped", _on_movement_stopped):
			_movement.disconnect("movement_stopped", _on_movement_stopped)
	_movement = null

	if is_instance_valid(_manager):
		if _manager.portal_rejected.is_connected(_on_portal_rejected):
			_manager.portal_rejected.disconnect(_on_portal_rejected)


func _start_next_leg() -> void:
	if not _active or not _actor.is_bound() or not is_instance_valid(_movement):
		_fail(&"actor_unavailable")
		return

	var goal := _destination_position
	if _step_index < _route.size():
		var step: Dictionary = _route[_step_index]
		if _actor.get_place_id() != step["from"]:
			_fail(&"unexpected_place")
			return
		var place := _manager.get_place(step["from"])
		var portal: PlacePortal3D = place.get_portal(step["via"])
		if portal == null:
			_fail(&"missing_portal")
			return
		goal = portal.global_position
	elif _actor.get_place_id() != _destination_place:
		_fail(&"unexpected_place")
		return

	_expected_goal = goal
	# Replacing a local movement goal emits movement_stopped without canceling travel.
	_starting_leg = true
	var started := bool(_movement.call("move_to", goal))
	_starting_leg = false
	if not started:
		_fail(&"movement_not_started")


func _on_movement_started(destination: Vector3) -> void:
	# Other movement commands must not complete the current journey.
	if _active and not _waiting_for_portal:
		if destination.distance_squared_to(_expected_goal) > 0.0001:
			_fail(&"movement_interrupted")


func _on_movement_stopped() -> void:
	if _active and not _waiting_for_portal and not _starting_leg:
		_fail(&"movement_interrupted")


func _on_movement_arrived(_position: Vector3) -> void:
	if not _active or _waiting_for_portal:
		return

	if _step_index >= _route.size():
		_finish()
		return

	var step: Dictionary = _route[_step_index]
	_waiting_for_portal = true
	if not _manager.use_portal(_actor.get_physical_body(), step["via"]):
		_fail(&"portal_unavailable")


func _on_movement_failed(_position: Vector3, reason: StringName) -> void:
	if _active:
		_fail(reason)


func _on_portal_rejected(
	body: Node3D, place_id: StringName, portal_id: StringName
) -> void:
	if not _active or not _waiting_for_portal or _step_index >= _route.size():
		return
	var step: Dictionary = _route[_step_index]
	if (
		body == _actor.get_physical_body()
		and place_id == step["from"] and portal_id == step["via"]
	):
		_fail(&"portal_unavailable")


func _on_place_changed(_from: StringName, to: StringName) -> void:
	if not _active:
		return
	if not _waiting_for_portal or _step_index >= _route.size():
		_fail(&"unexpected_place")
		return

	var step: Dictionary = _route[_step_index]
	if to != step["to"]:
		_fail(&"unexpected_place")
		return

	_waiting_for_portal = false
	_step_index += 1
	_start_next_leg()


func _finish() -> void:
	_active = false
	_route.clear()
	travel_arrived.emit(_destination_place, _destination_position)


func _fail(reason: StringName) -> void:
	if not _active:
		return
	if _waiting_for_portal and is_instance_valid(_manager):
		_manager.cancel_pending_portal_transfer(_actor.get_physical_body())
	_active = false
	_waiting_for_portal = false
	_route.clear()
	if is_instance_valid(_movement) and _movement.has_method("stop"):
		_movement.call("stop")
	travel_failed.emit(reason)


func _exit_tree() -> void:
	cancel()
	_disconnect_movement()
