class_name MovementAgent3D
extends NavigationAgent3D

# Walking navigation for a CharacterBody3D parent. This component is the
# body's sole movement driver; the game decides why and where it moves.

signal movement_started(destination: Vector3)
signal movement_arrived(destination: Vector3)
signal movement_stopped()
signal movement_failed(destination: Vector3, reason: StringName)

@export_range(0.1, 30.0, 0.1, "or_greater") var move_speed := 4.0
@export_range(0.1, 60.0, 0.1, "or_greater") var acceleration := 20.0
@export_range(0.0, 5.0, 0.1, "or_greater") var gravity_scale := 1.0
@export_range(0.1, 30.0, 0.1, "or_greater") var navigation_timeout := 3.0
@export_range(0.1, 30.0, 0.1, "or_greater") var stuck_timeout := 4.0
@export_range(0.01, 2.0, 0.01, "or_greater") var progress_distance := 0.15

var _body: CharacterBody3D
var _moving := false
var _destination := Vector3.ZERO
var _map_wait := 0.0
var _stuck_time := 0.0
var _progress_origin := Vector3.ZERO
var _avoidance_pending := false
var _avoidance_delta := 0.0


func _ready() -> void:
	_body = get_parent() as CharacterBody3D
	if _body == null:
		push_error("MovementAgent3D must be a direct child of CharacterBody3D.")
		set_physics_process(false)
		return

	velocity_computed.connect(_on_velocity_computed)


func move_to(destination: Vector3) -> bool:
	if _body == null or not destination.is_finite():
		return false

	if _moving:
		# Replacing a goal cancels its previous movement, not the body's momentum.
		_moving = false
		_avoidance_pending = false
		movement_stopped.emit()

	_destination = destination
	_moving = true
	_map_wait = 0.0
	_stuck_time = 0.0
	_progress_origin = _body.global_position
	target_position = destination
	movement_started.emit(destination)
	return true


func stop() -> void:
	if not _moving:
		return

	_moving = false
	_avoidance_pending = false
	_zero_horizontal_velocity()
	velocity = Vector3.ZERO
	movement_stopped.emit()


func is_moving() -> bool:
	return _moving


func get_destination() -> Vector3:
	return _destination


func _physics_process(delta: float) -> void:
	if _body == null:
		return

	if not _moving:
		_move_body(Vector3.ZERO, delta)
		return

	# A newly created navigation map needs at least one server sync.
	# Querying paths before that can produce misleading empty paths.
	var navigation_map := get_navigation_map()
	if not navigation_map.is_valid() or NavigationServer3D.map_get_iteration_id(navigation_map) == 0:
		_map_wait += delta
		if _map_wait >= navigation_timeout:
			_fail(&"navigation_unavailable")
		_move_body(Vector3.ZERO, delta)
		return

	_map_wait = 0.0
	# This call advances the built-in path state. Make it once each physics tick.
	var waypoint := get_next_path_position()

	if is_navigation_finished():
		if is_target_reached():
			_arrive()
		else:
			_fail(&"unreachable")
		_move_body(Vector3.ZERO, delta)
		return

	# Ground walking uses XZ steering. CharacterBody3D handles vertical
	# movement, floors, slopes and wall collision through move_and_slide().
	var direction := waypoint - _body.global_position
	direction.y = 0.0
	var desired := Vector3.ZERO
	if direction.length_squared() > 0.000001:
		var remaining := _body.global_position.distance_to(_destination)
		var braking_distance := maxf(remaining - target_desired_distance * 0.5, 0.0)
		var allowed_speed := minf(move_speed, sqrt(2.0 * acceleration * braking_distance))
		desired = direction.normalized() * allowed_speed

	var current := Vector3(_body.velocity.x, 0.0, _body.velocity.z)
	var requested := current.move_toward(desired, acceleration * delta)

	if avoidance_enabled:
		# Godot computes and dispatches the safe velocity later in this
		# same physics frame. Never move twice.
		max_speed = move_speed
		_avoidance_delta = delta
		_avoidance_pending = true
		velocity = requested
	else:
		_avoidance_pending = false
		_move_body(requested, delta)
		_check_progress(delta)


func _on_velocity_computed(safe_velocity: Vector3) -> void:
	if not _moving or not avoidance_enabled or not _avoidance_pending:
		return

	_avoidance_pending = false
	_move_body(Vector3(safe_velocity.x, 0.0, safe_velocity.z), _avoidance_delta)
	_check_progress(_avoidance_delta)


func _move_body(horizontal_velocity: Vector3, delta: float) -> void:
	_body.velocity.x = horizontal_velocity.x
	_body.velocity.z = horizontal_velocity.z

	if _body.is_on_floor():
		_body.velocity.y = 0.0
	else:
		_body.velocity.y -= (
			float(ProjectSettings.get_setting("physics/3d/default_gravity"))
			* gravity_scale * delta
		)

	_body.move_and_slide()


func _check_progress(delta: float) -> void:
	if not _moving:
		return

	var travelled := _body.global_position - _progress_origin
	travelled.y = 0.0

	if travelled.length_squared() >= progress_distance * progress_distance:
		_progress_origin = _body.global_position
		_stuck_time = 0.0
		return

	_stuck_time += delta
	if _stuck_time >= stuck_timeout:
		_fail(&"stuck")


func _arrive() -> void:
	_moving = false
	_avoidance_pending = false
	_zero_horizontal_velocity()
	velocity = Vector3.ZERO
	movement_arrived.emit(_destination)


func _fail(reason: StringName) -> void:
	_moving = false
	_avoidance_pending = false
	_zero_horizontal_velocity()
	velocity = Vector3.ZERO
	movement_failed.emit(_destination, reason)


func _zero_horizontal_velocity() -> void:
	if _body == null:
		return
	_body.velocity.x = 0.0
	_body.velocity.z = 0.0
