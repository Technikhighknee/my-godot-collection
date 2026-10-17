class_name PlaceInstance
extends RefCounted

# One physical place. A PackedScene can back many independent instances.
# Its World3D lives in a Viewport and remains active while rendering is off.
var id: StringName
var building_id: StringName
var root: Node3D
var actors_root: Node3D
var viewport: Viewport
var owned_viewport: bool
var portals: Dictionary = {}


func _init(
	place_id: StringName,
	owner_building_id: StringName,
	content_root: Node3D,
	actor_container: Node3D,
	world_viewport: Viewport,
	is_owned: bool
) -> void:
	id = place_id
	building_id = owner_building_id
	root = content_root
	actors_root = actor_container
	viewport = world_viewport
	owned_viewport = is_owned


func get_portal(portal_id: StringName) -> PlacePortal3D:
	return portals.get(portal_id) as PlacePortal3D


func get_navigation_map() -> RID:
	if not is_instance_valid(viewport):
		return RID()
	# Viewport.world_3d is only an explicitly assigned world; it may be
	# null even when a viewport has an effective inherited/owned 3D world.
	var world := viewport.find_world_3d()
	if world == null:
		return RID()
	return world.navigation_map
