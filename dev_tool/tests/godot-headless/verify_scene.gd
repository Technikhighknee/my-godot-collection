extends SceneTree

# Execute after Godot imports the generated GLB:
# godot --headless --path "$FIXTURE" --script res://verify_scene.gd

func fail(message: String) -> void:
	push_error("GODOT INTEGRATION FAILED: " + message)
	quit(1)

func _initialize() -> void:
	var packed := load("res://world.tscn") as PackedScene
	if packed == null:
		fail("Generated world.tscn did not load as PackedScene")
		return
	var world := packed.instantiate() as Node3D
	if world == null:
		fail("Generated scene did not instantiate as Node3D")
		return
	var objects := world.get_node_or_null("Objects") as Node3D
	if objects == null or objects.get_child_count() != 3:
		fail("Expected exactly three generated objects")
		world.free()
		return

	var known := {}
	for node in objects.get_children():
		var placement_id := str(node.get_meta("placement_id", ""))
		known[placement_id] = node

	if not known.has("tree_a") or not known.has("tree_b") or not known.has("well"):
		fail("Missing placement metadata: " + str(known.keys()))
		world.free()
		return

	var first := known["tree_a"] as Node3D
	var second := known["tree_b"] as Node3D
	var well := known["well"] as Node3D
	if first == null or second == null or well == null:
		fail("Generated placement is not Node3D")
		world.free()
		return

	# A successful PackedScene load is not enough: the GLB must have
	# completed import and produce a nonempty model hierarchy.
	if first.get_child_count() < 1 or second.get_child_count() < 1:
		fail("GLB instances did not import into actual model hierarchies")
		world.free()
		return
	if str(first.get_meta("definition_id", "")) != "asset:fixture-tree":
		fail("First model lost its semantic definition reference")
		world.free()
		return
	if str(second.get_meta("definition_id", "")) != "asset:fixture-tree":
		fail("Second model lost its semantic definition reference")
		world.free()
		return
	if first.position.distance_to(Vector3(12, 0, 24)) > 0.0001:
		fail("First model position changed: " + str(first.position))
		world.free()
		return
	if second.position.distance_to(Vector3(20, 0, 30)) > 0.0001:
		fail("Second model position changed: " + str(second.position))
		world.free()
		return
	if absf(first.rotation.y - deg_to_rad(90.0)) > 0.0001:
		fail("First model rotation changed")
		world.free()
		return
	if absf(second.rotation.y - deg_to_rad(-45.0)) > 0.0001:
		fail("Second model rotation changed")
		world.free()
		return
	if not (well is Marker3D):
		fail("Unresolved game definition was not preserved as Marker3D")
		world.free()
		return
	if not bool(well.get_meta("unresolved_game_definition", false)):
		fail("Unresolved marker lost its explicit metadata")
		world.free()
		return
	if str(well.get_meta("definition_id", "")) != "object.well":
		fail("Unresolved marker lost its semantic ID")
		world.free()
		return

	print("GODOT INTEGRATION PASSED: 2 GLB instances, 1 semantic marker, correct positions and rotations")
	world.free()
	quit(0)
