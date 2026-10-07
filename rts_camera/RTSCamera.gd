class_name RTSCamera
extends Node3D;


const MAX_INPUT_DELTA := 0.1;


@export_group("Camera")
@export_range(10.0, 80.0, 0.1) var angle := 50.0;
@export var initial_yaw := 0.0;
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
@export var rotation_enabled := true;
@export var keyboard_rotation_speed := 90.0;
@export var mouse_rotation_sensitivity := 0.2;
@export var rotation_smoothing := 18.0;

@export_group("World")
@export var ground_height := 0.0;

@export_group("Input")
@export var input_enabled := true;
@export var pan_left_action: StringName = &"camera_left";
@export var pan_right_action: StringName = &"camera_right";
@export var pan_forward_action: StringName = &"camera_forward";
@export var pan_back_action: StringName = &"camera_back";
@export var rotate_left_action: StringName = &"camera_rotate_left";
@export var rotate_right_action: StringName = &"camera_rotate_right";
@export var drag_button: MouseButton = MOUSE_BUTTON_MIDDLE;
@export var rotate_button: MouseButton = MOUSE_BUTTON_RIGHT;


@onready var camera: Camera3D = $Camera3D;


var _focus: Vector3;
var _target_focus: Vector3;
var _zoom: float;
var _target_zoom: float;
var _yaw: float;
var _target_yaw: float;

var _dragging := false;
var _drag_anchor_valid := false;
var _drag_anchor: Vector3;

var _rotating := false;

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

	_focus = _focus.lerp(_target_focus, move_t);
	_focus.y = ground_height;
	_zoom = lerpf(_zoom, _target_zoom, zoom_t);
	_yaw = lerp_angle(_yaw, _target_yaw, rotation_t);

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
			_handle_mouse_rotation(motion);


func _handle_mouse_button(event: InputEventMouseButton) -> void:
	if event.button_index == drag_button:
		_dragging = event.pressed and not event.canceled;
		_drag_anchor_valid = false;
		_zoom_anchor_active = false;

		if _dragging:
			_rotating = false;
			_target_focus = _focus;
			var point := _world_at_screen(event.position);

			if point.is_finite():
				_drag_anchor = point;
				_drag_anchor_valid = true;

		get_viewport().set_input_as_handled();
		return;

	if rotation_enabled and event.button_index == rotate_button:
		_rotating = event.pressed and not event.canceled;
		_zoom_anchor_active = false;

		if _rotating:
			_dragging = false;
			_drag_anchor_valid = false;
			_target_focus = _focus;
			_target_yaw = _yaw;

		get_viewport().set_input_as_handled();
		return;

	if not event.pressed or event.canceled:
		return;

	if event.button_index == MOUSE_BUTTON_WHEEL_UP:
		_zoom_at(event.position, true, event.factor);
		get_viewport().set_input_as_handled();
	elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
		_zoom_at(event.position, false, event.factor);
		get_viewport().set_input_as_handled();


func _handle_keyboard(delta: float) -> void:
	var input := Input.get_vector(pan_left_action, pan_right_action, pan_forward_action, pan_back_action);

	if input != Vector2.ZERO:
		_zoom_anchor_active = false;

		var right := Vector3(cos(_yaw), 0.0, -sin(_yaw));
		var backward := Vector3(sin(_yaw), 0.0, cos(_yaw));
		var movement := right * input.x + backward * input.y;

		_target_focus += movement * _get_pan_speed() * delta;

	if not rotation_enabled:
		return;

	var rotation_input := Input.get_axis(rotate_left_action, rotate_right_action);

	if not is_zero_approx(rotation_input):
		_zoom_anchor_active = false;
		_target_yaw = wrapf(
			_target_yaw + deg_to_rad(keyboard_rotation_speed) * rotation_input * delta,
			-PI,
			PI
		);


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


func _handle_mouse_rotation(event: InputEventMouseMotion) -> void:
	var delta_yaw := deg_to_rad(event.relative.x * mouse_rotation_sensitivity);

	_yaw = wrapf(_yaw + delta_yaw, -PI, PI);
	_target_yaw = _yaw;

	_apply_camera_transform();
	get_viewport().set_input_as_handled();


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


func _apply_camera_transform() -> void:
	var radians := deg_to_rad(angle);
	var horizontal := cos(radians);
	var offset := Vector3(sin(_yaw) * horizontal, sin(radians), cos(_yaw) * horizontal) * _zoom;

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


func _reset_transient_input() -> void:
	_dragging = false;
	_drag_anchor_valid = false;
	_rotating = false;
	_zoom_anchor_active = false;


func focus_on(position: Vector3, immediate := false) -> void:
	position.y = ground_height;
	_target_focus = position;
	_zoom_anchor_active = false;

	if immediate:
		_focus = _target_focus;
		_apply_camera_transform();


func zoom_to(distance: float, immediate := false) -> void:
	_target_zoom = clampf(distance, min_zoom, max_zoom);
	_zoom_anchor_active = false;

	if immediate:
		_zoom = _target_zoom;
		_apply_camera_transform();


func rotate_to(yaw_degrees: float, immediate := false) -> void:
	_target_yaw = wrapf(deg_to_rad(yaw_degrees), -PI, PI);
	_zoom_anchor_active = false;

	if immediate:
		_yaw = _target_yaw;
		_apply_camera_transform();


func snap() -> void:
	_focus = _target_focus;
	_zoom = _target_zoom;
	_yaw = _target_yaw;
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
