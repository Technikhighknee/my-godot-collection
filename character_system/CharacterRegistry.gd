class_name CharacterRegistry
extends Node

# A registered Character is a persistent identity/relationship record.
# Every ACTIVE/living character must have a bound PlaceActor and physical body.
# Losing that actor detaches the physical link, not the historical identity.
# The game defines death, spawning and saving; this registry does not simulate
# people or create background-only NPCs.
# No surname-based family grouping and no automatically generated relatives.

signal character_registered(character: Character)
signal character_removed(character_id: StringName)
signal actor_attached(character_id: StringName)
signal actor_detached(character_id: StringName)
signal relationships_changed(character_id: StringName)

var _characters: Dictionary = {}  # StringName -> Character
var _actors: Dictionary = {}      # StringName -> PlaceActor
var _ids_by_actor: Dictionary = {} # PlaceActor -> StringName
var _parents: Dictionary = {}     # StringName -> Array[StringName]
var _spouses: Dictionary = {}     # StringName -> StringName


func register_character(character: Character, actor: PlaceActor) -> bool:
	if character == null or not character.is_valid():
		return false
	var id := character.get_id()
	if _characters.has(id) or not _can_attach(id, actor):
		return false
	_characters[id] = character
	_attach_actor(id, actor)
	character_registered.emit(character)
	return true


# Reattach the same identity to a newly spawned, fully bound physical actor.
# No character is synthesized merely because a body was spawned.
func attach_actor(id: StringName, actor: PlaceActor) -> bool:
	if not _characters.has(id) or _actors.has(id) or not _can_attach(id, actor):
		return false
	_attach_actor(id, actor)
	return true


func _can_attach(id: StringName, actor: PlaceActor) -> bool:
	if (
		not is_instance_valid(actor) or not actor.is_inside_tree()
		or not actor.is_bound() or actor.actor_id != id
		or _ids_by_actor.has(actor)
	):
		return false
	var body := actor.get_physical_body()
	return body != null and body.is_inside_tree()


func _attach_actor(id: StringName, actor: PlaceActor) -> void:
	_actors[id] = actor
	_ids_by_actor[actor] = id
	actor.body_unbound.connect(_on_actor_unavailable.bind(id))
	actor.tree_exiting.connect(_on_actor_unavailable.bind(id))
	actor_attached.emit(id)


func _detach_actor(id: StringName) -> void:
	var actor := _actors.get(id) as PlaceActor
	if actor == null:
		return
	_actors.erase(id)
	if is_instance_valid(actor):
		var callback := _on_actor_unavailable.bind(id)
		if actor.body_unbound.is_connected(callback):
			actor.body_unbound.disconnect(callback)
		if actor.tree_exiting.is_connected(callback):
			actor.tree_exiting.disconnect(callback)
		_ids_by_actor.erase(actor)
	actor_detached.emit(id)


func unregister_character(id: StringName) -> bool:
	if not _characters.has(id):
		return false
	_detach_actor(id)
	_characters.erase(id)

	# Maintain valid parent and spouse links after unregistering a person.
	_parents.erase(id)
	if _spouses.has(id):
		var spouse_id: StringName = _spouses[id]
		_spouses.erase(id)
		_spouses.erase(spouse_id)
		relationships_changed.emit(spouse_id)
	for other_id in _parents.keys():
		var parents: Array[StringName] = _parents[other_id]
		if parents.has(id):
			parents.erase(id)
			relationships_changed.emit(other_id)
	character_removed.emit(id)
	return true


func get_character(id: StringName) -> Character:
	return _characters.get(id) as Character


func get_actor(id: StringName) -> PlaceActor:
	return _actors.get(id) as PlaceActor


func get_character_for_actor(actor: PlaceActor) -> Character:
	return get_character(_ids_by_actor.get(actor, &""))


func get_characters() -> Array[Character]:
	var result: Array[Character] = []
	for character in _characters.values():
		result.append(character)
	return result


# Optional parent links (zero, one or two). Prevent duplicate parents,
# unknown persons, self-parenting and ancestral cycles.
func set_parents(id: StringName, parent_ids: Array[StringName]) -> bool:
	if not _characters.has(id) or parent_ids.size() > 2:
		return false
	for i in parent_ids.size():
		var parent_id := parent_ids[i]
		if parent_id == id or not _characters.has(parent_id):
			return false
		if parent_ids.find(parent_id) != i:
			return false
		if _has_ancestor(parent_id, id):
			return false
	_parents[id] = parent_ids.duplicate()
	relationships_changed.emit(id)
	return true


func get_parents(id: StringName) -> Array[StringName]:
	var result: Array[StringName] = []
	if _characters.has(id) and _parents.has(id):
		var parents: Array[StringName] = _parents[id]
		result = parents.duplicate()
	return result


func get_children(parent_id: StringName) -> Array[StringName]:
	var result: Array[StringName] = []
	if not _characters.has(parent_id):
		return result
	for child_id in _parents:
		var parents: Array[StringName] = _parents[child_id]
		if parents.has(parent_id):
			result.append(child_id)
	return result


# Spouses are symmetrical. No automatic name/dynasty transfer or children.
func marry(a: StringName, b: StringName) -> bool:
	if (
		a == b or not _characters.has(a) or not _characters.has(b)
		or _spouses.has(a) or _spouses.has(b)
	):
		return false
	_spouses[a] = b
	_spouses[b] = a
	relationships_changed.emit(a)
	relationships_changed.emit(b)
	return true


func divorce(id: StringName) -> bool:
	if not _spouses.has(id):
		return false
	var spouse_id: StringName = _spouses[id]
	_spouses.erase(id)
	_spouses.erase(spouse_id)
	relationships_changed.emit(id)
	relationships_changed.emit(spouse_id)
	return true


func get_spouse(id: StringName) -> StringName:
	var spouse_id: StringName = _spouses.get(id, &"")
	return spouse_id


func _has_ancestor(start_id: StringName, search_id: StringName) -> bool:
	var stack: Array[StringName] = [start_id]
	var visited: Dictionary = {}
	while not stack.is_empty():
		var current: StringName = stack.pop_back()
		if current == search_id:
			return true
		if visited.has(current):
			continue
		visited[current] = true
		if _parents.has(current):
			var ancestors: Array[StringName] = _parents[current]
			stack.append_array(ancestors)
	return false


func _on_actor_unavailable(id: StringName) -> void:
	_detach_actor(id)
