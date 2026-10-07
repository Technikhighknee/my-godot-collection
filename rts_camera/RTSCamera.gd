class_name RTSCamera
extends Node3D;


enum RotationMode {
	LOOK,
	ORBIT,
}


enum BoundsMode {
	FOCUS,
	VIEW,
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
@export_enum("Look", "Orbit") var rotation_mode: int = RotationMode.LOOK;
@export var rotation_enabled := true;
@export var mouse_yaw_sensitivity := 0.2;
@export var mouse_pitch_sensitivity := 0.2;
@export var rotation_smoothing := 18.0;

@export_group("World")
@export var ground_height := 0.0;

@export_group("Bounds")
@export var bounds_enabled := false;
@export_enum("Focus", "View") var bounds_mode: int = BoundsMode.VIEW;
@export var world_bounds := Rect2(Vector2(-100.0, -100.0), Vector2(200.0, 200.0));

@export_group("Edge Scroll")
@export var edge_scroll_enabled := false;
@export_range(1.0, 128.0, 1.0) var edge_scroll_margin := 24.0;
@export_range(0.5, 4.0, 0.1) var edge_scroll_curve := 2.0;
@export var edge_scroll_speed_multiplier := 1.0;
@export var edge_scroll_over_gui := false;

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
	_normalize_configuration();

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

	_constrain_target_state();
	_focus = _target_focus;
	_apply_camera_transform();


func _process(delta: float) -> void:
	if not input_enabled:
		_reset_transient_input();
	else:
		if not rotation_enabled:
			_rotating = false;

		_handle_pan_input(minf(delta, MAX_INPUT_DELTA));

	_constrain_target_state();

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
	_constrain_target_state();

	var bounds_correction := _constrain_current_state();

	if _look_transition_active:
		_look_transition_eye += bounds_correction;

	_apply_camera_transform();

	if _zoom_anchor_active and not bounds_correction.is_zero_approx():
		var constrained_anchor := _world_at_screen(_zoom_anchor_screen);

		if constrained_anchor.is_finite():
			_zoom_anchor_world = constrained_anchor;


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
	if event.button_index == rotate_button and (rotation_enabled or _rotating):
		_rotating = rotation_enabled and event.pressed and not event.canceled;
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


func _handle_pan_input(delta: float) -> void:
	var input := Vector2.ZERO;

	if not _keyboard_pan_blocked_by_gui():
		input = Input.get_vector(pan_left_action, pan_right_action, pan_forward_action, pan_back_action);

	if edge_scroll_enabled:
		input += _get_edge_scroll_input() * edge_scroll_speed_multiplier;

	input = input.limit_length(1.0);

	if input == Vector2.ZERO:
		return;

	_zoom_anchor_active = false;
	_cancel_look_transition();

	var right := Vector3(cos(_yaw), 0.0, -sin(_yaw));
	var backward := Vector3(sin(_yaw), 0.0, cos(_yaw));
	var movement := right * input.x + backward * input.y;

	_target_focus += movement * _get_pan_speed() * delta;


func _keyboard_pan_blocked_by_gui() -> bool:
	var focus_owner := get_viewport().gui_get_focus_owner();
	return focus_owner is LineEdit or focus_owner is TextEdit;


func _get_edge_scroll_input() -> Vector2:
	if not get_window().has_focus() or _dragging or _rotating:
		return Vector2.ZERO;

	var viewport := get_viewport();

	if viewport.gui_is_dragging():
		return Vector2.ZERO;

	if not edge_scroll_over_gui and viewport.gui_get_hovered_control() != null:
		return Vector2.ZERO;

	var size := viewport.get_visible_rect().size;
	var mouse := viewport.get_mouse_position();

	if size.x <= 0.0 or size.y <= 0.0:
		return Vector2.ZERO;

	if mouse.x < 0.0 or mouse.y < 0.0 or mouse.x > size.x or mouse.y > size.y:
		return Vector2.ZERO;

	return Vector2(
		_edge_scroll_axis(mouse.x, size.x),
		_edge_scroll_axis(mouse.y, size.y)
	);


func _edge_scroll_axis(position: float, extent: float) -> float:
	var margin := minf(edge_scroll_margin, extent * 0.5);

	if margin <= 0.0:
		return 0.0;

	if position < margin:
		return -pow(1.0 - clampf(position / margin, 0.0, 1.0), edge_scroll_curve);

	if position > extent - margin:
		return pow(1.0 - clampf((extent - position) / margin, 0.0, 1.0), edge_scroll_curve);

	return 0.0;


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

	var bounds_correction := _constrain_current_state();
	_target_focus = _focus;

	_apply_camera_transform();

	if not bounds_correction.is_zero_approx():
		var constrained_anchor := _world_at_screen(event.position);

		if constrained_anchor.is_finite():
			_drag_anchor = constrained_anchor;

	get_viewport().set_input_as_handled();


func _handle_rotation(event: InputEventMouseMotion) -> void:
	var yaw_delta := deg_to_rad(-event.relative.x * mouse_yaw_sensitivity);
	var pitch_delta := deg_to_rad(event.relative.y * mouse_pitch_sensitivity);

	if rotation_mode == RotationMode.LOOK:
		_rotate_look(yaw_delta, pitch_delta);
	else:
		_rotate_orbit(yaw_delta, pitch_delta);

	_constrain_current_state();
	_target_focus = _focus;
	_target_zoom = _zoom;

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


func _constrain_target_state() -> void:
	if not bounds_enabled or _look_transition_active:
		return;

	var correction := _bounds_correction(_target_focus, _target_zoom, _target_yaw, _target_pitch);
	_target_focus.x += correction.x;
	_target_focus.z += correction.y;


func _constrain_current_state() -> Vector3:
	if not bounds_enabled:
		return Vector3.ZERO;

	var correction_2d := _bounds_correction(_focus, _zoom, _yaw, _pitch);
	var correction := Vector3(correction_2d.x, 0.0, correction_2d.y);

	_focus += correction;
	_focus.y = ground_height;

	return correction;


func _bounds_correction(focus: Vector3, zoom: float, yaw: float, pitch: float) -> Vector2:
	if bounds_mode == BoundsMode.FOCUS:
		return _focus_bounds_correction(focus);

	var view_rect := _ground_view_rect_for_state(focus, zoom, yaw, pitch);

	if view_rect.size.x < 0.0 or view_rect.size.y < 0.0:
		return _focus_bounds_correction(focus);

	return _rect_fit_correction(view_rect);


func _focus_bounds_correction(focus: Vector3) -> Vector2:
	var bounds_min := Vector2(
		minf(world_bounds.position.x, world_bounds.end.x),
		minf(world_bounds.position.y, world_bounds.end.y)
	);
	var bounds_max := Vector2(
		maxf(world_bounds.position.x, world_bounds.end.x),
		maxf(world_bounds.position.y, world_bounds.end.y)
	);
	var position := Vector2(focus.x, focus.z);
	var clamped := Vector2(
		clampf(position.x, bounds_min.x, bounds_max.x),
		clampf(position.y, bounds_min.y, bounds_max.y)
	);

	return clamped - position;


func _rect_fit_correction(view_rect: Rect2) -> Vector2:
	var bounds_min := Vector2(
		minf(world_bounds.position.x, world_bounds.end.x),
		minf(world_bounds.position.y, world_bounds.end.y)
	);
	var bounds_max := Vector2(
		maxf(world_bounds.position.x, world_bounds.end.x),
		maxf(world_bounds.position.y, world_bounds.end.y)
	);
	var view_min := Vector2(
		minf(view_rect.position.x, view_rect.end.x),
		minf(view_rect.position.y, view_rect.end.y)
	);
	var view_max := Vector2(
		maxf(view_rect.position.x, view_rect.end.x),
		maxf(view_rect.position.y, view_rect.end.y)
	);
	var correction := Vector2.ZERO;

	if view_max.x - view_min.x > bounds_max.x - bounds_min.x:
		correction.x = (bounds_min.x + bounds_max.x - view_min.x - view_max.x) * 0.5;
	elif view_min.x < bounds_min.x:
		correction.x = bounds_min.x - view_min.x;
	elif view_max.x > bounds_max.x:
		correction.x = bounds_max.x - view_max.x;

	if view_max.y - view_min.y > bounds_max.y - bounds_min.y:
		correction.y = (bounds_min.y + bounds_max.y - view_min.y - view_max.y) * 0.5;
	elif view_min.y < bounds_min.y:
		correction.y = bounds_min.y - view_min.y;
	elif view_max.y > bounds_max.y:
		correction.y = bounds_max.y - view_max.y;

	return correction;


func _ground_view_rect_for_state(focus: Vector3, zoom: float, yaw: float, pitch: float) -> Rect2:
	if camera.projection != Camera3D.PROJECTION_PERSPECTIVE:
		return Rect2(Vector2.ZERO, Vector2(-1.0, -1.0));

	if camera.attributes != null or not is_zero_approx(camera.h_offset) or not is_zero_approx(camera.v_offset):
		return Rect2(Vector2.ZERO, Vector2(-1.0, -1.0));

	var viewport_size := get_viewport().get_visible_rect().size;

	if viewport_size.x <= 0.0 or viewport_size.y <= 0.0:
		return Rect2(Vector2.ZERO, Vector2(-1.0, -1.0));

	var aspect := viewport_size.x / viewport_size.y;
	var half_fov_tan := tan(deg_to_rad(camera.fov) * 0.5);
	var half_width: float;
	var half_height: float;

	if camera.keep_aspect == Camera3D.KEEP_HEIGHT:
		half_height = half_fov_tan;
		half_width = half_height * aspect;
	else:
		half_width = half_fov_tan;
		half_height = half_width / aspect;

	var forward := _view_direction(yaw, pitch);
	var right := Vector3(cos(yaw), 0.0, -sin(yaw));
	var up := right.cross(forward).normalized();
	var eye := focus - forward * zoom;

	var top_left := _ground_view_corner(eye, forward, right, up, half_width, half_height, -1.0, 1.0);
	var top_right := _ground_view_corner(eye, forward, right, up, half_width, half_height, 1.0, 1.0);
	var bottom_right := _ground_view_corner(eye, forward, right, up, half_width, half_height, 1.0, -1.0);
	var bottom_left := _ground_view_corner(eye, forward, right, up, half_width, half_height, -1.0, -1.0);

	if not top_left.is_finite() or not top_right.is_finite() or not bottom_right.is_finite() or not bottom_left.is_finite():
		return Rect2(Vector2.ZERO, Vector2(-1.0, -1.0));

	var ground_min := Vector2(
		minf(minf(top_left.x, top_right.x), minf(bottom_right.x, bottom_left.x)),
		minf(minf(top_left.z, top_right.z), minf(bottom_right.z, bottom_left.z))
	);
	var ground_max := Vector2(
		maxf(maxf(top_left.x, top_right.x), maxf(bottom_right.x, bottom_left.x)),
		maxf(maxf(top_left.z, top_right.z), maxf(bottom_right.z, bottom_left.z))
	);

	return Rect2(ground_min, ground_max - ground_min);


func _ground_view_corner(
	eye: Vector3,
	forward: Vector3,
	right: Vector3,
	up: Vector3,
	half_width: float,
	half_height: float,
	corner_x: float,
	corner_y: float
) -> Vector3:
	var ray_direction := (forward + right * corner_x * half_width + up * corner_y * half_height).normalized();

	if ray_direction.y >= -0.00001:
		return Vector3.INF;

	var distance_to_ground := (ground_height - eye.y) / ray_direction.y;

	if distance_to_ground < 0.0:
		return Vector3.INF;

	return eye + ray_direction * distance_to_ground;


func _get_pan_speed() -> float:
	return lerpf(min_pan_speed, max_pan_speed, get_zoom_ratio());


func _normalize_configuration() -> void:
	min_zoom = maxf(min_zoom, 0.001);
	max_zoom = maxf(max_zoom, min_zoom);
	initial_zoom = clampf(initial_zoom, min_zoom, max_zoom);

	min_pitch = clampf(min_pitch, 0.1, 89.0);
	max_pitch = clampf(max_pitch, min_pitch, 89.0);
	initial_pitch = clampf(initial_pitch, min_pitch, max_pitch);

	min_pan_speed = maxf(min_pan_speed, 0.0);
	max_pan_speed = maxf(max_pan_speed, min_pan_speed);
	move_smoothing = maxf(move_smoothing, 0.0);
	zoom_smoothing = maxf(zoom_smoothing, 0.0);
	rotation_smoothing = maxf(rotation_smoothing, 0.0);

	edge_scroll_margin = maxf(edge_scroll_margin, 1.0);
	edge_scroll_curve = maxf(edge_scroll_curve, 0.01);
	edge_scroll_speed_multiplier = maxf(edge_scroll_speed_multiplier, 0.0);


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
	_constrain_target_state();

	if immediate:
		_focus = _target_focus;
		_constrain_current_state();
		_apply_camera_transform();


func zoom_to(distance: float, immediate := false) -> void:
	_target_zoom = clampf(distance, min_zoom, max_zoom);
	_zoom_anchor_active = false;
	_cancel_look_transition();
	_constrain_target_state();

	if immediate:
		_zoom = _target_zoom;
		_constrain_current_state();
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
			_constrain_current_state();
			_target_focus = _focus;
			_target_zoom = _zoom;
			_apply_camera_transform();
		else:
			_look_transition_eye = eye;
			_look_transition_active = true;
	else:
		_target_pitch = clampf(deg_to_rad(pitch_degrees), deg_to_rad(min_pitch), deg_to_rad(max_pitch));
		_constrain_target_state();

		if immediate:
			_yaw = _target_yaw;
			_pitch = _target_pitch;
			_constrain_current_state();
			_apply_camera_transform();


func snap() -> void:
	if _look_transition_active:
		_yaw = _target_yaw;
		_pitch = _target_pitch;
		_apply_look_from_eye(_look_transition_eye);
		_look_transition_active = false;
	else:
		_constrain_target_state();
		_focus = _target_focus;
		_zoom = _target_zoom;
		_yaw = _target_yaw;
		_pitch = _target_pitch;

	_constrain_current_state();
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


func get_visible_ground_rect() -> Rect2:
	return _ground_view_rect_for_state(_focus, _zoom, _yaw, _pitch);


func has_finite_ground_footprint() -> bool:
	var rect := get_visible_ground_rect();
	return rect.size.x >= 0.0 and rect.size.y >= 0.0;
