class_name StrategyCamera
extends Node3D;


const MIN_ZOOM := 5.0;
const MAX_ZOOM := 120.0;
const INITIAL_ZOOM := 30.0;

const NEAR_PITCH := 25.0;
const FAR_PITCH := 65.0;
const ZOOM_ARC_CURVE := 0.75;
const RIG_TARGET_HEIGHT := 1.5;

const MIN_VIEW_PITCH := -30.0;
const MAX_VIEW_PITCH := 75.0;

const PAN_SCREEN_SPEED := 1.5;
const EDGE_SCROLL_MARGIN := 24.0;
const MOVE_SMOOTHING := 16.0;
const ZOOM_SMOOTHING := 18.0;
const ZOOM_FACTOR := 0.85;

const MOUSE_YAW_SENSITIVITY := 0.2;
const MOUSE_PITCH_SENSITIVITY := 0.2;

const MAX_INPUT_DELTA := 0.1;
const MAX_DIRECT_GROUND_DISTANCE_FACTOR := 6.0;

const PAN_LEFT_ACTION: StringName = &"camera_left";
const PAN_RIGHT_ACTION: StringName = &"camera_right";
const PAN_FORWARD_ACTION: StringName = &"camera_forward";
const PAN_BACK_ACTION: StringName = &"camera_back";


@onready var camera: Camera3D = $Camera3D;


var _ground_height := 0.0;

var _focus: Vector3;
var _target_focus: Vector3;

var _zoom := INITIAL_ZOOM;
var _target_zoom := INITIAL_ZOOM;
var _zoom_transition_active := false;

var _yaw := 0.0;
var _pitch_offset := 0.0;

var _pan_input_active := false;
var _edge_scroll_waiting_for_motion := false;
var _edge_scroll_block_position := Vector2.ZERO;

var _dragging := false;
var _drag_anchor_valid := false;
var _drag_anchor: Vector3;

var _rotating := false;
var _rotation_capture_active := false;
var _rotation_restore_mouse_mode: Input.MouseMode = Input.MOUSE_MODE_VISIBLE;
var _rotation_restore_mouse_position: Vector2;

var _zoom_anchor_active := false;
var _zoom_anchor_screen: Vector2;
var _zoom_anchor_world: Vector3;


func _ready() -> void:
	_focus = global_position;
	_ground_height = _focus.y;
	_focus.y = _ground_height;
	_target_focus = _focus;

	_yaw = global_rotation.y;
	global_rotation = Vector3.ZERO;

	camera.make_current();
	get_window().focus_exited.connect(_reset_pointer_state);

	_apply_camera_transform();


func _process(delta: float) -> void:
	_handle_pan_input(minf(delta, MAX_INPUT_DELTA));

	var move_t := _smooth_factor(MOVE_SMOOTHING, delta);
	var zoom_t := _smooth_factor(ZOOM_SMOOTHING, delta);

	_focus = _focus.lerp(_target_focus, move_t);
	_focus.y = _ground_height;
	_zoom = lerpf(_zoom, _target_zoom, zoom_t);

	if _zoom_transition_active:
		_pitch_offset = lerpf(_pitch_offset, 0.0, zoom_t);

	_apply_camera_transform();
	_update_zoom_anchor();

	if _zoom_anchor_active:
		_apply_camera_transform();

	if _zoom_transition_active and absf(_zoom - _target_zoom) < 0.001:
		_zoom = _target_zoom;
		_pitch_offset = 0.0;
		_zoom_transition_active = false;
		_zoom_anchor_active = false;


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		_handle_mouse_button(event as InputEventMouseButton);
	elif event is InputEventMouseMotion:
		var motion := event as InputEventMouseMotion;

		if _dragging:
			_handle_drag(motion);
		elif _rotating:
			_handle_rotation(motion);


func _handle_mouse_button(event: InputEventMouseButton) -> void:
	if event.button_index == MOUSE_BUTTON_MIDDLE:
		_rotating = event.pressed and not event.canceled;
		_zoom_anchor_active = false;

		if _rotating:
			_dragging = false;
			_drag_anchor_valid = false;
			_target_focus = _focus;
			_target_zoom = _zoom;
			_zoom_transition_active = false;
			_begin_rotation_capture(event.position);
		else:
			_end_rotation_capture();

		get_viewport().set_input_as_handled();
		return;

	if event.button_index == MOUSE_BUTTON_RIGHT:
		_dragging = event.pressed and not event.canceled;
		_drag_anchor_valid = false;
		_zoom_anchor_active = false;

		if _dragging:
			_rotating = false;
			_end_rotation_capture();
			_target_focus = _focus;
			_target_zoom = _zoom;
			_zoom_transition_active = false;

			var point := _world_at_screen(event.position);

			if _ground_point_is_usable(point):
				_drag_anchor = point;
				_drag_anchor_valid = true;
		else:
			_suppress_edge_scroll_until_motion(event.position);

		get_viewport().set_input_as_handled();
		return;

	if not event.pressed or event.canceled or _dragging or _rotating:
		return;

	if event.button_index == MOUSE_BUTTON_WHEEL_UP:
		_zoom_at(event.position, true, event.factor);
		get_viewport().set_input_as_handled();
	elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
		_zoom_at(event.position, false, event.factor);
		get_viewport().set_input_as_handled();


func _handle_rotation(event: InputEventMouseMotion) -> void:
	_yaw = wrapf(
		_yaw - deg_to_rad(event.screen_relative.x * MOUSE_YAW_SENSITIVITY),
		-PI,
		PI
	);

	var base_pitch := _base_pitch_for_zoom(_zoom);
	var min_offset := deg_to_rad(MIN_VIEW_PITCH) - base_pitch;
	var max_offset := deg_to_rad(MAX_VIEW_PITCH) - base_pitch;

	_pitch_offset = clampf(
		_pitch_offset + deg_to_rad(event.screen_relative.y * MOUSE_PITCH_SENSITIVITY),
		min_offset,
		max_offset
	);

	_apply_camera_transform();
	get_viewport().set_input_as_handled();


func _handle_drag(event: InputEventMouseMotion) -> void:
	var current := _world_at_screen(event.position);

	if not _ground_point_is_usable(current):
		_drag_anchor_valid = false;
		return;

	if not _drag_anchor_valid:
		_drag_anchor = current;
		_drag_anchor_valid = true;
		return;

	var offset := _drag_anchor - current;
	offset.y = 0.0;

	_focus += offset;
	_target_focus = _focus;

	_apply_camera_transform();
	get_viewport().set_input_as_handled();


func _handle_pan_input(delta: float) -> void:
	if _keyboard_pan_blocked_by_gui():
		_pan_input_active = false;
		return;

	var keyboard := Input.get_vector(
		PAN_LEFT_ACTION,
		PAN_RIGHT_ACTION,
		PAN_FORWARD_ACTION,
		PAN_BACK_ACTION
	);
	var input := (keyboard + _edge_scroll_input()).limit_length(1.0);

	if input == Vector2.ZERO:
		_pan_input_active = false;
		return;

	if not _pan_input_active:
		_target_focus = _focus;
		_pan_input_active = true;

	_zoom_anchor_active = false;

	var right := Vector3(cos(_yaw), 0.0, -sin(_yaw));
	var backward := Vector3(sin(_yaw), 0.0, cos(_yaw));
	var speed := _pan_speed();

	_target_focus += (
		right * input.x
		+ backward * input.y
	) * speed * delta;


func _edge_scroll_input() -> Vector2:
	if not get_window().has_focus() or _dragging or _rotating:
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
	var distance := _rig_distance_for_zoom(_zoom);
	var half_fov_tan := tan(deg_to_rad(camera.fov) * 0.5);
	var visible_height := 2.0 * distance * half_fov_tan;

	return visible_height * PAN_SCREEN_SPEED;


func _zoom_at(screen_position: Vector2, zoom_in: bool, event_factor: float) -> void:
	if not _zoom_transition_active:
		_target_zoom = _zoom;
		_zoom_transition_active = true;

	_begin_zoom_anchor(screen_position);

	var amount := event_factor if event_factor > 0.0 else 1.0;
	var multiplier: float = pow(ZOOM_FACTOR, amount);

	if zoom_in:
		_target_zoom *= multiplier;
	else:
		_target_zoom /= multiplier;

	_target_zoom = clampf(_target_zoom, MIN_ZOOM, MAX_ZOOM);


func _begin_zoom_anchor(screen_position: Vector2) -> void:
	var point := _world_at_screen(screen_position);

	if not _ground_point_is_usable(point):
		_zoom_anchor_active = false;
		return;

	_target_focus = _focus;
	_zoom_anchor_screen = screen_position;
	_zoom_anchor_world = point;
	_zoom_anchor_active = true;


func _update_zoom_anchor() -> void:
	if not _zoom_anchor_active:
		return;

	var current := _world_at_screen(_zoom_anchor_screen);

	if not _ground_point_is_usable(current):
		_zoom_anchor_active = false;
		return;

	var offset := _zoom_anchor_world - current;
	offset.y = 0.0;

	_focus += offset;
	_target_focus += offset;


func _ground_point_is_usable(point: Vector3) -> bool:
	if not point.is_finite():
		return false;

	var eye := _camera_position();
	var max_distance := _rig_distance_for_zoom(_zoom) * MAX_DIRECT_GROUND_DISTANCE_FACTOR;

	return eye.distance_to(point) <= max_distance;


func _world_at_screen(screen_position: Vector2) -> Vector3:
	var origin := camera.project_ray_origin(screen_position);
	var direction := camera.project_ray_normal(screen_position);

	if absf(direction.y) < 0.00001:
		return Vector3.INF;

	var distance := (_ground_height - origin.y) / direction.y;

	if distance < 0.0:
		return Vector3.INF;

	return origin + direction * distance;


func _camera_position() -> Vector3:
	var base_pitch := _base_pitch_for_zoom(_zoom);
	var distance := _rig_distance_for_zoom(_zoom);
	var target := _focus + Vector3.UP * RIG_TARGET_HEIGHT;

	return target - _view_direction(_yaw, base_pitch) * distance;


func _apply_camera_transform() -> void:
	global_position = _focus;
	camera.global_position = _camera_position();
	camera.look_at(
		camera.global_position + _view_direction(_yaw, _view_pitch()),
		Vector3.UP
	);


func _view_pitch() -> float:
	return clampf(
		_base_pitch_for_zoom(_zoom) + _pitch_offset,
		deg_to_rad(MIN_VIEW_PITCH),
		deg_to_rad(MAX_VIEW_PITCH)
	);


func _rig_distance_for_zoom(zoom: float) -> float:
	var base_pitch := _base_pitch_for_zoom(zoom);
	var vertical_span := maxf(zoom - RIG_TARGET_HEIGHT, 0.001);

	return vertical_span / maxf(sin(base_pitch), 0.001);


func _base_pitch_for_zoom(zoom: float) -> float:
	return deg_to_rad(
		lerpf(
			NEAR_PITCH,
			FAR_PITCH,
			_zoom_arc_ratio(zoom)
		)
	);


func _zoom_arc_ratio(zoom: float) -> float:
	var ratio := _normalized_zoom(zoom);
	var smooth_ratio := ratio * ratio * (3.0 - 2.0 * ratio);

	return pow(smooth_ratio, ZOOM_ARC_CURVE);


func _normalized_zoom(zoom: float) -> float:
	var safe_zoom := clampf(zoom, MIN_ZOOM, MAX_ZOOM);

	return clampf(
		log(safe_zoom / MIN_ZOOM) / log(MAX_ZOOM / MIN_ZOOM),
		0.0,
		1.0
	);


func _view_direction(yaw: float, pitch: float) -> Vector3:
	var horizontal := cos(pitch);

	return Vector3(
		-sin(yaw) * horizontal,
		-sin(pitch),
		-cos(yaw) * horizontal
	);


func _begin_rotation_capture(position: Vector2) -> void:
	if _rotation_capture_active:
		return;

	_rotation_capture_active = true;
	_rotation_restore_mouse_mode = Input.mouse_mode;
	_rotation_restore_mouse_position = position;
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED;


func _end_rotation_capture() -> void:
	if not _rotation_capture_active:
		return;

	_rotation_capture_active = false;
	Input.mouse_mode = _rotation_restore_mouse_mode;

	if _rotation_restore_mouse_mode != Input.MOUSE_MODE_CAPTURED:
		Input.warp_mouse(_rotation_restore_mouse_position);
		_suppress_edge_scroll_until_motion(_rotation_restore_mouse_position);


func _reset_pointer_state() -> void:
	_end_rotation_capture();
	_dragging = false;
	_drag_anchor_valid = false;
	_rotating = false;
	_zoom_anchor_active = false;
	_suppress_edge_scroll_until_motion(get_viewport().get_mouse_position());


func _smooth_factor(speed: float, delta: float) -> float:
	return 1.0 - exp(-speed * delta);


func focus_on(position: Vector3, immediate := false) -> void:
	position.y = _ground_height;
	_target_focus = position;
	_pan_input_active = false;
	_zoom_anchor_active = false;

	if immediate:
		_focus = _target_focus;
		_apply_camera_transform();


func zoom_to(height: float, immediate := false) -> void:
	_target_zoom = clampf(height, MIN_ZOOM, MAX_ZOOM);
	_zoom_transition_active = true;
	_zoom_anchor_active = false;

	if immediate:
		_zoom = _target_zoom;
		_pitch_offset = 0.0;
		_zoom_transition_active = false;
		_apply_camera_transform();


func get_focus_position() -> Vector3:
	return _focus;


func get_zoom() -> float:
	return _zoom;


func get_yaw() -> float:
	return rad_to_deg(_yaw);


func get_pitch() -> float:
	return rad_to_deg(_view_pitch());
