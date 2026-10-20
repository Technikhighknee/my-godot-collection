class_name CameraBounds3D
extends Marker3D

@export var size := Vector2(2000.0, 2000.0)
@export_node_path("Node3D") var ceiling_path: NodePath
@export_range(0.0, 10.0, 0.1, "suffix:m") var ceiling_clearance := 0.5


func get_world_bounds() -> Rect2:
	var center := Vector2(global_position.x, global_position.z)
	return Rect2(center - size * 0.5, size)


# Optional. Rooms reference their ceiling node instead of storing a
# manually measured camera height. Worlds without a ceiling return INF.
func get_camera_ceiling_y() -> float:
	if ceiling_path.is_empty():
		return INF

	var ceiling := get_node_or_null(ceiling_path) as Node3D
	if ceiling == null:
		push_warning("CameraBounds3D ceiling_path does not resolve to a Node3D.")
		return INF

	return ceiling.global_position.y - ceiling_clearance
