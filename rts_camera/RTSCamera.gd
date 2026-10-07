class_name RTSCamera
extends Node3D;


enum RotationMode {
	LOOK,
	ORBIT,
}


const MAX_INPUT_DELTA := 0.1;


@export_group("Camera")
@export var initial_yaw := 0.0;
@export_range(10.0, 85.0, 0.1) var initial_pitch := 50.0;
@export_range(5.0, 80.0, 0.1) var min_pitch := 25.0;
@export_range(10.0, 89.0, 0.1) var max_pitch := 75.0;
@export var initial_zoom := 30.0;
@export var min_zoom := 5.0;
@export var max_zoom := 120.0;

@export_group("Movement")
@export var min_pan_speed := 4.0;
@export var max_pan_speed := 110.0;
@export var move_smoothing := 16.0;

@export_group("Zoom")
@export_range(0.5, 0.99, 0.01) var zoom_factor := 0.85;
@export var zoom_smoothing := 18.0;

@export_group("Rotation")
@export_enum("Look", "Orbit") var rotation_mode := RotationMode.LOOK;
@export var rotation_enabled := true;
@export var mouse_yaw_sensitivity := 0.2;
@export var mouse_pitch_sensitivity := 0.2;
@export var rotation_smoothing := 18.0;

@export_group("World")
@export var ground_height := 0.0;

@export_group("Input")
@export var input_enabled := true;
@export var pan_left_action: StringName = &"camera_left";
@export var pan_right_action: StringName = &"camera_right";
@export var pan_forward_action: StringName = &"camera_forward";
@export var pan_back_action: StringName = &"camera_back";
@export var rotate_button: MouseButton = MOUSE_BUTTON_MIDDLE;
@export var drag_button: MouseButton = MOUSE_BUTTON_RIGHT;


@onready var camera: Camera3D = $Camera3D;


var _focus: Vector3;
var _target_focus: Vector3;
var _zoom: float;
var _target_zoom: float;
var _yaw: float;
var _target_yaw: float;
var _pitch: float;
var _target_pitch: float;

var _dragging := false;
var _drag_anchor_valid := false;
var _drag_anchor: Vector3;

var _rotating := false;

var _look_transition_active := false;
var _look_transition_eye: Vector3;

var _zoom_anchor_active := false;
var _zoom_anchor_screen: Vector2;
var _zoom_anchor_world: Vector3;


func _ready() -> void:
	_focus = global_position;
	_focus.y = ground_height;
	_target_focus = _focus;

	_zoom = clampf(initial_zoom, min_zoom, max_zoom);
	_target_zoom = _zoom;

	_yaw = deg_to_rad(initial_yaw);
	_target_yaw = _yaw;

	_pitch = deg_to_rad(clampf(initial_pitch, min_pitch, max_pitch));
	_target_pitch = _pitch;

	camera.make_current();
	get_window().focus_exited.connect(_reset_transient_input);

	_apply_camera_transform();


func _process(delta: float) -> void:
	if not input_enabled:
		_reset_transient_input();
	else:
		_handle_keyboard(minf(delta, MAX_INPUT_DELTA));

	var move_t := _smooth_factor(move_smoothing, delta);
	var zoom_t := _smooth_factor(zoom_smoothing, delta);
	var rotation_t := _smooth_factor(rotation_smoothing, delta);

	if _look_transition_active:
		_yaw = lerp_angle(_yaw, _target_yaw, rotation_t);
		_pitch = lerpf(_pitch, _target_pitch, rotation_t);
		_apply_look_from_eye(_look_transition_eye);

		if _rotation_at_target():
			_yaw = _target_yaw;
			_pitch = _target_pitch;
			_apply_look_from_eye(_look_transition_eye);
			_look_transition_active = false;
	else:
		_focus = _focus.lerp(_target_focus, move_t);
		_focus.y = ground_height;
		_zoom = lerpf(_zoom, _target_zoom, zoom_t);
		_yaw = lerp_angle(_yaw, _target_yaw, rotation_t);
		_pitch = lerpf(_pitch, _target_pitch, rotation_t);

	_apply_camera_transform();
	_update_zoom_anchor();


func _unhandled_input(event: InputEvent) -> void:
	if not input_enabled:
		return;

	if event is InputEventMouseButton:
		_handle_mouse_button(event as InputEventMouseButton);
	elif event is InputEventMouseMotion:
		var motion := event as InputEventMouseMotion;

		if _dragging:
			_handle_drag(motion);
		elif _rotating:
			_handle_rotation(motion);


func _handle_mouse_button(event: InputEventMouseButton) -> void:
	if rotation_enabled and event.button_index == rotate_button:
		_rotating = event.pressed and not event.canceled;
		_zoom_anchor_active = false;
		_cancel_look_transition();

		if _rotating:
			_dragging = false;
			_drag_anchor_valid = false;
			_target_focus = _focus;
			_target_zoom = _zoom;
			_target_yaw = _yaw;
			_target_pitch = _pitch;

		get_viewport().set_input_as_handled();
		return;

	if event.button_index == drag_button:
		_dragging = event.pressed and not event.canceled;
		_drag_anchor_valid = false;
		_zoom_anchor_active = false;
		_cancel_look_transition();

		if _dragging:
			_rotating = false;
			_target_focus = _focus;
			_target_zoom = _zoom;
			var point := _world_at_screen(event.position);

			if point.is_finite():
				_drag_anchor = point;
				_drag_anchor_valid = true;

		get_viewport().set_input_as_handled();
		return;

	if not event.pressed or event.canceled:
		return;

	if event.button_index == MOUSE_BUTTON_WHEEL_UP:
		_cancel_look_transition();
		_zoom_at(event.position, true, event.factor);
		get_viewport().set_input_as_handled();
	elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
		_cancel_look_transition();
		_zoom_at(event.position, false, event.factor);
		get_viewport().set_input_as_handled();


func _handle_keyboard(delta: float) -> void:
	var input := Input.get_vector(pan_left_action, pan_right_action, pan_forward_action, pan_back_action);

	if input == Vector2.ZERO:
		return;

	_zoom_anchor_active = false;
	_cancel_look_transition();

	var right := Vector3(cos(_yaw), 0.0, -sin(_yaw));
	var backward := Vector3(sin(_yaw), 0.0, cos(_yaw));
	var movement := right * input.x + backward * input.y;

	_target_focus += movement * _get_pan_speed() * delta;


func _handle_drag(event: InputEventMouseMotion) -> void:
	if not _drag_anchor_valid:
		return;

	var current := _world_at_screen(event.position);

	if not current.is_finite():
		return;

	var offset := _drag_anchor - current;
	offset.y = 0.0;

	_focus += offset;
	_target_focus += offset;

	_apply_camera_transform();
	get_viewport().set_input_as_handled();


func _handle_rotation(event: InputEventMouseMotion) -> void:
	var yaw_delta := deg_to_rad(-event.relative.x * mouse_yaw_sensitivity);
	var pitch_delta := deg_to_rad(event.relative.y * mouse_pitch_sensitivity);

	if rotation_mode == RotationMode.LOOK:
		_rotate_look(yaw_delta, pitch_delta);
	else:
		_rotate_orbit(yaw_delta, pitch_delta);

	_apply_camera_transform();
	get_viewport().set_input_as_handled();


func _rotate_look(yaw_delta: float, pitch_delta: float) -> void:
	var eye := camera.global_position;
	var pitch_limits := _look_pitch_limits(eye);

	_yaw = wrapf(_yaw + yaw_delta, -PI, PI);
	_pitch = clampf(_pitch + pitch_delta, pitch_limits.x, pitch_limits.y);

	_target_yaw = _yaw;
	_target_pitch = _pitch;

	_apply_look_from_eye(eye);


func _rotate_orbit(yaw_delta: float, pitch_delta: float) -> void:
	_yaw = wrapf(_yaw + yaw_delta, -PI, PI);
	_pitch = clampf(_pitch + pitch_delta, deg_to_rad(min_pitch), deg_to_rad(max_pitch));

	_target_yaw = _yaw;
	_target_pitch = _pitch;


func _zoom_at(screen_position: Vector2, zoom_in: bool, event_factor: float) -> void:
	_begin_zoom_anchor(screen_position);

	var amount := event_factor if event_factor > 0.0 else 1.0;
	var multiplier: float = pow(zoom_factor, amount);

	if zoom_in:
		_target_zoom *= multiplier;
	else:
		_target_zoom /= multiplier;

	_target_zoom = clampf(_target_zoom, min_zoom, max_zoom);


func _begin_zoom_anchor(screen_position: Vector2) -> void:
	var point := _world_at_screen(screen_position);

	if not point.is_finite():
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

	if not current.is_finite():
		_zoom_anchor_active = false;
		return;

	var offset := _zoom_anchor_world - current;
	offset.y = 0.0;

	_focus += offset;
	_target_focus += offset;

	_apply_camera_transform();

	if absf(_zoom - _target_zoom) < 0.001:
		_zoom = _target_zoom;
		_zoom_anchor_active = false;


func _apply_look_from_eye(eye: Vector3) -> void:
	var direction := _view_direction(_yaw, _pitch);

	if absf(direction.y) < 0.00001:
		return;

	var distance_to_ground := (ground_height - eye.y) / direction.y;

	if distance_to_ground <= 0.0:
		return;

	_zoom = clampf(distance_to_ground, min_zoom, max_zoom);
	_focus = eye + direction * _zoom;
	_focus.y = ground_height;

	_target_focus = _focus;
	_target_zoom = _zoom;


func _look_pitch_limits(eye: Vector3) -> Vector2:
	var height := maxf(eye.y - ground_height, 0.0);
	var lower := deg_to_rad(min_pitch);
	var upper := deg_to_rad(max_pitch);

	if max_zoom > 0.0:
		lower = maxf(lower, asin(clampf(height / max_zoom, 0.0, 1.0)));

	if min_zoom > 0.0:
		upper = minf(upper, asin(clampf(height / min_zoom, 0.0, 1.0)));

	if lower > upper:
		lower = upper;

	return Vector2(lower, upper);


func _view_direction(yaw: float, pitch: float) -> Vector3:
	var horizontal := cos(pitch);
	return Vector3(-sin(yaw) * horizontal, -sin(pitch), -cos(yaw) * horizontal);


func _apply_camera_transform() -> void:
	var offset := -_view_direction(_yaw, _pitch) * _zoom;

	global_position = _focus;
	camera.global_position = _focus + offset;
	camera.look_at(_focus, Vector3.UP);


func _world_at_screen(screen_position: Vector2) -> Vector3:
	var origin := camera.project_ray_origin(screen_position);
	var direction := camera.project_ray_normal(screen_position);

	if absf(direction.y) < 0.00001:
		return Vector3.INF;

	var distance_to_plane: float = (ground_height - origin.y) / direction.y;

	if distance_to_plane < 0.0:
		return Vector3.INF;

	return origin + direction * distance_to_plane;


func _get_pan_speed() -> float:
	return lerpf(min_pan_speed, max_pan_speed, get_zoom_ratio());


func _smooth_factor(speed: float, delta: float) -> float:
	if speed <= 0.0:
		return 1.0;

	return 1.0 - exp(-speed * delta);


func _rotation_at_target() -> bool:
	var yaw_error := absf(wrapf(_target_yaw - _yaw, -PI, PI));
	var pitch_error := absf(_target_pitch - _pitch);

	return yaw_error < 0.0001 and pitch_error < 0.0001;


func _cancel_look_transition() -> void:
	if not _look_transition_active:
		return;

	_look_transition_active = false;
	_target_focus = _focus;
	_target_zoom = _zoom;
	_target_yaw = _yaw;
	_target_pitch = _pitch;


func _reset_transient_input() -> void:
	_dragging = false;
	_drag_anchor_valid = false;
	_rotating = false;
	_zoom_anchor_active = false;
	_cancel_look_transition();


func focus_on(position: Vector3, immediate := false) -> void:
	position.y = ground_height;
	_target_focus = position;
	_zoom_anchor_active = false;
	_cancel_look_transition();

	if immediate:
		_focus = _target_focus;
		_apply_camera_transform();


func zoom_to(distance: float, immediate := false) -> void:
	_target_zoom = clampf(distance, min_zoom, max_zoom);
	_zoom_anchor_active = false;
	_cancel_look_transition();

	if immediate:
		_zoom = _target_zoom;
		_apply_camera_transform();


func rotate_to(yaw_degrees: float, pitch_degrees: float, immediate := false) -> void:
	_zoom_anchor_active = false;
	_cancel_look_transition();

	_target_yaw = wrapf(deg_to_rad(yaw_degrees), -PI, PI);

	if rotation_mode == RotationMode.LOOK:
		var eye := camera.global_position;
		var pitch_limits := _look_pitch_limits(eye);

		_target_pitch = clampf(deg_to_rad(pitch_degrees), pitch_limits.x, pitch_limits.y);

		if immediate:
			_yaw = _target_yaw;
			_pitch = _target_pitch;
			_apply_look_from_eye(eye);
			_apply_camera_transform();
		else:
			_look_transition_eye = eye;
			_look_transition_active = true;
	else:
		_target_pitch = clampf(deg_to_rad(pitch_degrees), deg_to_rad(min_pitch), deg_to_rad(max_pitch));

		if immediate:
			_yaw = _target_yaw;
			_pitch = _target_pitch;
			_apply_camera_transform();


func snap() -> void:
	if _look_transition_active:
		_yaw = _target_yaw;
		_pitch = _target_pitch;
		_apply_look_from_eye(_look_transition_eye);
		_look_transition_active = false;
	else:
		_focus = _target_focus;
		_zoom = _target_zoom;
		_yaw = _target_yaw;
		_pitch = _target_pitch;

	_apply_camera_transform();


func get_focus_position() -> Vector3:
	return _focus;


func get_zoom() -> float:
	return _zoom;


func get_zoom_ratio() -> float:
	var ratio: float = inverse_lerp(min_zoom, max_zoom, _target_zoom);
	return clampf(ratio, 0.0, 1.0);


func get_yaw() -> float:
	return rad_to_deg(_yaw);


func get_pitch() -> float:
	return rad_to_deg(_pitch);
