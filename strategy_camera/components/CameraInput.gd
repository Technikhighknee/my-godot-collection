class_name StrategyCameraInput
extends Node

# Owns pointer capture, pan-hold timing and keyboard/edge input.
const EDGE_SCROLL_MARGIN := 24.0
const PAN_LEFT_ACTION: StringName = &"camera_left"
const PAN_RIGHT_ACTION: StringName = &"camera_right"
const PAN_FORWARD_ACTION: StringName = &"camera_forward"
const PAN_BACK_ACTION: StringName = &"camera_back"

var _host: Node3D
var _movement: StrategyCameraMovement
var _hold_delay_msec := 250
var _edge_scroll_waiting_for_motion := false
var _edge_scroll_block_position := Vector2.ZERO
var _panning := false
var _pan_hold_pending := false
var _pan_hold_started_msec := 0
var _pointer_pan_anchor := Vector2.ZERO
var _rotating := false
var _pointer_rotation_anchor := Vector2.ZERO
var _pointer_capture_active := false
var _pointer_restore_mouse_mode: Input.MouseMode = Input.MOUSE_MODE_VISIBLE
var _pointer_restore_mouse_position := Vector2.ZERO

func initialize(host: Node3D, movement: StrategyCameraMovement) -> void:
	_host = host
	_movement = movement
	_assert_input_actions()

func tick(hold_delay_msec: int) -> void:
	_hold_delay_msec = hold_delay_msec
	_reconcile_pointer_buttons()
	_update_pointer_pan_hold()

func get_pan_direction() -> Vector2:
	if _panning or _rotating or _keyboard_pan_blocked_by_gui():
		return Vector2.ZERO
	var keyboard := Input.get_vector(
		PAN_LEFT_ACTION, PAN_RIGHT_ACTION, PAN_FORWARD_ACTION, PAN_BACK_ACTION
	)
	return (keyboard + _edge_scroll_input()).limit_length(1.0)

func suppress_edge_scroll_until_motion(position: Vector2) -> void:
	_suppress_edge_scroll_until_motion(position)

func _assert_input_actions() -> void:
	var missing := PackedStringArray()

	if not InputMap.has_action(PAN_LEFT_ACTION):
		missing.append(String(PAN_LEFT_ACTION))

	if not InputMap.has_action(PAN_RIGHT_ACTION):
		missing.append(String(PAN_RIGHT_ACTION))

	if not InputMap.has_action(PAN_FORWARD_ACTION):
		missing.append(String(PAN_FORWARD_ACTION))

	if not InputMap.has_action(PAN_BACK_ACTION):
		missing.append(String(PAN_BACK_ACTION))

	assert(
		missing.is_empty(),
		"StrategyCamera requires these missing Input Map actions: %s"
		% ", ".join(missing)
	)


func handle_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		_handle_mouse_button(event as InputEventMouseButton)
	elif event is InputEventMouseMotion:
		var motion := event as InputEventMouseMotion
		if _panning:
			_movement.pan_pointer(motion)
			get_viewport().set_input_as_handled()
		elif _rotating:
			_movement.rotate_pointer(motion)
			get_viewport().set_input_as_handled()


func _reconcile_pointer_buttons() -> void:
	if _rotating and not Input.is_mouse_button_pressed(MOUSE_BUTTON_MIDDLE):
		_end_pointer_rotation()

	if _pan_hold_pending and not Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT):
		_cancel_pointer_pan_hold()

	if _panning and not Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT):
		_end_pointer_pan()


func _update_pointer_pan_hold() -> void:
	if not _pan_hold_pending:
		return

	if not Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT):
		_cancel_pointer_pan_hold()
		return

	if not _pointer_pan_hold_ready():
		return

	_pan_hold_pending = false
	_pan_hold_started_msec = 0

	if _rotating:
		_pointer_pan_anchor = _pointer_rotation_anchor
		_end_pointer_rotation()
	else:
		_pointer_pan_anchor = get_viewport().get_mouse_position()

	_panning = true
	_movement.freeze_pan_target()
	_host.emit_signal(&"pointer_pan_started", _pointer_pan_anchor)
	_begin_pointer_capture(_pointer_pan_anchor)


func _pointer_pan_hold_ready() -> bool:
	return (
		_pan_hold_pending
		and Time.get_ticks_msec() - _pan_hold_started_msec
		>= _hold_delay_msec
	)


func _cancel_pointer_pan_hold() -> void:
	_pan_hold_pending = false
	_pan_hold_started_msec = 0


func _handle_mouse_button(event: InputEventMouseButton) -> void:
	if event.button_index == MOUSE_BUTTON_MIDDLE:
		if event.pressed and not event.canceled:
			_cancel_pointer_pan_hold()

			var capture_position := event.position

			if _panning:
				capture_position = _pointer_pan_anchor
				_end_pointer_pan()

			_movement.freeze_pan_target()
			_begin_pointer_rotation(capture_position)
		elif _rotating:
			_end_pointer_rotation()

		get_viewport().set_input_as_handled()
		return

	if event.button_index == MOUSE_BUTTON_RIGHT:
		if event.pressed and not event.canceled:
			_pan_hold_pending = true
			_pan_hold_started_msec = Time.get_ticks_msec()
			return

		if _panning:
			_end_pointer_pan()
			get_viewport().set_input_as_handled()
		else:
			var was_hold := _pointer_pan_hold_ready()
			_cancel_pointer_pan_hold()

			if was_hold:
				get_viewport().set_input_as_handled()

		return

	if not event.pressed or event.canceled or _panning or _rotating:
		return

	if event.button_index == MOUSE_BUTTON_WHEEL_UP:
		_movement.change_height(-1.0, event.factor)
		get_viewport().set_input_as_handled()
	elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
		_movement.change_height(1.0, event.factor)
		get_viewport().set_input_as_handled()


func _begin_pointer_rotation(anchor: Vector2) -> void:
	if _rotating:
		return

	_rotating = true
	_pointer_rotation_anchor = anchor
	_host.emit_signal(&"pointer_rotation_started", anchor)
	_begin_pointer_capture(anchor)


func _end_pointer_rotation() -> void:
	if not _rotating:
		return

	_rotating = false
	_end_pointer_capture()
	_host.emit_signal(&"pointer_rotation_ended", _pointer_rotation_anchor)


func _edge_scroll_input() -> Vector2:
	if (
		not get_window().has_focus()
		or _pan_hold_pending
		or _panning
		or _rotating
	):
		return Vector2.ZERO

	var viewport := get_viewport()

	if viewport.gui_is_dragging() or viewport.gui_get_hovered_control() != null:
		return Vector2.ZERO

	var size := viewport.get_visible_rect().size
	var mouse := viewport.get_mouse_position()

	if size.x <= 0.0 or size.y <= 0.0:
		return Vector2.ZERO

	if mouse.x < 0.0 or mouse.y < 0.0 or mouse.x > size.x or mouse.y > size.y:
		return Vector2.ZERO

	if _edge_scroll_waiting_for_motion:
		if mouse.distance_squared_to(_edge_scroll_block_position) <= 4.0:
			return Vector2.ZERO

		_edge_scroll_waiting_for_motion = false

	return Vector2(
		_edge_scroll_axis(mouse.x, size.x),
		_edge_scroll_axis(mouse.y, size.y)
	).limit_length(1.0)


func _edge_scroll_axis(position: float, extent: float) -> float:
	var margin := minf(EDGE_SCROLL_MARGIN, extent * 0.5)

	if position < margin:
		return -1.0

	if position > extent - margin:
		return 1.0

	return 0.0


func _suppress_edge_scroll_until_motion(position: Vector2) -> void:
	_edge_scroll_waiting_for_motion = true
	_edge_scroll_block_position = position


func _keyboard_pan_blocked_by_gui() -> bool:
	var focus_owner := get_viewport().gui_get_focus_owner()
	return focus_owner is LineEdit or focus_owner is TextEdit


func _end_pointer_pan() -> void:
	if not _panning:
		return

	_panning = false
	_end_pointer_capture()
	_host.emit_signal(&"pointer_pan_ended", _pointer_pan_anchor)


func _begin_pointer_capture(position: Vector2) -> void:
	if _pointer_capture_active:
		return

	_pointer_capture_active = true
	_pointer_restore_mouse_mode = Input.mouse_mode
	_pointer_restore_mouse_position = position
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func _end_pointer_capture() -> void:
	if not _pointer_capture_active:
		return

	_pointer_capture_active = false
	Input.mouse_mode = _pointer_restore_mouse_mode

	if _pointer_restore_mouse_mode != Input.MOUSE_MODE_CAPTURED:
		get_viewport().warp_mouse(_pointer_restore_mouse_position)
		_suppress_edge_scroll_until_motion(_pointer_restore_mouse_position)


func reset_pointer_state() -> void:
	_cancel_pointer_pan_hold()

	if _panning:
		_end_pointer_pan()
	elif _rotating:
		_end_pointer_rotation()
	else:
		_end_pointer_capture()

	_suppress_edge_scroll_until_motion(
		get_viewport().get_mouse_position()
	)
