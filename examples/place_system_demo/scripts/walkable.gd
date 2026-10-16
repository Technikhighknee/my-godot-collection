extends NavigationRegion3D

# Demo-only, pre-defined flat navigation. No runtime navigation baking.
@export_range(1.0, 100.0, 0.5) var half_width := 5.5
@export_range(1.0, 100.0, 0.5) var half_depth := 4.5

func _ready() -> void:
	var mesh := NavigationMesh.new()
	mesh.vertices = PackedVector3Array([
		Vector3(-half_width, 0.0, -half_depth),
		Vector3(-half_width, 0.0, half_depth),
		Vector3(half_width, 0.0, half_depth),
		Vector3(half_width, 0.0, -half_depth),
	])
	mesh.add_polygon(PackedInt32Array([0, 1, 2, 3]))
	navigation_mesh = mesh
