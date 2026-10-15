extends SceneTree

# Asserts that engine-imported *prebaked* GLBs provide map geometry.
# No GameMapLoader/GameMapBuilder or procedural terrain creation in Godot.
func fail(message: String) -> void:
	push_error("OFFLINE MAP EXPORT FAILED: " + message)
	quit(1)

func descendants_of_type(root: Node, class_name_value: String) -> Array[Node]:
	var result: Array[Node] = []
	var queue: Array[Node] = [root]
	while not queue.is_empty():
		var node: Node = queue.pop_front()
		if (class_name_value == "MeshInstance3D" and node is MeshInstance3D) or \
				(class_name_value == "StaticBody3D" and node is StaticBody3D):
			result.append(node)
		for child in node.get_children():
			queue.append(child)
	return result

func _initialize() -> void:
	var packed := load("res://world.tscn") as PackedScene
	if packed == null:
		fail("The generated placement scene did not import")
		return
	var scene := packed.instantiate() as Node3D
	if scene == null:
		fail("The map scene did not instantiate")
		return
	var terrain := scene.get_node_or_null("Geometry/Terrain")
	var roads := scene.get_node_or_null("Geometry/Roads")
	var water := scene.get_node_or_null("Geometry/Water")
	if terrain == null or roads == null or water == null:
		fail("Terrain/Roads/Water GLB scene instances are missing")
		scene.free()
		return

	var terrains := descendants_of_type(terrain, "MeshInstance3D")
	var road_meshes := descendants_of_type(roads, "MeshInstance3D")
	var water_meshes := descendants_of_type(water, "MeshInstance3D")
	var collisions := descendants_of_type(terrain, "StaticBody3D")
	if terrains.is_empty() or road_meshes.is_empty() or water_meshes.is_empty():
		fail("One or more baked geometry GLBs contain no mesh instances")
		scene.free()
		return
	if collisions.is_empty():
		fail("Godot did not import the baked terrain as static collision geometry")
		scene.free()
		return
	for child in terrains + road_meshes + water_meshes:
		var mesh_instance := child as MeshInstance3D
		if mesh_instance.mesh == null or mesh_instance.mesh.get_surface_count() < 1:
			fail("Imported geometry contains an empty mesh")
			scene.free()
			return

	var feather := terrain.find_child("TerrainTransitions", true, false) as MeshInstance3D
	if feather == null:
		fail("No offline-baked visual transition mesh was imported")
		scene.free()
		return
	if feather.mesh.get_surface_count() < 2:
		fail("Terrain must contain both category feather materials")
		scene.free()
		return
	var feather_material := feather.mesh.surface_get_material(0)
	if not (feather_material is BaseMaterial3D) or 			(feather_material as BaseMaterial3D).transparency == BaseMaterial3D.TRANSPARENCY_DISABLED:
		fail("Terrain feather surfaces must use transparent PBR materials")
		scene.free()
		return

	var ground_mesh := terrains[0] as MeshInstance3D
	# glTF UV origin is the image top-left, matching world Z=0 in the editor.
	# A future accidental V-flip must fail an actual Godot engine import.
	var ground_arrays := ground_mesh.mesh.surface_get_arrays(0)
	var surface_uvs: PackedVector2Array = ground_arrays[Mesh.ARRAY_TEX_UV]
	var surface_vertices: PackedVector3Array = ground_arrays[Mesh.ARRAY_VERTEX]
	if surface_uvs.is_empty() or surface_uvs.size() != surface_vertices.size():
		fail("Godot imported terrain without complete UVs")
		scene.free()
		return
	# Godot may reorder vertices. Compare each UV against its world position,
	# never assume that the first and last imported vertices are the corners.
	for index in surface_uvs.size():
		var point := surface_vertices[index]
		var expected := Vector2(point.x / 128.0, point.z / 128.0)
		if surface_uvs[index].distance_to(expected) > 0.0001:
			fail("Terrain UV at " + str(point) + " is " +
				str(surface_uvs[index]) + ", expected " + str(expected))
			scene.free()
			return

	var bounds := ground_mesh.mesh.get_aabb()
	if absf(bounds.size.x - 128.0) > 0.01 or absf(bounds.size.z - 128.0) > 0.01:
		fail("The baked terrain dimensions differ from the authored map")
		scene.free()
		return

	var terrain_material := ground_mesh.mesh.surface_get_material(0)
	if terrain_material == null:
		fail("The baked surface material was not imported")
		scene.free()
		return
	if not (terrain_material is BaseMaterial3D):
		fail("Offline terrain did not import as a regular Godot material")
		scene.free()
		return
	var pbr := terrain_material as BaseMaterial3D
	if pbr.albedo_texture == null or pbr.normal_texture == null or pbr.roughness_texture == null:
		fail("Shared project PBR maps did not import into the offline terrain")
		scene.free()
		return

	print("OFFLINE MAP EXPORT PASSED: imported terrain with PBR feather transitions, static collider, roads, water; no runtime geometry builder")
	scene.free()
	quit(0)
