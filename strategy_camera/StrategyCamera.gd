class_name StrategyCamera
extends Node3D;


signal pointer_pan_started(anchor: Vector2);
signal pointer_pan_ended(anchor: Vector2);
signal pointer_rotation_started(anchor: Vector2);
signal pointer_rotation_ended(anchor: Vector2);


const MIN_HEIGHT := 0.35;
const MAX_HEIGHT := 120.0;
const INITIAL_HEIGHT := 28.7135;
const HEIGHT_STEP := 0.05;

const NEAR_MIN_TILT := 65.0;
const FAR_MIN_TILT := 25.0;
const MAX_TILT := 90.0;

const PAN_SCREEN_SPEED := 1.5;
const MIN_PAN_HEIGHT := 12.0;
const EDGE_SCROLL_MARGIN := 24.0;
const MOVE_SMOOTHING := 16.0;
const HEIGHT_SMOOTHING := 18.0;

const MOUSE_YAW_SENSITIVITY := 0.2;
const MOUSE_TILT_SENSITIVITY := 0.2;

const MAX_INPUT_DELTA := 0.1;

const PAN_LEFT_ACTION: StringName = &"camera_left";
const PAN_RIGHT_ACTION: StringName = &"camera_right";
const PAN_FORWARD_ACTION: StringName = &"camera_forward";
const PAN_BACK_ACTION: StringName = &"camera_back";


@export_range(150, 1000, 25, "suffix:ms") var pointer_pan_hold_delay_msec := 250;
@export_range(1.0, 512.0, 0.5, "suffix:m") var max_height := MAX_HEIGHT;
@export var auto_zoom_to_bounds := true;
@export_range(0.0, 89.0, 1.0, "suffix:°") var near_min_tilt_degrees := NEAR_MIN_TILT;
@export_range(0.0, 89.0, 1.0, "suffix:°") var far_min_tilt_degrees := FAR_MIN_TILT;
@export var ground_tracking_enabled := true;
@export_flags_3d_physics var ground_collision_mask := 2;
@export_range(1.0, 4096.0, 1.0, "suffix:m") var ground_probe_up := 512.0;
@export_range(1.0, 4096.0, 1.0, "suffix:m") var ground_probe_down := 1024.0;

@onready var camera: Camera3D = $Camera3D;


var _ground_height := 0.0;
var _bounds := Rect2();
var _has_bounds := false;

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
var _pan_hold_started_msec := 0;
var _pointer_pan_anchor := Vector2.ZERO;
var _rotating := false;
var _pointer_rotation_anchor := Vector2.ZERO;

var _pointer_capture_active := false;
var _pointer_restore_mouse_mode: Input.MouseMode = Input.MOUSE_MODE_VISIBLE;
var _pointer_restore_mouse_position := Vector2.ZERO;


func _ready() -> void:
	_assert_input_actions();

	_focus = global_position;
	_ground_height = _focus.y;
	_focus.y = _ground_height;
	_target_focus = _focus;
	_focus = _clamp_focus(_focus);
	_target_focus = _clamp_focus(_target_focus);

	_height = minf(_height, max_height);
	_target_height = minf(_target_height, max_height);

	_yaw = global_rotation.y;
	global_rotation = Vector3.ZERO;

	camera.make_current();
	get_window().focus_exited.connect(_reset_pointer_state);

	_apply_camera_transform();


func _exit_tree() -> void:
	_reset_pointer_state();

	var window := get_window();

	if window.focus_exited.is_connected(_reset_pointer_state):
		window.focus_exited.disconnect(_reset_pointer_state);


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


func _physics_process(_delta: float) -> void:
	if not ground_tracking_enabled or _follow_target != null:
		return;

	# Sample only the ground collision layer. Buildings and furniture must not
	# change the camera's reference height.
	var from := _focus + Vector3.UP * ground_probe_up;
	var to := _focus - Vector3.UP * ground_probe_down;
	var query := PhysicsRayQueryParameters3D.create(
		from, to, ground_collision_mask
	);
	var hit := get_world_3d().direct_space_state.intersect_ray(query);

	if not hit.is_empty():
		_ground_height = (hit["position"] as Vector3).y;


func _process(delta: float) -> void:
	_reconcile_pointer_buttons();
	_update_pointer_pan_hold();
	_sync_follow_target();
	_handle_pan_input(minf(delta, MAX_INPUT_DELTA));

	var move_t := _smooth_factor(MOVE_SMOOTHING, delta);
	var height_t := _smooth_factor(HEIGHT_SMOOTHING, delta);
	var allowed_height := get_effective_max_height();
	_target_height = minf(_target_height, allowed_height);
	_height = minf(_height, allowed_height);

	_height = lerpf(_height, _target_height, height_t);
	if absf(_height - _target_height) < 0.001:
		_height = _target_height;

	if _follow_target == null:
		_target_focus = _clamp_focus(_target_focus);
		var moved := _focus.lerp(_target_focus, move_t);
		_focus.x = moved.x;
		_focus.z = moved.z;
		_focus.y = lerpf(_focus.y, _ground_height, height_t);
		_focus = _clamp_focus(_focus);

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
	_focus = _clamp_focus(position);
	_target_focus = _focus;
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
		_end_pointer_rotation();

	if _pan_hold_pending and not Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT):
		_cancel_pointer_pan_hold();

	if _panning and not Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT):
		_end_pointer_pan();


func _update_pointer_pan_hold() -> void:
	if not _pan_hold_pending:
		return;

	if not Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT):
		_cancel_pointer_pan_hold();
		return;

	if not _pointer_pan_hold_ready():
		return;

	_pan_hold_pending = false;
	_pan_hold_started_msec = 0;

	if _rotating:
		_pointer_pan_anchor = _pointer_rotation_anchor;
		_end_pointer_rotation();
	else:
		_pointer_pan_anchor = get_viewport().get_mouse_position();

	_panning = true;
	_target_focus = _focus;
	pointer_pan_started.emit(_pointer_pan_anchor);
	_begin_pointer_capture(_pointer_pan_anchor);


func _pointer_pan_hold_ready() -> bool:
	return (
		_pan_hold_pending
		and Time.get_ticks_msec() - _pan_hold_started_msec
		>= pointer_pan_hold_delay_msec
	);


func _cancel_pointer_pan_hold() -> void:
	_pan_hold_pending = false;
	_pan_hold_started_msec = 0;


func _handle_mouse_button(event: InputEventMouseButton) -> void:
	if event.button_index == MOUSE_BUTTON_MIDDLE:
		if event.pressed and not event.canceled:
			_cancel_pointer_pan_hold();

			var capture_position := event.position;

			if _panning:
				capture_position = _pointer_pan_anchor;
				_end_pointer_pan();

			_target_focus = _focus;
			_begin_pointer_rotation(capture_position);
		elif _rotating:
			_end_pointer_rotation();

		get_viewport().set_input_as_handled();
		return;

	if event.button_index == MOUSE_BUTTON_RIGHT:
		if event.pressed and not event.canceled:
			_pan_hold_pending = true;
			_pan_hold_started_msec = Time.get_ticks_msec();
			return;

		if _panning:
			_end_pointer_pan();
			get_viewport().set_input_as_handled();
		else:
			var was_hold := _pointer_pan_hold_ready();
			_cancel_pointer_pan_hold();

			if was_hold:
				get_viewport().set_input_as_handled();

		return;

	if not event.pressed or event.canceled or _panning or _rotating:
		return;

	if event.button_index == MOUSE_BUTTON_WHEEL_UP:
		_change_height(-1.0, event.factor);
		get_viewport().set_input_as_handled();
	elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
		_change_height(1.0, event.factor);
		get_viewport().set_input_as_handled();


func _begin_pointer_rotation(anchor: Vector2) -> void:
	if _rotating:
		return;

	_rotating = true;
	_pointer_rotation_anchor = anchor;
	pointer_rotation_started.emit(anchor);
	_begin_pointer_capture(anchor);


func _end_pointer_rotation() -> void:
	if not _rotating:
		return;

	_rotating = false;
	_end_pointer_capture();
	pointer_rotation_ended.emit(_pointer_rotation_anchor);


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
	_limit_height_and_focus();

	_apply_camera_transform();
	get_viewport().set_input_as_handled();


func _handle_pointer_pan(event: InputEventMouseMotion) -> void:
	var motion := event.screen_relative;

	if motion == Vector2.ZERO:
		return;

	_stop_following_internal();

	var world_delta := _pan_world_delta(
		motion,
		_pan_world_units_per_pixel()
	);

	_focus = _clamp_focus(_focus + world_delta);
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

	_target_focus = _clamp_focus(
		_target_focus + _pan_world_delta(
			input_vector,
			_pan_speed() * delta
		)
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
	return _pan_world_span() * PAN_SCREEN_SPEED;


func _pan_world_units_per_pixel() -> float:
	var viewport_height := get_viewport().get_visible_rect().size.y;

	if viewport_height <= 0.0:
		return 0.0;

	return _pan_world_span() / viewport_height;


func _pan_world_span() -> float:
	var pan_height := maxf(_height, MIN_PAN_HEIGHT);
	var half_fov_tan := tan(deg_to_rad(camera.fov) * 0.5);
	return 2.0 * pan_height * half_fov_tan;


func _change_height(direction: float, event_factor: float) -> void:
	var amount := event_factor if event_factor > 0.0 else 1.0;
	var limit := get_effective_max_height();
	var ratio := _normalized_zoom_height(_target_height, limit);

	ratio = clampf(
		ratio + direction * HEIGHT_STEP * amount,
		0.0,
		1.0
	);
	_target_height = _height_for_ratio(ratio, limit);


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
			near_min_tilt_degrees,
			far_min_tilt_degrees,
			_normalized_height(height)
		)
	);


func _normalized_height(height: float) -> float:
	var safe_height := clampf(height, MIN_HEIGHT, max_height);

	return clampf(
		log(safe_height / MIN_HEIGHT) / log(max_height / MIN_HEIGHT),
		0.0,
		1.0
	);


func _normalized_zoom_height(height: float, limit: float) -> float:
	if limit <= MIN_HEIGHT:
		return 0.0;
	return clampf(
		log(clampf(height, MIN_HEIGHT, limit) / MIN_HEIGHT)
		/ log(limit / MIN_HEIGHT),
		0.0, 1.0
	);


func _height_for_ratio(ratio: float, limit: float) -> float:
	return MIN_HEIGHT * pow(
		limit / MIN_HEIGHT, clampf(ratio, 0.0, 1.0)
	);


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
	elif _rotating:
		_end_pointer_rotation();
	else:
		_end_pointer_capture();

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


func set_bounds(bounds: Rect2) -> void:
	# World-space X/Z rectangle for the camera focus, not its full frustum.
	_bounds = bounds.abs();
	_has_bounds = true;
	_limit_height_and_focus();

	if is_node_ready():
		_apply_camera_transform();


func clear_bounds() -> void:
	_has_bounds = false;


func _clamp_focus(position: Vector3) -> Vector3:
	if not _has_bounds:
		return position;

	var min_x := _bounds.position.x;
	var max_x := _bounds.end.x;
	var min_z := _bounds.position.y;
	var max_z := _bounds.end.y;

	if auto_zoom_to_bounds:
		var footprint := _ground_footprint_per_meter();
		if not footprint.is_empty():
			var extents := _footprint_extents(footprint);
			var height := minf(_height, get_effective_max_height());
			min_x -= extents.position.x * height;
			max_x -= extents.end.x * height;
			min_z -= extents.position.y * height;
			max_z -= extents.end.y * height;

	if min_x <= max_x and min_z <= max_z:
		position.x = clampf(position.x, min_x, max_x);
		position.z = clampf(position.z, min_z, max_z);
	else:
		position.x = _bounds.get_center().x;
		position.z = _bounds.get_center().y;
	return position;


func _limit_height_and_focus() -> void:
	var limit := get_effective_max_height();
	_height = minf(_height, limit);
	_target_height = minf(_target_height, limit);
	_focus = _clamp_focus(_focus);
	_target_focus = _clamp_focus(_target_focus);


# The ground footprint is computed for one meter of camera height.
# Intersections with the ground plane scale linearly with zoom height.
func _ground_footprint_per_meter() -> Array[Vector2]:
	var viewport_size := get_viewport().get_visible_rect().size;
	if viewport_size.x <= 0.0 or viewport_size.y <= 0.0:
		return [];

	var aspect := viewport_size.x / viewport_size.y;
	var fov_tangent := tan(deg_to_rad(camera.fov) * 0.5);
	var half_x := fov_tangent * aspect;
	var half_y := fov_tangent;
	if camera.keep_aspect == Camera3D.KEEP_WIDTH:
		half_x = fov_tangent;
		half_y = fov_tangent / aspect;

	var forward := _view_direction();
	var right := Vector3(cos(_yaw), 0.0, -sin(_yaw));
	var up := right.cross(forward);
	var footprint: Array[Vector2] = [];
	for vertical in [-1.0, 1.0]:
		for horizontal in [-1.0, 1.0]:
			var direction := forward + right * horizontal * half_x + up * vertical * half_y;
			if direction.y >= -0.0001:
				# A horizon-facing camera has no finite ground footprint.
				return [];
			footprint.append(Vector2(
				direction.x / -direction.y,
				direction.z / -direction.y
			));
	return footprint;


func _footprint_extents(points: Array[Vector2]) -> Rect2:
	var left := INF;
	var right := -INF;
	var top := INF;
	var bottom := -INF;
	for point in points:
		left = minf(left, point.x);
		right = maxf(right, point.x);
		top = minf(top, point.y);
		bottom = maxf(bottom, point.y);
	return Rect2(left, top, right - left, bottom - top);


func get_effective_max_height() -> float:
	if not _has_bounds or not auto_zoom_to_bounds:
		return max_height;

	var footprint := _ground_footprint_per_meter();
	if footprint.is_empty():
		return max_height;

	var extents := _footprint_extents(footprint);
	if extents.size.x <= 0.0001 or extents.size.y <= 0.0001:
		return max_height;

	const FIT_MARGIN := 0.95;
	return clampf(
		minf(
			_bounds.size.x / extents.size.x,
			_bounds.size.y / extents.size.y
		) * FIT_MARGIN,
		MIN_HEIGHT, max_height
	);


func focus_on(position: Vector3, immediate := false) -> void:
	_stop_following_internal();
	position = _clamp_focus(position);
	_ground_height = position.y;
	_target_focus = position;
	_pan_input_active = false;

	if immediate:
		_focus = _target_focus;
		_apply_camera_transform();


func set_height(height: float, immediate := false) -> void:
	_target_height = clampf(height, MIN_HEIGHT, get_effective_max_height());

	if immediate:
		_height = _target_height;
		_limit_height_and_focus();
		_apply_camera_transform();


func get_focus_position() -> Vector3:
	return _focus;


func get_height() -> float:
	return _height;


func get_yaw() -> float:
	return rad_to_deg(_yaw);


func get_tilt() -> float:
	return rad_to_deg(_view_tilt());
