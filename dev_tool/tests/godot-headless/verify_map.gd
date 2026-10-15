extends SceneTree

# This is a real integration check of map_system/ scripts copied verbatim
# into the fixture. The input map/EXR/PNG originate from the portable
# project scene export, not from a separate hand-authored map sample.

func fail(message: String) -> void:
	push_error("MAP SYSTEM INTEGRATION FAILED: " + message)
	quit(1)


func spawn_entry(definition_id: String, _entry: Dictionary) -> Node3D:
	if definition_id == "asset:fixture-tree":
		var model := load("res://assets/fixture-tree/fixture-tree.glb") as PackedScene
		if model == null:
			return null
		return model.instantiate() as Node3D
	if definition_id == "object.well":
		return Marker3D.new()
	return null


func _initialize() -> void:
	var game_map := GameMapLoader.load_file("res://maps/world.map.json")
	if game_map == null:
		fail("Could not load exported map through GameMapLoader")
		return
	if game_map.terrain.get_sample_count() != Vector2i(65, 65):
		fail("EXR sample grid did not retain its original dimensions")
		return
	if game_map.terrain_surfaces.get_cell_count() != Vector2i(64, 64):
		fail("Surface PNG dimensions do not match the map cells")
		return
	if game_map.terrain_surfaces.definition_at(Vector2(12, 24)) != "terrain.grass":
		fail("Indexed surface palette is not preserved")
		return

	var holder := Node3D.new()
	var rendered := GameMapBuilder.build(
		game_map, holder,
		Callable(self, "spawn_entry"), Callable(self, "spawn_entry")
	)
	if rendered == null:
		fail("Map System could not build terrain, roads, water and placements")
		holder.free()
		return

	var visual := rendered.get_node_or_null("Terrain/Surfaces/TexturedSurface") as MeshInstance3D
	if visual == null or visual.mesh == null or visual.mesh.get_surface_count() < 1:
		fail("Textured terrain mesh is missing")
		holder.free()
		return
	var collision_body := rendered.get_node_or_null("Terrain/Collision") as StaticBody3D
	var collision: CollisionShape3D = null
	if collision_body != null:
		for child in collision_body.get_children():
			if child is CollisionShape3D:
				collision = child as CollisionShape3D
				break
	if collision == null or collision.shape == null:
		fail("Terrain collision shape is missing from StaticBody3D")
		holder.free()
		return
	if not (rendered.get_node_or_null("Roads/ci_road") is MeshInstance3D):
		fail("Authored road was not built as a mesh")
		holder.free()
		return
	var sea := rendered.get_node_or_null("Water/ci_sea") as MeshInstance3D
	if sea == null or sea.mesh == null or sea.mesh.get_surface_count() < 1:
		fail("Terrain-derived sea was not built as a mesh")
		holder.free()
		return

	var objects := rendered.get_node_or_null("Objects") as Node3D
	if objects == null or objects.get_child_count() != 3:
		fail("Map System did not spawn all three authored object placements")
		holder.free()
		return

	var authored := load("res://world.tscn") as PackedScene
	if authored == null:
		fail("Cannot compare runtime map with exported placement scene")
		holder.free()
		return
	var exported := authored.instantiate() as Node3D
	if exported == null:
		fail("Exported placement scene failed to instantiate")
		holder.free()
		return

	for placement_id in ["tree_a", "tree_b", "well"]:
		var runtime := objects.get_node_or_null(placement_id) as Node3D
		var from_export: Node3D = null
		for child in exported.get_node("Objects").get_children():
			if str(child.get_meta("placement_id", "")) == placement_id:
				from_export = child as Node3D
				break
		if runtime == null or from_export == null:
			fail("Missing runtime or exported placement: " + placement_id)
			exported.free()
			holder.free()
			return
		if runtime.position.distance_to(from_export.position) > 0.0001:
			fail("Map System and exported scene disagree on placement height: " + placement_id)
			exported.free()
			holder.free()
			return
		if absf(runtime.rotation.y - from_export.rotation.y) > 0.0001:
			fail("Map System and exported scene disagree on rotation: " + placement_id)
			exported.free()
			holder.free()
			return

	print("MAP SYSTEM INTEGRATION PASSED: 65x65 terrain, textured mesh, collision, road, sea, three matching placements")
	exported.free()
	holder.free()
	quit(0)
