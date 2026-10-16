class_name PlaceManager3D
extends Node

# Each interior runs continuously in its own SubViewport/World3D.
# Only render-target updates are disabled while a room is not observed.
# The game owns persistent actors/actions/inventories outside these worlds;
# register_physical_body() accepts their spatial CharacterBody3D counterpart.

signal place_registered(place_id: StringName)
signal place_view_changed(place_id: StringName)
signal portal_traversed(body: Node3D, from_place: StringName, to_place: StringName)
signal portal_rejected(body: Node3D, place_id: StringName, portal_id: StringName)

var _places: Dictionary = {}       # StringName -> PlaceInstance
var _links: Dictionary = {}        # StringName -> { portal_id -> link }
var _body_places: Dictionary = {}  # Node3D -> StringName
var _transfers_pending: Dictionary = {}
var _viewed_place: StringName = &""


func register_exterior(place_id: StringName, root: Node3D) -> bool:
	if place_id == &"" or _places.has(place_id) or not is_instance_valid(root):
		return false
	if not root.is_inside_tree():
		return false
	return _register_place(place_id, &"", root, root.get_viewport(), false)


# Each call creates a separate live physics/navigation space, even when many
# rooms share the exact same PackedScene and assets.
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
	room_viewport.own_world_3d = true
	room_viewport.size = Vector2i(2, 2)
	room_viewport.render_target_update_mode = SubViewport.UPDATE_DISABLED
	add_child(room_viewport)
	room_viewport.add_child(content)

	if not _register_place(place_id, building_id, content, room_viewport, true):
		room_viewport.queue_free()
		return false
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


# A body is the physical counterpart of a persistent game actor.
# The actor's ActionController/Inventory MUST live outside this body subtree.
func register_physical_body(body: Node3D, place_id: StringName) -> bool:
	var place := get_place(place_id)
	if not is_instance_valid(body) or place == null or _body_places.has(body):
		return false
	if not body.is_inside_tree() or body.get_viewport() != place.viewport:
		return false

	_body_places[body] = place_id
	# Registering does not reparent or teleport existing bodies.
	return true


func unregister_physical_body(body: Node3D) -> void:
	_body_places.erase(body)
	_transfers_pending.erase(body)


# Directed access is game-configurable (e.g. cellar locked by an upgrade).
# The callable receives body: Node3D and returns bool. An empty callable
# grants access. A bidirectional pair shares the same access predicate.
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


# Switch both directions of a paired doorway together.
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


# Returns a short portal sequence, not a movement path. Individual movement
# segments are delegated to MovementAgent3D in each World3D.
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


# Call when the body has actually arrived at the doorway.
# It checks distance and access, then defers the actual world swap until
# outside the physics callback. Returns whether the request was accepted.
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

	# Only the spatial body is moved. Game-owned ActionController, Inventory,
	# AI, and cooldowns remain attached to the persistent actor elsewhere.
	body.reparent(destination.actors_root, false)
	body.global_transform = marker.global_transform
	body.reset_physics_interpolation()

	var physical := body as CharacterBody3D
	if physical != null:
		physical.velocity = Vector3.ZERO

	_body_places[body] = target_id
	portal_traversed.emit(body, from_place, target_id)


# Changing the view changes ONLY rendering. No simulation Node is paused,
# removed, made invisible, or prevented from processing.
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


# Called by a presentation control to match its resolution. This never
# recreates a room or interrupts its physics/navigation state.
func set_view_resolution(size: Vector2i) -> void:
	var place := get_place(_viewed_place)
	if place != null and place.owned_viewport:
		(place.viewport as SubViewport).size = Vector2i(maxi(size.x, 2), maxi(size.y, 2))
