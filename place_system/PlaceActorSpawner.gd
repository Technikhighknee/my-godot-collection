class_name PlaceActorSpawner
extends RefCounted

# Creates the persistent gameplay identity separately from the spatial body.
# Actor and body templates are supplied by the game (not hardcoded here).
# Returns null without leaving half-initialized objects on failure.

static func spawn(
	manager: PlaceManager3D, persistent_parent: Node,
	actor_scene: PackedScene, body_scene: PackedScene,
	actor_id: StringName, location: PlaceLocation
) -> PlaceActor:
	if not is_instance_valid(manager) or not is_instance_valid(persistent_parent):
		return null
	if not persistent_parent.is_inside_tree():
		return null
	if actor_scene == null or body_scene == null or actor_id == &"":
		return null
	if location == null or not location.is_valid():
		return null

	var place := manager.get_place(location.place_id)
	if place == null or manager.get_actor_by_id(actor_id) != null:
		return null

	var actor_node := actor_scene.instantiate()
	if not actor_node is PlaceActor:
		if actor_node != null:
			actor_node.free()
		return null

	var body_node := body_scene.instantiate()
	if not body_node is CharacterBody3D:
		if body_node != null:
			body_node.free()
		actor_node.free()
		return null

	var actor := actor_node as PlaceActor
	var body := body_node as CharacterBody3D
	actor.actor_id = actor_id

	# Spawn the body into the destination physics world BEFORE binding.
	place.actors_root.add_child(body)
	body.global_position = location.position
	body.reset_physics_interpolation()
	persistent_parent.add_child(actor)

	if not actor.bind_body(manager, body, location.place_id):
		actor.free()
		body.free()
		return null
	return actor
