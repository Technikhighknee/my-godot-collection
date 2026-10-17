class_name SelectionSystem
extends Node


signal selection_changed(selection: Array[Node3D])
signal target_requested(target: Node3D)
signal location_requested(position: Vector3)
signal marquee_changed(rect: Rect2, active: bool)

@export var camera: Camera3D
@export var enabled := true
@export_flags_3d_physics var selection_collision_mask: int = 2
@export_flags_3d_physics var world_collision_mask: int = 1
@export var ray_length := 10000.0
@export var drag_threshold_pixels := 8.0

# Selection predicates receive the selected Node3D.
# Multi-selection requires a multi_select_filter.
var selectable_filter: Callable
var multi_select_filter: Callable

var _selection: Array[Node3D] = []
# Run physics queries in _physics_process, outside input callbacks.
var _pending_hits: Array[Dictionary] = []
var _left_down := false
var _left_origin := Vector2.ZERO
var _dragging := false
var _right_down := false


func _ready() -> void:
	get_window().focus_exited.connect(_reset_pointer)


func _exit_tree() -> void:
	_reset_pointer()
	var window := get_window()
	if window.focus_exited.is_connected(_reset_pointer):
		window.focus_exited.disconnect(_reset_pointer)


func _process(_delta: float) -> void:
	# A GUI-consumed release must still clear pending drag state.
	if _left_down and not Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT):
		_reset_left()


func _physics_process(_delta: float) -> void:
	if not enabled:
		_pending_hits.clear()
		return

	var actions := _pending_hits
	_pending_hits = []
	for action in actions:
		if action["type"] == "select":
			_select_click(action["position"], action["additive"])
		else:
			if not _selection.is_empty():
				_request_target(action["position"])


# Observe RMB releases before StrategyCamera can consume them.
# RMB presses remain subject to UI handling in _unhandled_input.
func _input(event: InputEvent) -> void:
	if not enabled or not event is InputEventMouseButton:
		return
	var mouse := event as InputEventMouseButton
	if mouse.button_index == MOUSE_BUTTON_RIGHT and not mouse.pressed:
		_finish_right_click(mouse)


func _unhandled_input(event: InputEvent) -> void:
	if not enabled:
		_reset_pointer()
		return

	if event is InputEventMouseButton:
		_mouse_button(event as InputEventMouseButton)
	elif event is InputEventMouseMotion:
		_mouse_motion(event as InputEventMouseMotion)


func _mouse_button(event: InputEventMouseButton) -> void:
	if event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed and not event.canceled:
			if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
				return
			_left_down = true
			_left_origin = event.position
			_dragging = false
			get_viewport().set_input_as_handled()
		elif _left_down:
			if not event.canceled and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
				if _dragging:
					_select_marquee(_rect(_left_origin, event.position), event.shift_pressed or event.ctrl_pressed)
				else:
					_pending_hits.append({
						"type": "select",
						"position": event.position,
						"additive": event.shift_pressed or event.ctrl_pressed
					})
			_reset_left()
			get_viewport().set_input_as_handled()
		return

	if event.button_index != MOUSE_BUTTON_RIGHT:
		return

	# Leave RMB available to the camera for hold-to-pan.
	if event.pressed and not event.canceled:
		if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
			return
		_right_down = true


func _finish_right_click(event: InputEventMouseButton) -> void:
	if not _right_down:
		return

	var is_click := (
		not event.canceled
		and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED
		and get_viewport().gui_get_hovered_control() == null
	)
	_right_down = false
	if is_click and not _selection.is_empty():
		_pending_hits.append({"type": "target", "position": event.position})


func _mouse_motion(event: InputEventMouseMotion) -> void:
	if not _left_down or Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		return

	if not _dragging and event.position.distance_to(_left_origin) >= drag_threshold_pixels:
		_dragging = true

	if _dragging:
		marquee_changed.emit(_rect(_left_origin, event.position), true)
		get_viewport().set_input_as_handled()


func _select_click(screen_position: Vector2, additive: bool) -> void:
	var marker := _pick_target(screen_position)
	if marker == null:
		if not additive:
			clear_selection()
		return

	var subject := marker.get_subject()
	select(subject, additive)


func _select_marquee(rect: Rect2, additive: bool) -> void:
	var next: Array[Node3D] = []
	if additive:
		next = _selection.duplicate()
		if not _all_multi_eligible(next):
			return

	var active_camera := _camera()
	if active_camera == null:
		return

	for node in get_tree().get_nodes_in_group(SelectionTarget3D.GROUP):
		var marker := node as SelectionTarget3D
		if marker == null or marker.get_viewport() != get_viewport():
			continue

		var subject := marker.get_subject()
		if not _can_select(subject) or not _can_multi_select(subject) or next.has(subject):
			continue

		var point := marker.get_marquee_position()
		if active_camera.is_position_behind(point):
			continue
		if rect.has_point(active_camera.unproject_position(point)):
			next.append(subject)

	_set_selection(next)


func _request_target(screen_position: Vector2) -> void:
	var marker := _pick_target(screen_position)
	if marker != null:
		var subject := marker.get_subject()
		if subject != null and is_instance_valid(subject) and subject.is_inside_tree():
			target_requested.emit(subject)
			return

	var hit := _raycast(screen_position, world_collision_mask, false)
	if not hit.is_empty():
		location_requested.emit(hit["position"])


func _pick_target(screen_position: Vector2) -> SelectionTarget3D:
	var hit := _raycast(screen_position, selection_collision_mask, true)
	var marker := hit.get("collider") as SelectionTarget3D
	if marker != null and marker.get_viewport() == get_viewport():
		return marker
	return null


func _raycast(screen_position: Vector2, mask: int, areas: bool) -> Dictionary:
	var active_camera := _camera()
	if active_camera == null or mask == 0 or ray_length <= 0.0:
		return {}

	var origin := active_camera.project_ray_origin(screen_position)
	var end := origin + active_camera.project_ray_normal(screen_position) * ray_length
	var query := PhysicsRayQueryParameters3D.create(origin, end, mask)
	query.collide_with_areas = areas
	query.collide_with_bodies = not areas
	return active_camera.get_world_3d().direct_space_state.intersect_ray(query)


func _camera() -> Camera3D:
	if camera != null and is_instance_valid(camera) and camera.is_inside_tree():
		return camera
	return get_viewport().get_camera_3d()


func _rect(a: Vector2, b: Vector2) -> Rect2:
	return Rect2(a, b - a).abs()


func _can_select(subject: Node3D) -> bool:
	return (
		subject != null
		and is_instance_valid(subject)
		and subject.is_inside_tree()
		and (not selectable_filter.is_valid() or bool(selectable_filter.call(subject)))
	)


func _can_multi_select(subject: Node3D) -> bool:
	return multi_select_filter.is_valid() and bool(multi_select_filter.call(subject))


func _all_multi_eligible(items: Array[Node3D]) -> bool:
	for item in items:
		if not _can_select(item) or not _can_multi_select(item):
			return false
	return true


func select(subject: Node3D, additive := false) -> void:
	if not _can_select(subject):
		return

	if not additive or _selection.is_empty():
		var single: Array[Node3D] = [subject]
		_set_selection(single)
		return

	var next: Array[Node3D] = _selection.duplicate()
	if next.has(subject):
		next.erase(subject)
	elif _can_multi_select(subject) and _all_multi_eligible(next):
		next.append(subject)
	else:
		return

	_set_selection(next)


func clear_selection() -> void:
	var empty: Array[Node3D] = []
	_set_selection(empty)


func get_selection() -> Array[Node3D]:
	return _selection.duplicate()


func has_selection() -> bool:
	return not _selection.is_empty()


func _set_selection(next: Array[Node3D]) -> void:
	if next == _selection:
		return

	for subject in _selection:
		if is_instance_valid(subject):
			var callback := _on_subject_exiting.bind(subject)
			if subject.tree_exiting.is_connected(callback):
				subject.tree_exiting.disconnect(callback)

	_selection = next

	for subject in _selection:
		if is_instance_valid(subject):
			subject.tree_exiting.connect(_on_subject_exiting.bind(subject))

	selection_changed.emit(get_selection())


func _on_subject_exiting(subject: Node3D) -> void:
	var next: Array[Node3D] = _selection.duplicate()
	next.erase(subject)
	_set_selection(next)


func _reset_left() -> void:
	if _dragging:
		marquee_changed.emit(Rect2(), false)
	_left_down = false
	_dragging = false


func _reset_pointer() -> void:
	_reset_left()
	_right_down = false
	_pending_hits.clear()
