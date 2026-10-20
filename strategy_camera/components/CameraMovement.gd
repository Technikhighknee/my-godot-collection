class_name StrategyCameraMovement
extends Node

# Owns the camera pose, navigation state and spatial limits.
const MIN_HEIGHT := 0.35
const MAX_HEIGHT := 120.0
const INITIAL_HEIGHT := 28.7135
const HEIGHT_STEP := 0.05
const NEAR_MIN_TILT := 65.0
const FAR_MIN_TILT := 25.0
const MAX_TILT := 90.0
const PAN_SCREEN_SPEED := 1.5
const MIN_PAN_HEIGHT := 12.0
const MOVE_SMOOTHING := 16.0
const HEIGHT_SMOOTHING := 18.0
const MOUSE_YAW_SENSITIVITY := 0.2
const MOUSE_TILT_SENSITIVITY := 0.2
const MAX_INPUT_DELTA := 0.1

var max_height := MAX_HEIGHT
var near_min_tilt_degrees := NEAR_MIN_TILT
var far_min_tilt_degrees := FAR_MIN_TILT
var _host: Node3D
var camera: Camera3D
var _ground_height := 0.0
var _bounds := Rect2()
var _has_bounds := false
var _ceiling_y := INF
var _focus: Vector3
var _target_focus: Vector3
var _follow_target: Node3D
var _height := INITIAL_HEIGHT
var _target_height := INITIAL_HEIGHT
var _yaw := 0.0
var _tilt_ratio := 0.0
var _pan_input_active := false

func initialize(host: Node3D, view_camera: Camera3D) -> void:
	_host = host
	camera = view_camera
	_focus = _host.global_position
	_ground_height = _focus.y
	_target_focus = _focus
	_height = minf(_height, max_height)
	_target_height = minf(_target_height, max_height)
	_yaw = _host.global_rotation.y
	_host.global_rotation = Vector3.ZERO
	_apply_camera_transform()

func configure(height_limit: float, near_tilt: float, far_tilt: float) -> void:
	max_height = height_limit
	near_min_tilt_degrees = near_tilt
	far_min_tilt_degrees = far_tilt

func set_ground_height(height: float) -> void:
	_ground_height = height

func freeze_pan_target() -> void:
	_target_focus = _focus

func step(delta: float, pan_direction: Vector2) -> void:
	_sync_follow_target()
	_handle_pan_input(minf(delta, MAX_INPUT_DELTA), pan_direction)
	var move_t := _smooth_factor(MOVE_SMOOTHING, delta)
	var height_t := _smooth_factor(HEIGHT_SMOOTHING, delta)
	if _follow_target == null:
		var moved := _focus.lerp(_target_focus, move_t)
		_focus.x = moved.x
		_focus.z = moved.z
		_focus.y = lerpf(_focus.y, _ground_height, height_t)
		_focus = _clamp_focus(_focus)
	var allowed_height := get_effective_max_height()
	_target_height = minf(_target_height, allowed_height)
	_height = minf(_height, allowed_height)
	_height = lerpf(_height, _target_height, height_t)
	if absf(_height - _target_height) < 0.001:
		_height = _target_height
	_apply_camera_transform()

func _handle_pan_input(delta: float, input_vector: Vector2) -> void:
	if input_vector == Vector2.ZERO:
		_pan_input_active = false
		return
	_stop_following_internal()
	if not _pan_input_active:
		_target_focus = _focus
		_pan_input_active = true
	_target_focus = _clamp_focus(
		_target_focus + _pan_world_delta(input_vector, _pan_speed() * delta)
	)

func _sync_follow_target() -> void:
	if _follow_target == null:
		return

	if (
		not is_instance_valid(_follow_target)
		or not _follow_target.is_inside_tree()
	):
		_stop_following_internal()
		return

	var position := _follow_target.global_position
	_focus = _clamp_focus(position)
	_target_focus = _focus
	_ground_height = position.y


func _stop_following_internal() -> void:
	if _follow_target == null:
		return

	_follow_target = null
	_ground_height = _focus.y
	_target_focus = _focus


func rotate_pointer(event: InputEventMouseMotion) -> void:
	_yaw = wrapf(
		_yaw - deg_to_rad(event.screen_relative.x * MOUSE_YAW_SENSITIVITY),
		-PI,
		PI
	)

	var tilt := _view_tilt()
	tilt -= deg_to_rad(
		event.screen_relative.y * MOUSE_TILT_SENSITIVITY
	)
	_set_view_tilt(tilt)

	_apply_camera_transform()


func pan_pointer(event: InputEventMouseMotion) -> void:
	var motion := event.screen_relative

	if motion == Vector2.ZERO:
		return

	_stop_following_internal()

	var world_delta := _pan_world_delta(
		motion,
		_pan_world_units_per_pixel()
	)

	_focus = _clamp_focus(_focus + world_delta)
	_target_focus = _focus

	_apply_camera_transform()


func _pan_world_delta(direction: Vector2, distance: float) -> Vector3:
	var right := Vector3(cos(_yaw), 0.0, -sin(_yaw))
	var backward := Vector3(sin(_yaw), 0.0, cos(_yaw))

	return (
		right * direction.x
		+ backward * direction.y
	) * distance


func _pan_speed() -> float:
	return _pan_world_span() * PAN_SCREEN_SPEED


func _pan_world_units_per_pixel() -> float:
	var viewport_height := get_viewport().get_visible_rect().size.y

	if viewport_height <= 0.0:
		return 0.0

	return _pan_world_span() / viewport_height


func _pan_world_span() -> float:
	var pan_height := maxf(_height, MIN_PAN_HEIGHT)
	var half_fov_tan := tan(deg_to_rad(camera.fov) * 0.5)
	return 2.0 * pan_height * half_fov_tan


func change_height(direction: float, event_factor: float) -> void:
	var amount := event_factor if event_factor > 0.0 else 1.0
	var limit := get_effective_max_height()
	var ratio := _normalized_zoom_height(_target_height, limit)

	ratio = clampf(
		ratio + direction * HEIGHT_STEP * amount,
		0.0,
		1.0
	)
	_target_height = _height_for_ratio(ratio, limit)


func _view_tilt() -> float:
	var min_tilt := _min_tilt_for_height(_height)
	return lerpf(min_tilt, deg_to_rad(MAX_TILT), _tilt_ratio)


func _set_view_tilt(tilt: float) -> void:
	var min_tilt := _min_tilt_for_height(_height)
	var max_tilt := deg_to_rad(MAX_TILT)
	var clamped := clampf(tilt, min_tilt, max_tilt)
	var span := max_tilt - min_tilt

	_tilt_ratio = 0.0 if span <= 0.0 else (clamped - min_tilt) / span


func set_tilt(degrees: float) -> void:
	_set_view_tilt(deg_to_rad(degrees))
	_apply_camera_transform()


func _min_tilt_for_height(height: float) -> float:
	return deg_to_rad(
		lerpf(
			near_min_tilt_degrees,
			far_min_tilt_degrees,
			_normalized_height(height)
		)
	)


func _normalized_height(height: float) -> float:
	var safe_height := clampf(height, MIN_HEIGHT, max_height)

	return clampf(
		log(safe_height / MIN_HEIGHT) / log(max_height / MIN_HEIGHT),
		0.0,
		1.0
	)


func _normalized_zoom_height(height: float, limit: float) -> float:
	if limit <= MIN_HEIGHT:
		return 0.0
	return clampf(
		log(clampf(height, MIN_HEIGHT, limit) / MIN_HEIGHT)
		/ log(limit / MIN_HEIGHT),
		0.0, 1.0
	)


func _height_for_ratio(ratio: float, limit: float) -> float:
	return MIN_HEIGHT * pow(
		limit / MIN_HEIGHT, clampf(ratio, 0.0, 1.0)
	)


func _view_direction() -> Vector3:
	var tilt := _view_tilt()
	var horizontal := sin(tilt)

	return Vector3(
		-sin(_yaw) * horizontal,
		-cos(tilt),
		-cos(_yaw) * horizontal
	)


func _apply_camera_transform() -> void:
	_host.global_position = _focus
	camera.global_position = _focus + Vector3.UP * _height
	camera.look_at(
		camera.global_position + _view_direction(),
		Vector3.UP
	)


func _smooth_factor(speed: float, delta: float) -> float:
	return 1.0 - exp(-speed * delta)


func follow(target: Node3D) -> void:
	assert(target != null, "StrategyCamera cannot follow a null target.")
	assert(target != _host, "StrategyCamera cannot follow itself.")
	assert(
		not _host.is_ancestor_of(target),
		"StrategyCamera cannot follow one of its own descendants."
	)
	assert(
		target.is_inside_tree(),
		"StrategyCamera can only follow a target that is inside the scene tree."
	)

	var delta := target.global_position - _focus

	if Vector2(delta.x, delta.z).length_squared() > 0.000001:
		_yaw = atan2(-delta.x, -delta.z)

	_follow_target = target
	_tilt_ratio = 0.0
	_pan_input_active = false
	_sync_follow_target()
	_apply_camera_transform()


func stop_following() -> void:
	_stop_following_internal()


func is_following() -> bool:
	return (
		_follow_target != null
		and is_instance_valid(_follow_target)
		and _follow_target.is_inside_tree()
	)


func set_bounds(bounds: Rect2) -> void:
	# World-space X/Z rectangle for the camera focus, not its full frustum.
	_bounds = bounds.abs()
	_has_bounds = true
	_limit_height_and_focus()

	if _host.is_node_ready():
		_apply_camera_transform()


func clear_bounds() -> void:
	_has_bounds = false


func _clamp_focus(position: Vector3) -> Vector3:
	if not _has_bounds:
		return position

	position.x = clampf(position.x, _bounds.position.x, _bounds.end.x)
	position.z = clampf(position.z, _bounds.position.y, _bounds.end.y)
	return position


func _limit_height_and_focus() -> void:
	var limit := get_effective_max_height()
	_height = minf(_height, limit)
	_target_height = minf(_target_height, limit)
	_focus = _clamp_focus(_focus)
	_target_focus = _clamp_focus(_target_focus)


# Ceiling coordinates are absolute world Y, not zoom distances.
# INF clears the ceiling and leaves only the normal zoom limit.


func set_ceiling_y(world_y: float) -> void:
	_ceiling_y = world_y
	_limit_height_and_focus()
	if _host.is_node_ready():
		_apply_camera_transform()


func clear_ceiling() -> void:
	set_ceiling_y(INF)


func get_effective_max_height() -> float:
	var limit := max_height
	if _ceiling_y < INF:
		limit = minf(limit, _ceiling_y - _focus.y)
	return clampf(limit, MIN_HEIGHT, max_height)


func focus_on(position: Vector3, immediate := false) -> void:
	_stop_following_internal()
	position = _clamp_focus(position)
	_ground_height = position.y
	_target_focus = position
	_pan_input_active = false

	if immediate:
		_focus = _target_focus
		_limit_height_and_focus()
		_apply_camera_transform()


func set_height(height: float, immediate := false) -> void:
	_target_height = clampf(height, MIN_HEIGHT, get_effective_max_height())

	if immediate:
		_height = _target_height
		_limit_height_and_focus()
		_apply_camera_transform()


func get_focus_position() -> Vector3:
	return _focus


func get_height() -> float:
	return _height


func get_yaw() -> float:
	return rad_to_deg(_yaw)


func get_tilt() -> float:
	return rad_to_deg(_view_tilt())
