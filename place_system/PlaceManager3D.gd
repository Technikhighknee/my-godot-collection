class_name PlaceManager3D
extends Node

# Each interior has its own World3D; hiding its view stops only rendering.

signal place_registered(place_id: StringName)
signal place_removed(place_id: StringName)
signal place_view_changed(place_id: StringName)
signal portal_traversed(body: Node3D, from_place: StringName, to_place: StringName)
signal portal_rejected(body: Node3D, place_id: StringName, portal_id: StringName)

var _places: Dictionary = {}       # StringName -> PlaceInstance
var _links: Dictionary = {}        # StringName -> { portal_id -> link }
var _body_places: Dictionary = {}  # Node3D -> StringName
var _actor_by_body: Dictionary = {} # Node3D -> persistent Node (optional)
var _actors_by_id: Dictionary = {} # StringName -> persistent Node
var _body_actor_ids: Dictionary = {} # Node3D -> StringName
var _transfers_pending: Dictionary = {}
var _viewed_place: StringName = &""


func register_exterior(place_id: StringName, root: Node3D) -> bool:
	if place_id == &"" or _places.has(place_id) or not is_instance_valid(root):
		return false
	if not root.is_inside_tree():
		return false
	return _register_place(place_id, &"", root, root.get_viewport(), false)


func create_room(
	place_id: StringName, building_id: StringName, layout: PackedScene
) -> bool:
	if place_id == &"" or _places.has(place_id) or layout == null:
		return false

	var content := layout.instantiate()
	if not content is Node3D:
		if content != null:
			content.free()
		return false

	var room_viewport := SubViewport.new()
	room_viewport.name = "Room_%s" % String(place_id)
	# Assign a World3D explicitly; own_world_3d alone may leave world_3d null.
	room_viewport.world_3d = World3D.new()
	room_viewport.size = Vector2i(2, 2)
	room_viewport.render_target_update_mode = SubViewport.UPDATE_DISABLED
	add_child(room_viewport)
	room_viewport.add_child(content)

	if not _register_place(place_id, building_id, content, room_viewport, true):
		room_viewport.queue_free()
		return false
	return true


# Rooms must be unoccupied, unviewed and free of pending transfers before removal.
func remove_room(place_id: StringName) -> bool:
	var room := get_place(place_id)
	if room == null or not room.owned_viewport or _viewed_place == place_id:
		return false
	if not _transfers_pending.is_empty() or room.actors_root.get_child_count() != 0:
		return false
	for occupied_place_id in _body_places.values():
		if occupied_place_id == place_id:
			return false
	var links: Dictionary = _links.get(place_id, {})
	for portal_id in links:
		var link: Dictionary = links[portal_id]
		var other_links: Dictionary = _links.get(link["to_place"], {})
		other_links.erase(link["to_portal"])
	_links.erase(place_id)
	_places.erase(place_id)
	var owned_viewport := room.viewport as SubViewport
	owned_viewport.queue_free()
	place_removed.emit(place_id)
	return true


func _register_place(
	place_id: StringName, building_id: StringName,
	root: Node3D, viewport: Viewport, owns_viewport: bool
) -> bool:
	var portals: Dictionary = {}
	if not _find_portals(root, portals):
		return false

	var actor_container := Node3D.new()
	actor_container.name = "PlaceActors"
	root.add_child(actor_container)

	var place := PlaceInstance.new(
		place_id, building_id, root, actor_container, viewport, owns_viewport
	)
	place.portals = portals
	_places[place_id] = place
	_links[place_id] = {}
	place_registered.emit(place_id)
	return true


func _find_portals(node: Node, result: Dictionary) -> bool:
	if node is PlacePortal3D:
		var portal := node as PlacePortal3D
		if portal.portal_id == &"" or result.has(portal.portal_id):
			push_error("Place portals need nonempty, unique IDs per layout.")
			return false
		result[portal.portal_id] = portal

	for child in node.get_children():
		if not _find_portals(child, result):
			return false
	return true


func get_place(place_id: StringName) -> PlaceInstance:
	return _places.get(place_id) as PlaceInstance


func get_viewed_place() -> StringName:
	return _viewed_place


func get_body_place(body: Node3D) -> StringName:
	var place_id: StringName = _body_places.get(body, &"")
	return place_id


# Register physical bodies here; their persistent actors stay outside the place.
func register_physical_body(body: Node3D, place_id: StringName) -> bool:
	var place := get_place(place_id)
	if not is_instance_valid(body) or place == null or _body_places.has(body):
		return false
	if (
		not body.is_inside_tree() or body.get_viewport() != place.viewport
		or not place.root.is_ancestor_of(body)
	):
		return false

	var navigation_map := place.get_navigation_map()
	if not navigation_map.is_valid():
		push_error("Place '%s' has no valid NavigationServer3D map." % String(place_id))
		return false

	_body_places[body] = place_id
	# Agents crossing World3Ds must have their navigation map reassigned.
	_assign_navigation_map(body, navigation_map)
	return true


func _assign_navigation_map(body: Node3D, navigation_map: RID) -> void:
	for child in body.get_children():
		if child is NavigationAgent3D:
			var agent := child as NavigationAgent3D
			agent.set_navigation_map(navigation_map)
			if agent.avoidance_enabled:
				agent.set_velocity_forced(Vector3.ZERO)


func _stop_body_movement(body: Node3D) -> void:
	for child in body.get_children():
		if child is NavigationAgent3D and child.has_method("stop"):
			child.call("stop")


func get_actor_for_body(body: Node3D) -> Node:
	return _actor_by_body.get(body) as Node


func get_actor_by_id(actor_id: StringName) -> Node:
	return _actors_by_id.get(actor_id) as Node


func _associate_actor(body: Node3D, actor: Node, actor_id: StringName) -> bool:
	if (
		actor_id == &"" or not _body_places.has(body)
		or _actor_by_body.has(body) or _actors_by_id.has(actor_id)
	):
		return false
	_actor_by_body[body] = actor
	_actors_by_id[actor_id] = actor
	_body_actor_ids[body] = actor_id
	return true


func unregister_physical_body(body: Node3D) -> void:
	if _body_actor_ids.has(body):
		var actor_id: StringName = _body_actor_ids[body]
		_body_actor_ids.erase(body)
		_actors_by_id.erase(actor_id)
	_actor_by_body.erase(body)
	_body_places.erase(body)
	_transfers_pending.erase(body)


# Deferred portal transfers can be canceled before execution.
func cancel_pending_portal_transfer(body: Node3D) -> bool:
	return _transfers_pending.erase(body)


# Access predicates receive a body and return bool; an empty predicate permits access.
func connect_portals(
	a_place: StringName, a_portal: StringName,
	b_place: StringName, b_portal: StringName,
	allowed: Callable = Callable(), enabled: bool = true
) -> bool:
	if a_place == b_place:
		return false
	var a := get_place(a_place)
	var b := get_place(b_place)
	if a == null or b == null:
		return false
	if a.get_portal(a_portal) == null or b.get_portal(b_portal) == null:
		return false

	var a_links: Dictionary = _links[a_place]
	var b_links: Dictionary = _links[b_place]
	if a_links.has(a_portal) or b_links.has(b_portal):
		return false

	a_links[a_portal] = {
		"to_place": b_place, "to_portal": b_portal,
		"allowed": allowed, "enabled": enabled
	}
	b_links[b_portal] = {
		"to_place": a_place, "to_portal": a_portal,
		"allowed": allowed, "enabled": enabled
	}
	return true


func set_portal_enabled(place_id: StringName, portal_id: StringName, enabled: bool) -> bool:
	var links: Dictionary = _links.get(place_id, {})
	if not links.has(portal_id):
		return false

	var link: Dictionary = links[portal_id]
	var other_links: Dictionary = _links[link["to_place"]]
	var reverse: Dictionary = other_links[link["to_portal"]]
	link["enabled"] = enabled
	reverse["enabled"] = enabled
	return true


func _can_traverse(body: Node3D, link: Dictionary) -> bool:
	if not link["enabled"]:
		return false
	var allowed: Callable = link["allowed"]
	return not allowed.is_valid() or bool(allowed.call(body))


# Returns a sequence of portal hops across the connected places.
func find_portal_route(
	from_place: StringName, to_place: StringName, body: Node3D
) -> Array[Dictionary]:
	var empty: Array[Dictionary] = []
	if not _places.has(from_place) or not _places.has(to_place):
		return empty
	if from_place == to_place:
		return empty

	var queue: Array[StringName] = [from_place]
	var visited: Dictionary = {}
	visited[from_place] = true
	var previous: Dictionary = {}

	while not queue.is_empty():
		var place_id: StringName = queue.pop_front()
		var links: Dictionary = _links[place_id]
		for portal_id in links:
			var link: Dictionary = links[portal_id]
			if not _can_traverse(body, link):
				continue
			var next_id: StringName = link["to_place"]
			if visited.has(next_id):
				continue

			visited[next_id] = true
			previous[next_id] = {
				"from": place_id, "via": portal_id,
				"to": next_id, "arrive_at": link["to_portal"]
			}
			if next_id == to_place:
				var route: Array[Dictionary] = []
				var cursor := to_place
				while cursor != from_place:
					var step: Dictionary = previous[cursor]
					route.push_front(step)
					cursor = step["from"]
				return route
			queue.append(next_id)
	return empty


# Check access and distance now; defer world transfer beyond the physics callback.
func use_portal(body: Node3D, portal_id: StringName) -> bool:
	if not is_instance_valid(body) or _transfers_pending.has(body):
		return false
	var from_id := get_body_place(body)
	var origin := get_place(from_id)
	if origin == null:
		return false
	var source_portal := origin.get_portal(portal_id)
	var links: Dictionary = _links.get(from_id, {})
	if source_portal == null or not links.has(portal_id):
		portal_rejected.emit(body, from_id, portal_id)
		return false

	var link: Dictionary = links[portal_id]
	if (
		not _can_traverse(body, link)
		or body.global_position.distance_to(source_portal.global_position)
		> source_portal.interaction_radius
	):
		portal_rejected.emit(body, from_id, portal_id)
		return false

	_transfers_pending[body] = true
	call_deferred("_commit_portal_transfer", body, from_id, portal_id)
	return true


func _commit_portal_transfer(
	body: Node3D, from_place: StringName, portal_id: StringName
) -> void:
	# The pending transfer may have been canceled or unbound.
	if not _transfers_pending.has(body):
		return
	_transfers_pending.erase(body)
	if not is_instance_valid(body) or get_body_place(body) != from_place:
		return

	var origin := get_place(from_place)
	var link: Dictionary = _links[from_place].get(portal_id, {})
	if origin == null or link.is_empty() or not _can_traverse(body, link):
		portal_rejected.emit(body, from_place, portal_id)
		return
	var source_portal := origin.get_portal(portal_id)
	if (
		source_portal == null
		or body.global_position.distance_to(source_portal.global_position)
		> source_portal.interaction_radius
	):
		portal_rejected.emit(body, from_place, portal_id)
		return

	var target_id: StringName = link["to_place"]
	var destination := get_place(target_id)
	var marker: PlacePortal3D = null
	if destination != null:
		marker = destination.get_portal(link["to_portal"])
	if marker == null:
		portal_rejected.emit(body, from_place, portal_id)
		return

	# Reparent only the physical body and update its navigation agents.
	_stop_body_movement(body)
	body.reparent(destination.actors_root, false)
	body.global_transform = marker.global_transform
	body.reset_physics_interpolation()

	var physical := body as CharacterBody3D
	if physical != null:
		physical.velocity = Vector3.ZERO
	_assign_navigation_map(body, destination.get_navigation_map())

	_body_places[body] = target_id
	portal_traversed.emit(body, from_place, target_id)


# View switches update rendering without pausing room processing.
func view_place(place_id: StringName) -> bool:
	if not _places.has(place_id):
		return false
	if _viewed_place == place_id:
		return true

	if _viewed_place != &"":
		var old := get_place(_viewed_place)
		if old != null and old.owned_viewport:
			(old.viewport as SubViewport).render_target_update_mode = SubViewport.UPDATE_DISABLED
			(old.viewport as SubViewport).size = Vector2i(2, 2)

	_viewed_place = place_id
	var place := get_place(place_id)
	if place.owned_viewport:
		(place.viewport as SubViewport).render_target_update_mode = SubViewport.UPDATE_ALWAYS
	place_view_changed.emit(place_id)
	return true


# Updating display resolution does not recreate a room.
func set_view_resolution(size: Vector2i) -> void:
	var place := get_place(_viewed_place)
	if place != null and place.owned_viewport:
		(place.viewport as SubViewport).size = Vector2i(maxi(size.x, 2), maxi(size.y, 2))
