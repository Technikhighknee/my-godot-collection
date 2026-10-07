class_name StrategyCamera
extends Node3D;


signal pointer_pan_started(anchor: Vector2);
signal pointer_pan_ended(anchor: Vector2);


const MIN_HEIGHT := 5.0;
const MAX_HEIGHT := 120.0;
const INITIAL_HEIGHT := 28.7135;
const HEIGHT_STEP := 0.05;

const NEAR_MIN_TILT := 65.0;
const FAR_MIN_TILT := 25.0;
const MAX_TILT := 90.0;

const PAN_SCREEN_SPEED := 1.5;
const EDGE_SCROLL_MARGIN := 24.0;
const POINTER_PAN_HOLD_DELAY := 0.12;
const MOVE_SMOOTHING := 16.0;
const HEIGHT_SMOOTHING := 18.0;

const MOUSE_YAW_SENSITIVITY := 0.2;
const MOUSE_TILT_SENSITIVITY := 0.2;

const MAX_INPUT_DELTA := 0.1;

const PAN_LEFT_ACTION: StringName = &"camera_left";
const PAN_RIGHT_ACTION: StringName = &"camera_right";
const PAN_FORWARD_ACTION: StringName = &"camera_forward";
const PAN_BACK_ACTION: StringName = &"camera_back";


@onready var camera: Camera3D = $Camera3D;


var _ground_height := 0.0;

var _focus: Vector3;
var _target_focus: Vector3;
var _follow_target: Node3D = null;

var _height := INITIAL_HEIGHT;
var _target_height := INITIAL_HEIGHT;

var _yaw := 0.0;
var _tilt_ratio := 0.0;

var _pan_input_active := false;
var _edge_scroll_waiting_for_motion := false;
var _edge_scroll_block_position := Vector2.ZERO;

var _panning := false;
var _pan_hold_pending := false;
var _pan_hold_elapsed := 0.0;
var _pointer_pan_anchor := Vector2.ZERO;
var _rotating := false;

var _pointer_capture_active := false;
var _pointer_restore_mouse_mode: Input.MouseMode = Input.MOUSE_MODE_VISIBLE;
var _pointer_restore_mouse_position := Vector2.ZERO;


func _ready() -> void:
	_assert_input_actions();

	_focus = global_position;
	_ground_height = _focus.y;
	_focus.y = _ground_height;
	_target_focus = _focus;

	_yaw = global_rotation.y;
	global_rotation = Vector3.ZERO;

	camera.make_current();
	get_window().focus_exited.connect(_reset_pointer_state);

	_apply_camera_transform();


func _assert_input_actions() -> void:
	var missing := PackedStringArray();

	if not InputMap.has_action(PAN_LEFT_ACTION):
		missing.append(String(PAN_LEFT_ACTION));

	if not InputMap.has_action(PAN_RIGHT_ACTION):
		missing.append(String(PAN_RIGHT_ACTION));

	if not InputMap.has_action(PAN_FORWARD_ACTION):
		missing.append(String(PAN_FORWARD_ACTION));

	if not InputMap.has_action(PAN_BACK_ACTION):
		missing.append(String(PAN_BACK_ACTION));

	assert(
		missing.is_empty(),
		"StrategyCamera requires these missing Input Map actions: %s"
		% ", ".join(missing)
	);


func _process(delta: float) -> void:
	_reconcile_pointer_buttons();
	_update_pointer_pan_hold(delta);
	_sync_follow_target();
	_handle_pan_input(minf(delta, MAX_INPUT_DELTA));

	var move_t := _smooth_factor(MOVE_SMOOTHING, delta);
	var height_t := _smooth_factor(HEIGHT_SMOOTHING, delta);

	if _follow_target == null:
		_focus = _focus.lerp(_target_focus, move_t);
		_focus.y = _ground_height;

	_height = lerpf(_height, _target_height, height_t);

	if absf(_height - _target_height) < 0.001:
		_height = _target_height;

	_apply_camera_transform();


func _sync_follow_target() -> void:
	if _follow_target == null:
		return;

	if (
		not is_instance_valid(_follow_target)
		or not _follow_target.is_inside_tree()
	):
		_stop_following_internal();
		return;

	var position := _follow_target.global_position;
	_focus = position;
	_target_focus = position;
	_ground_height = position.y;


func _stop_following_internal() -> void:
	if _follow_target == null:
		return;

	_follow_target = null;
	_ground_height = _focus.y;
	_target_focus = _focus;


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		_handle_mouse_button(event as InputEventMouseButton);
	elif event is InputEventMouseMotion:
		var motion := event as InputEventMouseMotion;

		if _panning:
			_handle_pointer_pan(motion);
		elif _rotating:
			_handle_rotation(motion);


func _reconcile_pointer_buttons() -> void:
	if _rotating and not Input.is_mouse_button_pressed(MOUSE_BUTTON_MIDDLE):
		_rotating = false;
		_end_pointer_capture();

	if _pan_hold_pending and not Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT):
		_cancel_pointer_pan_hold();

	if _panning and not Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT):
		_end_pointer_pan();


func _update_pointer_pan_hold(delta: float) -> void:
	if not _pan_hold_pending:
		return;

	if not Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT):
		_cancel_pointer_pan_hold();
		return;

	_pan_hold_elapsed += delta;

	if _pan_hold_elapsed < POINTER_PAN_HOLD_DELAY:
		return;

	_pan_hold_pending = false;
	_pan_hold_elapsed = 0.0;

	if _rotating:
		_rotating = false;
		_pointer_pan_anchor = _pointer_restore_mouse_position;
		_end_pointer_capture();
	else:
		_pointer_pan_anchor = get_viewport().get_mouse_position();

	_panning = true;
	_target_focus = _focus;
	pointer_pan_started.emit(_pointer_pan_anchor);
	_begin_pointer_capture(_pointer_pan_anchor);


func _cancel_pointer_pan_hold() -> void:
	_pan_hold_pending = false;
	_pan_hold_elapsed = 0.0;


func _handle_mouse_button(event: InputEventMouseButton) -> void:
	if event.button_index == MOUSE_BUTTON_MIDDLE:
		_rotating = event.pressed and not event.canceled;

		if _rotating:
			_cancel_pointer_pan_hold();

			var capture_position := event.position;

			if _panning:
				capture_position = _pointer_pan_anchor;
				_end_pointer_pan();

			_target_focus = _focus;
			_begin_pointer_capture(capture_position);
		elif not _panning:
			_end_pointer_capture();

		get_viewport().set_input_as_handled();
		return;

	if event.button_index == MOUSE_BUTTON_RIGHT:
		if event.pressed and not event.canceled:
			_pan_hold_pending = true;
			_pan_hold_elapsed = 0.0;
			return;

		if _panning:
			_end_pointer_pan();
			get_viewport().set_input_as_handled();
		else:
			_cancel_pointer_pan_hold();

		return;

	if not event.pressed or event.canceled or _panning or _rotating:
		return;

	if event.button_index == MOUSE_BUTTON_WHEEL_UP:
		_change_height(-1.0, event.factor);
		get_viewport().set_input_as_handled();
	elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
		_change_height(1.0, event.factor);
		get_viewport().set_input_as_handled();


func _handle_rotation(event: InputEventMouseMotion) -> void:
	_yaw = wrapf(
		_yaw - deg_to_rad(event.screen_relative.x * MOUSE_YAW_SENSITIVITY),
		-PI,
		PI
	);

	var tilt := _view_tilt();
	tilt -= deg_to_rad(
		event.screen_relative.y * MOUSE_TILT_SENSITIVITY
	);
	_set_view_tilt(tilt);

	_apply_camera_transform();
	get_viewport().set_input_as_handled();


func _handle_pointer_pan(event: InputEventMouseMotion) -> void:
	var motion := event.screen_relative;

	if motion == Vector2.ZERO:
		return;

	_stop_following_internal();

	var world_delta := _pan_world_delta(
		motion,
		_world_units_per_pixel()
	);

	_focus += world_delta;
	_target_focus = _focus;

	_apply_camera_transform();
	get_viewport().set_input_as_handled();


func _handle_pan_input(delta: float) -> void:
	if _panning or _rotating or _keyboard_pan_blocked_by_gui():
		_pan_input_active = false;
		return;

	var keyboard := Input.get_vector(
		PAN_LEFT_ACTION,
		PAN_RIGHT_ACTION,
		PAN_FORWARD_ACTION,
		PAN_BACK_ACTION
	);
	var input_vector := (keyboard + _edge_scroll_input()).limit_length(1.0);

	if input_vector == Vector2.ZERO:
		_pan_input_active = false;
		return;

	_stop_following_internal();

	if not _pan_input_active:
		_target_focus = _focus;
		_pan_input_active = true;

	_target_focus += _pan_world_delta(
		input_vector,
		_pan_speed() * delta
	);


func _pan_world_delta(direction: Vector2, distance: float) -> Vector3:
	var right := Vector3(cos(_yaw), 0.0, -sin(_yaw));
	var backward := Vector3(sin(_yaw), 0.0, cos(_yaw));

	return (
		right * direction.x
		+ backward * direction.y
	) * distance;


func _edge_scroll_input() -> Vector2:
	if (
		not get_window().has_focus()
		or _pan_hold_pending
		or _panning
		or _rotating
	):
		return Vector2.ZERO;

	var viewport := get_viewport();

	if viewport.gui_is_dragging() or viewport.gui_get_hovered_control() != null:
		return Vector2.ZERO;

	var size := viewport.get_visible_rect().size;
	var mouse := viewport.get_mouse_position();

	if size.x <= 0.0 or size.y <= 0.0:
		return Vector2.ZERO;

	if mouse.x < 0.0 or mouse.y < 0.0 or mouse.x > size.x or mouse.y > size.y:
		return Vector2.ZERO;

	if _edge_scroll_waiting_for_motion:
		if mouse.distance_squared_to(_edge_scroll_block_position) <= 4.0:
			return Vector2.ZERO;

		_edge_scroll_waiting_for_motion = false;

	return Vector2(
		_edge_scroll_axis(mouse.x, size.x),
		_edge_scroll_axis(mouse.y, size.y)
	).limit_length(1.0);


func _edge_scroll_axis(position: float, extent: float) -> float:
	var margin := minf(EDGE_SCROLL_MARGIN, extent * 0.5);

	if position < margin:
		return -1.0;

	if position > extent - margin:
		return 1.0;

	return 0.0;


func _suppress_edge_scroll_until_motion(position: Vector2) -> void:
	_edge_scroll_waiting_for_motion = true;
	_edge_scroll_block_position = position;


func _keyboard_pan_blocked_by_gui() -> bool:
	var focus_owner := get_viewport().gui_get_focus_owner();
	return focus_owner is LineEdit or focus_owner is TextEdit;


func _pan_speed() -> float:
	return _world_span_at_height() * PAN_SCREEN_SPEED;


func _world_units_per_pixel() -> float:
	var viewport_height := get_viewport().get_visible_rect().size.y;

	if viewport_height <= 0.0:
		return 0.0;

	return _world_span_at_height() / viewport_height;


func _world_span_at_height() -> float:
	var half_fov_tan := tan(deg_to_rad(camera.fov) * 0.5);
	return 2.0 * _height * half_fov_tan;


func _change_height(direction: float, event_factor: float) -> void:
	var amount := event_factor if event_factor > 0.0 else 1.0;
	var ratio := _normalized_height(_target_height);

	ratio = clampf(
		ratio + direction * HEIGHT_STEP * amount,
		0.0,
		1.0
	);
	_target_height = _height_for_ratio(ratio);


func _view_tilt() -> float:
	var min_tilt := _min_tilt_for_height(_height);
	return lerpf(min_tilt, deg_to_rad(MAX_TILT), _tilt_ratio);


func _set_view_tilt(tilt: float) -> void:
	var min_tilt := _min_tilt_for_height(_height);
	var max_tilt := deg_to_rad(MAX_TILT);
	var clamped := clampf(tilt, min_tilt, max_tilt);
	var span := max_tilt - min_tilt;

	_tilt_ratio = 0.0 if span <= 0.0 else (clamped - min_tilt) / span;


func _min_tilt_for_height(height: float) -> float:
	return deg_to_rad(
		lerpf(
			NEAR_MIN_TILT,
			FAR_MIN_TILT,
			_normalized_height(height)
		)
	);


func _normalized_height(height: float) -> float:
	var safe_height := clampf(height, MIN_HEIGHT, MAX_HEIGHT);

	return clampf(
		log(safe_height / MIN_HEIGHT) / log(MAX_HEIGHT / MIN_HEIGHT),
		0.0,
		1.0
	);


func _height_for_ratio(ratio: float) -> float:
	var safe_ratio := clampf(ratio, 0.0, 1.0);
	return MIN_HEIGHT * pow(MAX_HEIGHT / MIN_HEIGHT, safe_ratio);


func _view_direction() -> Vector3:
	var tilt := _view_tilt();
	var horizontal := sin(tilt);

	return Vector3(
		-sin(_yaw) * horizontal,
		-cos(tilt),
		-cos(_yaw) * horizontal
	);


func _apply_camera_transform() -> void:
	global_position = _focus;
	camera.global_position = _focus + Vector3.UP * _height;
	camera.look_at(
		camera.global_position + _view_direction(),
		Vector3.UP
	);


func _end_pointer_pan() -> void:
	if not _panning:
		return;

	_panning = false;
	_end_pointer_capture();
	pointer_pan_ended.emit(_pointer_pan_anchor);


func _begin_pointer_capture(position: Vector2) -> void:
	if _pointer_capture_active:
		return;

	_pointer_capture_active = true;
	_pointer_restore_mouse_mode = Input.mouse_mode;
	_pointer_restore_mouse_position = position;
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED;


func _end_pointer_capture() -> void:
	if not _pointer_capture_active:
		return;

	_pointer_capture_active = false;
	Input.mouse_mode = _pointer_restore_mouse_mode;

	if _pointer_restore_mouse_mode != Input.MOUSE_MODE_CAPTURED:
		get_viewport().warp_mouse(_pointer_restore_mouse_position);
		_suppress_edge_scroll_until_motion(_pointer_restore_mouse_position);


func _reset_pointer_state() -> void:
	_cancel_pointer_pan_hold();

	if _panning:
		_end_pointer_pan();
	else:
		_end_pointer_capture();

	_rotating = false;
	_suppress_edge_scroll_until_motion(
		get_viewport().get_mouse_position()
	);


func _smooth_factor(speed: float, delta: float) -> float:
	return 1.0 - exp(-speed * delta);


func follow(target: Node3D) -> void:
	assert(target != null, "StrategyCamera cannot follow a null target.");
	assert(target != self, "StrategyCamera cannot follow itself.");
	assert(
		not self.is_ancestor_of(target),
		"StrategyCamera cannot follow one of its own descendants."
	);
	assert(
		target.is_inside_tree(),
		"StrategyCamera can only follow a target that is inside the scene tree."
	);

	var delta := target.global_position - _focus;

	if Vector2(delta.x, delta.z).length_squared() > 0.000001:
		_yaw = atan2(-delta.x, -delta.z);

	_follow_target = target;
	_tilt_ratio = 0.0;
	_pan_input_active = false;
	_suppress_edge_scroll_until_motion(
		get_viewport().get_mouse_position()
	);
	_sync_follow_target();
	_apply_camera_transform();


func stop_following() -> void:
	_stop_following_internal();


func is_following() -> bool:
	return (
		_follow_target != null
		and is_instance_valid(_follow_target)
		and _follow_target.is_inside_tree()
	);


func focus_on(position: Vector3, immediate := false) -> void:
	_stop_following_internal();
	position.y = _ground_height;
	_target_focus = position;
	_pan_input_active = false;

	if immediate:
		_focus = _target_focus;
		_apply_camera_transform();


func set_height(height: float, immediate := false) -> void:
	_target_height = clampf(height, MIN_HEIGHT, MAX_HEIGHT);

	if immediate:
		_height = _target_height;
		_apply_camera_transform();


func get_focus_position() -> Vector3:
	return _focus;


func get_height() -> float:
	return _height;


func get_yaw() -> float:
	return rad_to_deg(_yaw);


func get_tilt() -> float:
	return rad_to_deg(_view_tilt());
