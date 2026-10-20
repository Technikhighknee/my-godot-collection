class_name StrategyCamera
extends Node3D

# Stable public API. Other components own input, pose and ground sampling.
signal pointer_pan_started(anchor: Vector2)
signal pointer_pan_ended(anchor: Vector2)
signal pointer_rotation_started(anchor: Vector2)
signal pointer_rotation_ended(anchor: Vector2)

const MIN_HEIGHT := 0.35
const MAX_HEIGHT := 120.0
const INITIAL_HEIGHT := 28.7135

@export_range(150, 1000, 25, "suffix:ms") var pointer_pan_hold_delay_msec := 250
@export_range(1.0, 512.0, 0.5, "suffix:m") var max_height := MAX_HEIGHT
@export_range(0.0, 89.0, 1.0, "suffix:°") var near_min_tilt_degrees := 65.0
@export_range(0.0, 89.0, 1.0, "suffix:°") var far_min_tilt_degrees := 25.0
@export var ground_tracking_enabled := true
@export_flags_3d_physics var ground_collision_mask := 2
@export_range(1.0, 4096.0, 1.0, "suffix:m") var ground_probe_up := 512.0
@export_range(1.0, 4096.0, 1.0, "suffix:m") var ground_probe_down := 1024.0

@onready var camera: Camera3D = $Camera3D
@onready var _input: StrategyCameraInput = $CameraInput
@onready var _movement: StrategyCameraMovement = $CameraMovement
@onready var _ground_tracker: StrategyCameraGroundTracker = $CameraGroundTracker


func _ready() -> void:
	_movement.configure(max_height, near_min_tilt_degrees, far_min_tilt_degrees)
	_movement.initialize(self, camera)
	_input.initialize(self, _movement)
	camera.make_current()
	get_window().focus_exited.connect(_input.reset_pointer_state)


func _exit_tree() -> void:
	_input.reset_pointer_state()
	var window := get_window()
	if window.focus_exited.is_connected(_input.reset_pointer_state):
		window.focus_exited.disconnect(_input.reset_pointer_state)


func _physics_process(_delta: float) -> void:
	if not ground_tracking_enabled or _movement.is_following():
		return
	var ground: float = _ground_tracker.sample_ground_height(
		get_world_3d(), _movement.get_focus_position(),
		ground_collision_mask, ground_probe_up, ground_probe_down
	)
	if not is_nan(ground):
		_movement.set_ground_height(ground)


func _process(delta: float) -> void:
	_input.tick(pointer_pan_hold_delay_msec)
	_movement.configure(max_height, near_min_tilt_degrees, far_min_tilt_degrees)
	_movement.step(delta, _input.get_pan_direction())


func _unhandled_input(event: InputEvent) -> void:
	_input.handle_input(event)


func follow(target: Node3D) -> void:
	_movement.follow(target)
	_input.suppress_edge_scroll_until_motion(get_viewport().get_mouse_position())


func stop_following() -> void:
	_movement.stop_following()


func is_following() -> bool:
	return _movement.is_following()


func set_bounds(bounds: Rect2) -> void:
	_movement.set_bounds(bounds)


func clear_bounds() -> void:
	_movement.clear_bounds()


func set_ceiling_y(world_y: float) -> void:
	_movement.set_ceiling_y(world_y)


func clear_ceiling() -> void:
	_movement.clear_ceiling()


func get_effective_max_height() -> float:
	return _movement.get_effective_max_height()


func focus_on(position: Vector3, immediate := false) -> void:
	_movement.focus_on(position, immediate)


func set_height(height: float, immediate := false) -> void:
	_movement.set_height(height, immediate)


func get_focus_position() -> Vector3:
	return _movement.get_focus_position()


func get_height() -> float:
	return _movement.get_height()


func get_yaw() -> float:
	return _movement.get_yaw()


func get_tilt() -> float:
	return _movement.get_tilt()
