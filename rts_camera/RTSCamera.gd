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


enum GroundMode {
	PLANE,
	PHYSICS,
}


const MAX_INPUT_DELTA := 0.1;
const PAN_SAMPLE_PIXELS := 32.0;
const MAX_DIRECT_GROUND_DISTANCE_FACTOR := 6.0;


@export_group("Camera")
@export var initial_yaw := 0.0;
@export var initial_zoom := 30.0;
@export var min_zoom := 5.0;
@export var max_zoom := 120.0;

@export_group("Zoom Arc")
@export_range(1.0, 85.0, 0.1) var near_pitch := 25.0;
@export_range(5.0, 89.0, 0.1) var far_pitch := 65.0;
@export_range(0.5, 4.0, 0.05) var zoom_arc_curve := 0.75;
@export var rig_target_height := 1.5;
@export_range(0.1, 85.0, 0.1) var min_orbit_pitch := 5.0;
@export_range(5.0, 89.0, 0.1) var max_orbit_pitch := 85.0;

@export_group("Movement")
@export_range(0.05, 3.0, 0.05) var pan_screen_speed := 0.75;
@export var move_smoothing := 16.0;

@export_group("Zoom")
@export_range(0.5, 0.99, 0.01) var zoom_factor := 0.85;
@export var zoom_smoothing := 18.0;

@export_group("Rotation")
@export var rotation_mode: RotationMode = RotationMode.LOOK;
@export var rotation_enabled := true;
@export var mouse_yaw_sensitivity := 0.2;
@export var mouse_pitch_sensitivity := 0.2;
@export var rotation_smoothing := 18.0;
@export_range(-89.0, 0.0, 0.1) var min_look_pitch := -85.0;
@export_range(0.0, 89.0, 0.1) var max_look_pitch := 85.0;
@export var capture_mouse_while_rotating := true;

@export_group("Ground")
@export var ground_mode: GroundMode = GroundMode.PLANE;
@export var ground_height := 0.0;
@export_flags_3d_physics var ground_collision_mask: int = 1;
@export var ground_required_group: StringName = &"";
@export_range(0, 32, 1) var ground_max_skips := 8;
@export var ground_query_distance := 5000.0;
@export var ground_probe_up := 1000.0;
@export var ground_probe_down := 2000.0;
@export var ground_collide_with_areas := false;

@export_group("Physics Presentation")
@export var physics_render_interpolation := true;

@export_group("Bounds")
@export var bounds_enabled := false;
@export var bounds_mode: BoundsMode = BoundsMode.VIEW;
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
var _orbit_pitch_offset := 0.0;
var _target_orbit_pitch_offset := 0.0;

var _look_detached := false;
var _look_recenter_active := false;
var _look_yaw := 0.0;
var _target_look_yaw := 0.0;
var _look_pitch := 0.0;
var _target_look_pitch := 0.0;

var _dragging := false;
var _drag_anchor_valid := false;
var _drag_anchor: Vector3;

var _rotating := false;
var _rotate_button_down := false;
var _drag_button_down := false;

var _rotation_capture_active := false;
var _rotation_restore_mouse_mode: Input.MouseMode = Input.MOUSE_MODE_VISIBLE;
var _rotation_restore_mouse_position: Vector2;

var _zoom_anchor_active := false;
var _zoom_anchor_screen: Vector2;
var _zoom_anchor_world: Vector3;

var _pending_pointer_events: Array[InputEvent] = [];

var _pan_input_active := false;
var _wheel_zoom_active := false;

var _ground_initialized := false;
var _inside_ground_update := false;
var _snap_requested := false;
var _visible_ground_rect := Rect2(Vector2.ZERO, Vector2(-1.0, -1.0));

var _active_ground_mode: GroundMode;
var _physics_history_ready := false;
var _physics_previous_focus: Vector3;
var _physics_previous_eye: Vector3;
var _physics_previous_view_yaw := 0.0;
var _physics_previous_view_pitch := 0.0;
var _collapse_physics_history := false;
var _direct_pointer_activity_this_tick := false;


func _ready() -> void:
	_normalize_configuration();

	_focus = global_position;
	_target_focus = _focus;

	_zoom = clampf(initial_zoom, min_zoom, max_zoom);
	_target_zoom = _zoom;

	_yaw = deg_to_rad(initial_yaw);
	_target_yaw = _yaw;
	_sync_look_to_rig();

	camera.make_current();
	set_physics_interpolation_mode(Node.PHYSICS_INTERPOLATION_MODE_OFF);
	camera.set_physics_interpolation_mode(Node.PHYSICS_INTERPOLATION_MODE_OFF);
	get_window().focus_exited.connect(_reset_transient_input);

	_active_ground_mode = ground_mode;

	if ground_mode == GroundMode.PLANE:
		_initialize_ground_state();
	else:
		_apply_camera_transform();

	_reset_physics_history();


func _process(delta: float) -> void:
	_sync_ground_mode();

	if ground_mode == GroundMode.PLANE:
		_update_camera(delta);
	else:
		_apply_physics_presentation();


func _physics_process(delta: float) -> void:
	_sync_ground_mode();

	if ground_mode != GroundMode.PHYSICS:
		return;

	_begin_physics_history_step();
	_direct_pointer_activity_this_tick = false;
	_collapse_physics_history = false;

	_update_camera(delta);

	if _collapse_physics_history or _direct_pointer_activity_this_tick:
		_reset_physics_history();


func _update_camera(delta: float) -> void:
	_inside_ground_update = true;

	if not _ground_initialized:
		_initialize_ground_state();

	_consume_pointer_events();
	_reconcile_pointer_buttons();

	if _snap_requested:
		_snap_requested = false;
		_snap_now();

	if not input_enabled:
		_reset_transient_input();
	else:
		if not rotation_enabled:
			_rotating = false;
			_rotate_button_down = false;
			_end_rotation_pointer_capture();

		_handle_pan_input(minf(delta, MAX_INPUT_DELTA));

	_constrain_target_state();

	var move_t := _smooth_factor(move_smoothing, delta);
	var zoom_t := _smooth_factor(zoom_smoothing, delta);
	var rotation_t := _smooth_factor(rotation_smoothing, delta);

	var smoothed_focus := _focus.lerp(_target_focus, move_t);
	_focus.x = smoothed_focus.x;
	_focus.z = smoothed_focus.z;
	_align_current_focus_to_ground();

	_zoom = lerpf(_zoom, _target_zoom, zoom_t);
	_yaw = lerp_angle(_yaw, _target_yaw, rotation_t);
	_orbit_pitch_offset = lerpf(_orbit_pitch_offset, _target_orbit_pitch_offset, rotation_t);

	if _look_detached:
		if _look_recenter_active:
			_target_look_yaw = _yaw;
			_target_look_pitch = _rig_pitch(_zoom, _orbit_pitch_offset);

		_look_yaw = lerp_angle(_look_yaw, _target_look_yaw, rotation_t);
		_look_pitch = lerpf(_look_pitch, _target_look_pitch, rotation_t);

		if _look_recenter_active and _look_is_at_target():
			_attach_look_to_rig();
	else:
		_sync_look_to_rig();

	_apply_camera_transform();
	_update_zoom_anchor();
	_finish_wheel_zoom_if_settled();
	_constrain_target_state();

	var bounds_correction := _constrain_current_state();

	_apply_camera_transform();

	if _zoom_anchor_active and not bounds_correction.is_zero_approx():
		var constrained_anchor := _world_at_screen(_zoom_anchor_screen);

		if constrained_anchor.is_finite():
			_zoom_anchor_world = constrained_anchor;

	_refresh_visible_ground_rect();
	_inside_ground_update = false;

func _initialize_ground_state() -> void:
	_align_current_focus_to_ground();
	_target_focus = _focus;
	_constrain_target_state();
	_focus = _target_focus;
	_align_current_focus_to_ground();
	_target_focus = _focus;
	_apply_camera_transform();
	_refresh_visible_ground_rect();
	_ground_initialized = true;
	_collapse_physics_history = true;


func _sync_ground_mode() -> void:
	if ground_mode == _active_ground_mode:
		return;

	_active_ground_mode = ground_mode;
	_inside_ground_update = false;
	_ground_initialized = false;
	_snap_requested = false;
	_reset_transient_input();

	if ground_mode == GroundMode.PLANE:
		_initialize_ground_state();
	else:
		_apply_camera_transform();

	_reset_physics_history();


func _begin_physics_history_step() -> void:
	if not _physics_history_ready:
		_reset_physics_history();
		return;

	_physics_previous_focus = _focus;
	_physics_previous_eye = _camera_position_for_state(_focus, _zoom, _yaw, _orbit_pitch_offset);
	_physics_previous_view_yaw = _current_view_yaw();
	_physics_previous_view_pitch = _current_view_pitch();


func _reset_physics_history() -> void:
	_physics_previous_focus = _focus;
	_physics_previous_eye = _camera_position_for_state(_focus, _zoom, _yaw, _orbit_pitch_offset);
	_physics_previous_view_yaw = _current_view_yaw();
	_physics_previous_view_pitch = _current_view_pitch();
	_physics_history_ready = true;


func _apply_physics_presentation() -> void:
	if not _physics_history_ready or not physics_render_interpolation:
		_apply_camera_transform();
		return;

	if _rotate_button_down or _drag_button_down:
		_apply_camera_transform();
		return;

	var fraction := clampf(Engine.get_physics_interpolation_fraction(), 0.0, 1.0);
	var current_eye := _camera_position_for_state(_focus, _zoom, _yaw, _orbit_pitch_offset);
	var current_view_yaw := _current_view_yaw();
	var current_view_pitch := _current_view_pitch();

	var focus := _physics_previous_focus.lerp(_focus, fraction);
	var eye := _physics_previous_eye.lerp(current_eye, fraction);
	var view_yaw := lerp_angle(_physics_previous_view_yaw, current_view_yaw, fraction);
	var view_pitch := lerpf(_physics_previous_view_pitch, current_view_pitch, fraction);

	_apply_camera_pose(focus, eye, view_yaw, view_pitch);


func _unhandled_input(event: InputEvent) -> void:
	if not input_enabled:
		return;

	if event is InputEventMouseButton:
		var button := event as InputEventMouseButton;
		var rotate_event := (
			button.button_index == rotate_button
			and (
				(button.pressed and rotation_enabled)
				or _rotate_button_down
				or _rotating
			)
		);
		var drag_event := (
			button.button_index == drag_button
			and (
				button.pressed
				or _drag_button_down
				or _dragging
			)
		);

		if rotate_event:
			_rotate_button_down = button.pressed and not button.canceled;

			if _rotate_button_down:
				_begin_rotation_pointer_capture(button.position);
			else:
				_end_rotation_pointer_capture();

			_pending_pointer_events.append(event);
			get_viewport().set_input_as_handled();
		elif drag_event:
			_drag_button_down = button.pressed and not button.canceled;
			_pending_pointer_events.append(event);
			get_viewport().set_input_as_handled();
		elif button.pressed and not button.canceled and (
			button.button_index == MOUSE_BUTTON_WHEEL_UP
			or button.button_index == MOUSE_BUTTON_WHEEL_DOWN
		):
			_pending_pointer_events.append(event);
			get_viewport().set_input_as_handled();
	elif event is InputEventMouseMotion and (_rotate_button_down or _drag_button_down):
		_pending_pointer_events.append(event);
		get_viewport().set_input_as_handled();

func _consume_pointer_events() -> void:
	if _pending_pointer_events.is_empty():
		return;

	var events: Array[InputEvent] = _pending_pointer_events;
	_pending_pointer_events = [];

	for event in events:
		if event is InputEventMouseButton:
			_handle_mouse_button(event as InputEventMouseButton);
		elif event is InputEventMouseMotion:
			var motion := event as InputEventMouseMotion;

			if _dragging:
				_handle_drag(motion);
			elif _rotating:
				_handle_rotation(motion);


func _reconcile_pointer_buttons() -> void:
	if _rotate_button_down and not Input.is_mouse_button_pressed(rotate_button):
		_rotate_button_down = false;
		_rotating = false;
		_end_rotation_pointer_capture();

	if _drag_button_down and not Input.is_mouse_button_pressed(drag_button):
		_drag_button_down = false;
		_dragging = false;
		_drag_anchor_valid = false;


func _begin_rotation_pointer_capture(position: Vector2) -> void:
	if not capture_mouse_while_rotating or _rotation_capture_active:
		return;

	_rotation_capture_active = true;
	_rotation_restore_mouse_mode = Input.mouse_mode;
	_rotation_restore_mouse_position = position;

	if Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED;


func _end_rotation_pointer_capture() -> void:
	if not _rotation_capture_active:
		return;

	_rotation_capture_active = false;
	var restore_mode := _rotation_restore_mouse_mode;
	Input.mouse_mode = restore_mode;

	if restore_mode != Input.MOUSE_MODE_CAPTURED:
		Input.warp_mouse(_rotation_restore_mouse_position);


func _handle_mouse_button(event: InputEventMouseButton) -> void:
	if event.button_index == rotate_button and (rotation_enabled or _rotating):
		_rotating = rotation_enabled and event.pressed and not event.canceled;
		_zoom_anchor_active = false;
		_cancel_rotation_transition();

		if _rotating:
			_wheel_zoom_active = false;
			_drag_button_down = false;
			_dragging = false;
			_drag_anchor_valid = false;
			_target_focus = _focus;
			_target_zoom = _zoom;

		return;

	if event.button_index == drag_button:
		_dragging = event.pressed and not event.canceled;
		_drag_anchor_valid = false;
		_zoom_anchor_active = false;
		_cancel_rotation_transition();

		if _dragging:
			_wheel_zoom_active = false;
			_rotate_button_down = false;
			_rotating = false;
			_end_rotation_pointer_capture();
			_target_focus = _focus;
			_target_zoom = _zoom;
			var point := _world_at_screen(event.position);

			if _ground_point_is_directly_usable(point):
				_drag_anchor = point;
				_drag_anchor_valid = true;

		return;

	if not event.pressed or event.canceled:
		return;

	if event.button_index == MOUSE_BUTTON_WHEEL_UP:
		_cancel_rotation_transition();
		_zoom_at(event.position, true, event.factor);
	elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
		_cancel_rotation_transition();
		_zoom_at(event.position, false, event.factor);

func _handle_pan_input(delta: float) -> void:
	var input := Vector2.ZERO;
	var max_input_magnitude := 1.0;

	if not _keyboard_pan_blocked_by_gui():
		input = Input.get_vector(pan_left_action, pan_right_action, pan_forward_action, pan_back_action);

	if edge_scroll_enabled:
		input += _get_edge_scroll_input() * edge_scroll_speed_multiplier;
		max_input_magnitude = maxf(max_input_magnitude, edge_scroll_speed_multiplier);

	input = input.limit_length(max_input_magnitude);

	if input == Vector2.ZERO:
		_pan_input_active = false;
		return;

	if not _pan_input_active:
		_target_focus = _focus;
		_pan_input_active = true;

	_zoom_anchor_active = false;
	_cancel_rotation_transition();

	var movement := _screen_space_pan_delta(input, delta);
	_target_focus += movement;

func _screen_space_pan_delta(input: Vector2, delta: float) -> Vector3:
	var viewport_size := get_viewport().get_visible_rect().size;

	if viewport_size.x <= 0.0 or viewport_size.y <= 0.0:
		return _fallback_pan_delta(input, delta);

	var right_scale := _rig_ground_units_per_pixel(Vector2.RIGHT);
	var down_scale := _rig_ground_units_per_pixel(Vector2.DOWN);

	if not is_finite(right_scale) or not is_finite(down_scale):
		return _fallback_pan_delta(input, delta);

	var view_yaw := _current_view_yaw();
	var right := Vector3(cos(view_yaw), 0.0, -sin(view_yaw));
	var backward := Vector3(sin(view_yaw), 0.0, cos(view_yaw));
	var pixels_per_second := viewport_size.y * pan_screen_speed;

	return (
		right * input.x * right_scale
		+ backward * input.y * down_scale
	) * pixels_per_second * delta;

func _rig_ground_units_per_pixel(axis: Vector2) -> float:
	var viewport_size := get_viewport().get_visible_rect().size;

	if viewport_size.x <= 0.0 or viewport_size.y <= 0.0:
		return INF;

	var rig_pitch := _rig_pitch(_zoom, _orbit_pitch_offset);
	var forward := _view_direction(_yaw, rig_pitch);
	var right := Vector3(cos(_yaw), 0.0, -sin(_yaw));
	var up := right.cross(forward).normalized();
	var eye := _camera_position_for_state(_focus, _zoom, _yaw, _orbit_pitch_offset);
	var center_world := resolve_ground_ray(eye, forward);

	if not center_world.is_finite():
		return INF;

	var half_fov_tan := tan(deg_to_rad(camera.fov) * 0.5);
	var half_width: float;
	var half_height: float;
	var aspect := viewport_size.x / viewport_size.y;

	if camera.keep_aspect == Camera3D.KEEP_HEIGHT:
		half_height = half_fov_tan;
		half_width = half_height * aspect;
	else:
		half_width = half_fov_tan;
		half_height = half_width / aspect;

	var x_slope := axis.x * PAN_SAMPLE_PIXELS * 2.0 * half_width / viewport_size.x;
	var y_slope := axis.y * PAN_SAMPLE_PIXELS * 2.0 * half_height / viewport_size.y;
	var sample_direction := (forward + right * x_slope - up * y_slope).normalized();
	var sample_world := resolve_ground_ray(eye, sample_direction);

	if not sample_world.is_finite():
		return INF;

	var horizontal_delta := Vector2(
		sample_world.x - center_world.x,
		sample_world.z - center_world.z
	);

	return horizontal_delta.length() / PAN_SAMPLE_PIXELS;

func _fallback_pan_delta(input: Vector2, delta: float) -> Vector3:
	var view_yaw := _current_view_yaw();
	var rig_pitch := _rig_pitch(_zoom, _orbit_pitch_offset);
	var rig_distance := _rig_distance_for_height(_zoom, rig_pitch);
	var right := Vector3(cos(view_yaw), 0.0, -sin(view_yaw));
	var backward := Vector3(sin(view_yaw), 0.0, cos(view_yaw));
	var half_fov_tan := tan(deg_to_rad(camera.fov) * 0.5);
	var visible_height := 2.0 * rig_distance * half_fov_tan;
	var speed := visible_height * pan_screen_speed;

	return (right * input.x + backward * input.y) * speed * delta;

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
	_direct_pointer_activity_this_tick = true;

	var current := _world_at_screen(event.position);

	if not _ground_point_is_directly_usable(current):
		_drag_anchor_valid = false;
		return;

	if not _drag_anchor_valid:
		_drag_anchor = current;
		_drag_anchor_valid = true;
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

		if _ground_point_is_directly_usable(constrained_anchor):
			_drag_anchor = constrained_anchor;
		else:
			_drag_anchor_valid = false;

func _handle_rotation(event: InputEventMouseMotion) -> void:
	_direct_pointer_activity_this_tick = true;

	var yaw_delta := deg_to_rad(-event.screen_relative.x * mouse_yaw_sensitivity);
	var pitch_delta := deg_to_rad(event.screen_relative.y * mouse_pitch_sensitivity);

	_target_focus = _focus;
	_target_zoom = _zoom;

	if rotation_mode == RotationMode.LOOK:
		_rotate_look(yaw_delta, pitch_delta);
	else:
		_rotate_orbit(yaw_delta, pitch_delta);
		_constrain_current_state();
		_target_focus = _focus;

	_apply_camera_transform();

func _rotate_look(yaw_delta: float, pitch_delta: float) -> void:
	_detach_look();

	_look_yaw = wrapf(_look_yaw + yaw_delta, -PI, PI);
	_look_pitch = clampf(
		_look_pitch + pitch_delta,
		deg_to_rad(min_look_pitch),
		deg_to_rad(max_look_pitch)
	);

	_target_look_yaw = _look_yaw;
	_target_look_pitch = _look_pitch;
	_look_recenter_active = false;

func _rotate_orbit(yaw_delta: float, pitch_delta: float) -> void:
	_attach_look_to_rig();
	_yaw = wrapf(_yaw + yaw_delta, -PI, PI);

	var base_pitch := _base_pitch_for_zoom(_zoom);
	var rig_pitch := clampf(
		base_pitch + _orbit_pitch_offset + pitch_delta,
		deg_to_rad(min_orbit_pitch),
		deg_to_rad(max_orbit_pitch)
	);

	_orbit_pitch_offset = rig_pitch - base_pitch;
	_target_yaw = _yaw;
	_target_orbit_pitch_offset = _orbit_pitch_offset;
	_sync_look_to_rig();

func _zoom_at(screen_position: Vector2, zoom_in: bool, event_factor: float) -> void:
	if not _wheel_zoom_active:
		_target_zoom = _zoom;
		_target_focus = _focus;
		_wheel_zoom_active = true;

	_begin_zoom_anchor(screen_position);

	var amount := event_factor if event_factor > 0.0 else 1.0;
	var multiplier: float = pow(zoom_factor, amount);

	if zoom_in:
		_target_zoom *= multiplier;
	else:
		_target_zoom /= multiplier;

	_target_zoom = clampf(_target_zoom, min_zoom, max_zoom);

func _ground_point_is_directly_usable(point: Vector3) -> bool:
	if not point.is_finite():
		return false;

	var rig_pitch := _rig_pitch(_zoom, _orbit_pitch_offset);
	var rig_distance := _rig_distance_for_height(_zoom, rig_pitch);
	var eye := _camera_position_for_state(_focus, _zoom, _yaw, _orbit_pitch_offset);

	return eye.distance_to(point) <= rig_distance * MAX_DIRECT_GROUND_DISTANCE_FACTOR;


func _begin_zoom_anchor(screen_position: Vector2) -> void:
	var point := _world_at_screen(screen_position);

	if not _ground_point_is_directly_usable(point):
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

func _finish_wheel_zoom_if_settled() -> void:
	if not _wheel_zoom_active:
		return;

	if absf(_zoom - _target_zoom) >= 0.001:
		return;

	_zoom = _target_zoom;
	_wheel_zoom_active = false;
	_zoom_anchor_active = false;


func _normalized_zoom(zoom: float) -> float:
	if is_equal_approx(min_zoom, max_zoom):
		return 0.0;

	var safe_zoom := clampf(zoom, min_zoom, max_zoom);
	return clampf(log(safe_zoom / min_zoom) / log(max_zoom / min_zoom), 0.0, 1.0);


func _zoom_arc_ratio(zoom: float) -> float:
	var ratio := _normalized_zoom(zoom);
	var smooth_ratio := ratio * ratio * (3.0 - 2.0 * ratio);

	return pow(smooth_ratio, zoom_arc_curve);

func _base_pitch_for_zoom(zoom: float) -> float:
	return deg_to_rad(lerpf(near_pitch, far_pitch, _zoom_arc_ratio(zoom)));


func _rig_pitch(zoom: float, orbit_pitch_offset: float) -> float:
	return clampf(
		_base_pitch_for_zoom(zoom) + orbit_pitch_offset,
		deg_to_rad(min_orbit_pitch),
		deg_to_rad(max_orbit_pitch)
	);


func _current_view_yaw() -> float:
	return _look_yaw if _look_detached else _yaw;

func _current_view_pitch() -> float:
	return _look_pitch if _look_detached else _rig_pitch(_zoom, _orbit_pitch_offset);


func _target_view_yaw() -> float:
	return _target_look_yaw if _look_detached else _target_yaw;


func _target_view_pitch() -> float:
	return (
		_target_look_pitch
		if _look_detached
		else _rig_pitch(_target_zoom, _target_orbit_pitch_offset)
	);

func _view_direction(yaw: float, pitch: float) -> Vector3:
	var horizontal := cos(pitch);
	return Vector3(-sin(yaw) * horizontal, -sin(pitch), -cos(yaw) * horizontal);


func _apply_camera_transform() -> void:
	_apply_camera_transform_for_state(
		_focus,
		_zoom,
		_yaw,
		_orbit_pitch_offset,
		_current_view_yaw(),
		_current_view_pitch()
	);

func _rig_distance_for_height(height: float, rig_pitch: float) -> float:
	var vertical_span := maxf(height - rig_target_height, 0.001);
	var vertical_factor := maxf(sin(rig_pitch), 0.001);

	return vertical_span / vertical_factor;

func _camera_position_for_state(
	focus: Vector3,
	zoom: float,
	rig_yaw: float,
	orbit_pitch_offset: float
) -> Vector3:
	var rig_pitch := _rig_pitch(zoom, orbit_pitch_offset);
	var distance := _rig_distance_for_height(zoom, rig_pitch);
	var target := focus + Vector3.UP * rig_target_height;

	return target - _view_direction(rig_yaw, rig_pitch) * distance;

func _apply_camera_transform_for_state(
	focus: Vector3,
	zoom: float,
	rig_yaw: float,
	orbit_pitch_offset: float,
	view_yaw: float,
	view_pitch: float
) -> void:
	var eye := _camera_position_for_state(focus, zoom, rig_yaw, orbit_pitch_offset);
	_apply_camera_pose(focus, eye, view_yaw, view_pitch);

func _apply_camera_pose(focus: Vector3, eye: Vector3, view_yaw: float, view_pitch: float) -> void:
	global_position = focus;
	camera.global_position = eye;
	camera.look_at(eye + _view_direction(view_yaw, view_pitch), Vector3.UP);


func _world_at_screen(screen_position: Vector2) -> Vector3:
	var origin := camera.project_ray_origin(screen_position);
	var direction := camera.project_ray_normal(screen_position);

	return resolve_ground_ray(origin, direction);


func resolve_ground_ray(origin: Vector3, direction: Vector3, max_distance := -1.0) -> Vector3:
	if direction.is_zero_approx():
		return Vector3.INF;

	var ray_direction := direction.normalized();
	var distance := ground_query_distance if max_distance <= 0.0 else minf(max_distance, ground_query_distance);

	if distance <= 0.0:
		return Vector3.INF;

	if ground_mode == GroundMode.PLANE:
		if absf(ray_direction.y) < 0.00001:
			return Vector3.INF;

		var plane_distance := (ground_height - origin.y) / ray_direction.y;

		if plane_distance < 0.0 or plane_distance > distance:
			return Vector3.INF;

		return origin + ray_direction * plane_distance;

	if not _inside_ground_update:
		return Vector3.INF;

	var query := PhysicsRayQueryParameters3D.create(
		origin,
		origin + ray_direction * distance,
		ground_collision_mask
	);
	query.collide_with_areas = ground_collide_with_areas;
	query.collide_with_bodies = true;

	var excluded: Array[RID] = [];

	for _index in range(ground_max_skips + 1):
		query.exclude = excluded;

		var result := get_world_3d().direct_space_state.intersect_ray(query);

		if result.is_empty():
			return Vector3.INF;

		var hit_position: Vector3 = result["position"];

		if ground_required_group == &"":
			return hit_position;

		var collider: Object = result["collider"];

		if _collider_matches_ground_group(collider):
			return hit_position;

		var rid: RID = result["rid"];
		excluded.append(rid);

	return Vector3.INF;


func _collider_matches_ground_group(collider: Object) -> bool:
	if not collider is Node:
		return false;

	var node := collider as Node;

	while node != null:
		if node.is_in_group(ground_required_group):
			return true;

		node = node.get_parent();

	return false;


func _ground_at_xz(position: Vector3) -> Vector3:
	if ground_mode == GroundMode.PLANE:
		return Vector3(position.x, ground_height, position.z);

	var origin := Vector3(position.x, position.y + ground_probe_up, position.z);
	return resolve_ground_ray(origin, Vector3.DOWN, ground_probe_up + ground_probe_down);


func _align_current_focus_to_ground() -> void:
	var point := _ground_at_xz(_focus);

	if point.is_finite():
		_focus = point;


func _align_target_focus_to_ground() -> void:
	var point := _ground_at_xz(_target_focus);

	if point.is_finite():
		_target_focus = point;


func _constrain_target_state() -> void:
	_align_target_focus_to_ground();

	if not bounds_enabled:
		return;

	var correction := _bounds_correction(
		_target_focus,
		_target_zoom,
		_target_yaw,
		_target_orbit_pitch_offset,
		_target_view_yaw(),
		_target_view_pitch(),
		not _look_detached
	);

	_target_focus.x += correction.x;
	_target_focus.z += correction.y;
	_align_target_focus_to_ground();

func _constrain_current_state() -> Vector3:
	_align_current_focus_to_ground();

	if not bounds_enabled:
		return Vector3.ZERO;

	var correction_2d := _bounds_correction(
		_focus,
		_zoom,
		_yaw,
		_orbit_pitch_offset,
		_current_view_yaw(),
		_current_view_pitch(),
		not _look_detached
	);
	var correction := Vector3(correction_2d.x, 0.0, correction_2d.y);

	_focus += correction;
	_align_current_focus_to_ground();

	return correction;

func _bounds_correction(
	focus: Vector3,
	zoom: float,
	rig_yaw: float,
	orbit_pitch_offset: float,
	view_yaw: float,
	view_pitch: float,
	allow_view_bounds: bool
) -> Vector2:
	if bounds_mode == BoundsMode.FOCUS or not allow_view_bounds:
		return _focus_bounds_correction(focus);

	var view_rect := _ground_view_rect_for_state(
		focus,
		zoom,
		rig_yaw,
		orbit_pitch_offset,
		view_yaw,
		view_pitch
	);

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


func _ground_view_rect_for_state(
	focus: Vector3,
	zoom: float,
	rig_yaw: float,
	orbit_pitch_offset: float,
	view_yaw: float,
	view_pitch: float
) -> Rect2:
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

	var forward := _view_direction(view_yaw, view_pitch);
	var right := Vector3(cos(view_yaw), 0.0, -sin(view_yaw));
	var up := right.cross(forward).normalized();
	var eye := _camera_position_for_state(focus, zoom, rig_yaw, orbit_pitch_offset);

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
	return resolve_ground_ray(eye, ray_direction);


func _normalize_configuration() -> void:
	ground_max_skips = maxi(ground_max_skips, 0);
	ground_query_distance = maxf(ground_query_distance, 0.001);
	ground_probe_up = maxf(ground_probe_up, 0.0);
	ground_probe_down = maxf(ground_probe_down, 0.001);

	min_zoom = maxf(min_zoom, 0.001);
	max_zoom = maxf(max_zoom, min_zoom);
	initial_zoom = clampf(initial_zoom, min_zoom, max_zoom);
	rig_target_height = clampf(rig_target_height, 0.0, maxf(min_zoom - 0.1, 0.0));

	near_pitch = clampf(near_pitch, 1.0, 85.0);
	far_pitch = clampf(far_pitch, near_pitch, 89.0);
	zoom_arc_curve = maxf(zoom_arc_curve, 0.5);
	min_orbit_pitch = clampf(min_orbit_pitch, 0.1, 85.0);
	max_orbit_pitch = clampf(max_orbit_pitch, min_orbit_pitch, 89.0);
	min_look_pitch = clampf(min_look_pitch, -89.0, 0.0);
	max_look_pitch = clampf(max_look_pitch, 0.0, 89.0);

	zoom_factor = clampf(zoom_factor, 0.01, 0.999);
	pan_screen_speed = maxf(pan_screen_speed, 0.01);
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


func _sync_look_to_rig() -> void:
	_look_yaw = _yaw;
	_target_look_yaw = _target_yaw;
	_look_pitch = _rig_pitch(_zoom, _orbit_pitch_offset);
	_target_look_pitch = _rig_pitch(_target_zoom, _target_orbit_pitch_offset);


func _detach_look() -> void:
	if _look_detached:
		return;

	_sync_look_to_rig();
	_look_detached = true;
	_look_recenter_active = false;


func _attach_look_to_rig() -> void:
	_look_detached = false;
	_look_recenter_active = false;
	_sync_look_to_rig();


func _look_is_at_target() -> bool:
	var yaw_error := absf(wrapf(_target_look_yaw - _look_yaw, -PI, PI));
	var pitch_error := absf(_target_look_pitch - _look_pitch);

	return yaw_error < 0.0001 and pitch_error < 0.0001;


func _cancel_rotation_transition() -> void:
	_target_yaw = _yaw;
	_target_orbit_pitch_offset = _orbit_pitch_offset;
	_look_recenter_active = false;

	if _look_detached:
		_target_look_yaw = _look_yaw;
		_target_look_pitch = _look_pitch;
	else:
		_sync_look_to_rig();

func _reset_transient_input() -> void:
	_end_rotation_pointer_capture();
	_dragging = false;
	_drag_anchor_valid = false;
	_rotating = false;
	_rotate_button_down = false;
	_drag_button_down = false;
	_pan_input_active = false;
	_wheel_zoom_active = false;
	_zoom_anchor_active = false;
	_pending_pointer_events.clear();
	_cancel_rotation_transition();

func focus_on(position: Vector3, immediate := false) -> void:
	_target_focus = position;
	_pan_input_active = false;
	_zoom_anchor_active = false;
	_cancel_rotation_transition();

	if _can_resolve_ground_now():
		_constrain_target_state();

	if immediate:
		if _can_resolve_ground_now():
			_snap_now();
		else:
			_snap_requested = true;

func zoom_to(height: float, immediate := false) -> void:
	_target_zoom = clampf(height, min_zoom, max_zoom);
	_wheel_zoom_active = false;
	_zoom_anchor_active = false;
	_cancel_rotation_transition();

	if _can_resolve_ground_now():
		_constrain_target_state();

	if immediate:
		if _can_resolve_ground_now():
			_snap_now();
		else:
			_snap_requested = true;

func rotate_to(yaw_degrees: float, pitch_degrees: float, immediate := false) -> void:
	_zoom_anchor_active = false;
	_cancel_rotation_transition();

	var requested_yaw := wrapf(deg_to_rad(yaw_degrees), -PI, PI);

	if rotation_mode == RotationMode.LOOK:
		_detach_look();
		_target_look_yaw = requested_yaw;
		_target_look_pitch = deg_to_rad(clampf(pitch_degrees, min_look_pitch, max_look_pitch));
	else:
		_attach_look_to_rig();

		var requested_pitch := deg_to_rad(clampf(pitch_degrees, min_orbit_pitch, max_orbit_pitch));
		var target_base_pitch := _base_pitch_for_zoom(_target_zoom);

		_target_yaw = requested_yaw;
		_target_orbit_pitch_offset = requested_pitch - target_base_pitch;

	if _can_resolve_ground_now():
		_constrain_target_state();

	if immediate:
		if _can_resolve_ground_now():
			_snap_now();
		else:
			_snap_requested = true;

func reset_look(immediate := false) -> void:
	_zoom_anchor_active = false;

	if immediate:
		_attach_look_to_rig();
		_collapse_physics_history = true;
		_apply_camera_transform();
		_reset_physics_history();
		return;

	if not _look_detached:
		return;

	_look_recenter_active = true;
	_target_look_yaw = _yaw;
	_target_look_pitch = _rig_pitch(_zoom, _orbit_pitch_offset);

func snap() -> void:
	if _can_resolve_ground_now():
		_snap_now();
	else:
		_snap_requested = true;


func _snap_now() -> void:
	_collapse_physics_history = true;

	_constrain_target_state();
	_focus = _target_focus;
	_zoom = _target_zoom;
	_yaw = _target_yaw;
	_orbit_pitch_offset = _target_orbit_pitch_offset;

	if _look_detached:
		_look_yaw = _target_look_yaw;
		_look_pitch = _target_look_pitch;

		if _look_recenter_active:
			_attach_look_to_rig();
	else:
		_sync_look_to_rig();

	_constrain_current_state();
	_target_focus = _focus;
	_target_zoom = _zoom;
	_apply_camera_transform();

func get_focus_position() -> Vector3:
	return _focus;


func get_zoom() -> float:
	return _zoom;


func get_zoom_ratio() -> float:
	return _normalized_zoom(_target_zoom);

func get_yaw() -> float:
	return rad_to_deg(_current_view_yaw());

func get_pitch() -> float:
	return rad_to_deg(_current_view_pitch());

func get_rig_pitch() -> float:
	return rad_to_deg(_rig_pitch(_zoom, _orbit_pitch_offset));


func _refresh_visible_ground_rect() -> void:
	_visible_ground_rect = _ground_view_rect_for_state(
		_focus,
		_zoom,
		_yaw,
		_orbit_pitch_offset,
		_current_view_yaw(),
		_current_view_pitch()
	);

func _can_resolve_ground_now() -> bool:
	return ground_mode == GroundMode.PLANE or _inside_ground_update;


func get_visible_ground_rect() -> Rect2:
	if ground_mode == GroundMode.PLANE:
		return _ground_view_rect_for_state(
			_focus,
			_zoom,
			_yaw,
			_orbit_pitch_offset,
			_current_view_yaw(),
			_current_view_pitch()
		);

	return _visible_ground_rect;

func has_finite_ground_footprint() -> bool:
	var rect := get_visible_ground_rect();
	return rect.size.x >= 0.0 and rect.size.y >= 0.0;
