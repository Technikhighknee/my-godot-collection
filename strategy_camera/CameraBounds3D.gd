class_name CameraBounds3D
extends Marker3D

@export var size := Vector2(2000.0, 2000.0)


func get_world_bounds() -> Rect2:
	var center := Vector2(global_position.x, global_position.z)
	return Rect2(center - size * 0.5, size)
