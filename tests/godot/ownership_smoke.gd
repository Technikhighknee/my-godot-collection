extends SceneTree

# Focused Godot 4 smoke test. Deploy PlaceSystem, CharacterSystem,
# DynastySystem and OwnershipSystem to a Godot project. Copy this script
# into res://tests/, then run:
# godot --headless --path <game-project> --script res://tests/ownership_smoke.gd

var _failures := 0


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	var stage := Node.new()
	root.add_child(stage)
	var exterior := Node3D.new()
	stage.add_child(exterior)
	var places := PlaceManager3D.new()
	stage.add_child(places)
	if not places.register_exterior(&"city", exterior):
		_fail("Register exterior")
		quit(1)
		return

	var people := CharacterRegistry.new()
	stage.add_child(people)
	var dynasties := DynastyRegistry.new()
	stage.add_child(dynasties)
	var ownership := OwnershipRegistry.new()
	stage.add_child(ownership)
	_check(dynasties.configure(people), "Dynasty configuration")
	_check(ownership.configure(dynasties), "Ownership configuration")
	_check(not ownership.configure(dynasties), "Cannot configure twice")

	var ids: Array[StringName] = [&"anna", &"bernd", &"shady", &"guard"]
	for id in ids:
		var actor := _spawn_actor(stage, exterior, places, id)
		if actor == null:
			_fail("Could not bind actor " + String(id))
			quit(1)
			return
		var person := Character.new(id, String(id), "Surname")
		_check(people.register_character(person, actor), "Character " + String(id))

	var a := Dynasty.new(&"a", "House A")
	var b := Dynasty.new(&"b", "House B", Dynasty.Kind.SHADOW)
	_check(dynasties.register_dynasty(a), "Register regular dynasty")
	_check(dynasties.register_dynasty(b), "Register shadow dynasty")
	_check(dynasties.assign_member(&"anna", &"a"), "Join A")
	_check(dynasties.assign_member(&"bernd", &"a"), "Join A (2)")
	_check(dynasties.assign_member(&"shady", &"b"), "Join B")

	_check(
		ownership.get_owner_type(&"unknown") == OwnershipRegistry.OwnerType.NONE,
		"Unknown buildings have no owner"
	)
	_check(
		not ownership.set_building_owner(&"", OwnershipRegistry.OwnerType.CITY, &"luebeck"),
		"Empty building ID rejected"
	)
	_check(
		not ownership.set_building_owner(&"hall", OwnershipRegistry.OwnerType.CITY, &""),
		"Empty city ID rejected"
	)
	_check(
		not ownership.set_building_owner(&"hall", OwnershipRegistry.OwnerType.CITY, &"luebeck", &"guard"),
		"City cannot have dynasty character assignee"
	)
	_check(
		ownership.set_building_owner(&"hall", OwnershipRegistry.OwnerType.CITY, &"luebeck"),
		"City ownership"
	)
	_check(
		ownership.get_owner_type(&"hall") == OwnershipRegistry.OwnerType.CITY
		and ownership.get_owner_id(&"hall") == &"luebeck"
		and ownership.get_assigned_character_id(&"hall") == &"",
		"City ownership queried"
	)

	_check(
		not ownership.set_building_owner(&"tavern", OwnershipRegistry.OwnerType.DYNASTY, &"unknown", &"anna"),
		"Unknown dynasty rejected"
	)
	_check(
		not ownership.set_building_owner(&"tavern", OwnershipRegistry.OwnerType.DYNASTY, &"a", &""),
		"Dynasty must nominate member"
	)
	_check(
		not ownership.set_building_owner(&"tavern", OwnershipRegistry.OwnerType.DYNASTY, &"a", &"guard"),
		"Dynasty-free citizen cannot be assignee"
	)
	_check(
		not ownership.set_building_owner(&"tavern", OwnershipRegistry.OwnerType.DYNASTY, &"a", &"shady"),
		"Other dynasty member cannot be assignee"
	)
	_check(
		ownership.set_building_owner(&"tavern", OwnershipRegistry.OwnerType.DYNASTY, &"a", &"anna"),
		"Assign valid dynasty ownership"
	)
	_check(
		ownership.get_owner_type(&"tavern") == OwnershipRegistry.OwnerType.DYNASTY
		and ownership.get_owner_id(&"tavern") == &"a"
		and ownership.get_assigned_character_id(&"tavern") == &"anna",
		"Separate dynasty ownership and displayed assignee"
	)
	_check(
		not ownership.assign_character(&"tavern", &"shady")
		and ownership.get_assigned_character_id(&"tavern") == &"anna",
		"Invalid assignment is atomic"
	)
	_check(
		not ownership.assign_character(&"hall", &"anna"),
		"City building cannot be assigned to dynasty character"
	)
	_check(
		ownership.get_owned_buildings(OwnershipRegistry.OwnerType.DYNASTY, &"a").has(&"tavern")
		and ownership.get_owned_buildings(OwnershipRegistry.OwnerType.CITY, &"luebeck").has(&"hall"),
		"Owner property lookup"
	)
	var snapshot := ownership.get_owned_buildings(OwnershipRegistry.OwnerType.DYNASTY, &"a")
	snapshot.clear()
	_check(
		ownership.get_owned_buildings(OwnershipRegistry.OwnerType.DYNASTY, &"a").size() == 1,
		"Property lookup is a snapshot"
	)

	_check(dynasties.assign_member(&"anna", &"b"), "Move assignee to shadow dynasty")
	_check(
		ownership.get_owner_id(&"tavern") == &"a"
		and ownership.get_assigned_character_id(&"tavern") == &"",
		"Assignee move clears only assignment"
	)
	_check(
		ownership.assign_character(&"tavern", &"bernd"),
		"Reassign remaining dynasty member"
	)
	_check(people.unregister_character(&"bernd"), "Remove assignee")
	_check(
		ownership.get_owner_id(&"tavern") == &"a"
		and ownership.get_assigned_character_id(&"tavern") == &"",
		"Character removal clears assignment, not property"
	)

	_check(
		ownership.set_building_owner(&"tavern", OwnershipRegistry.OwnerType.DYNASTY, &"b", &"shady"),
		"Transfer building to shadow dynasty"
	)
	_check(
		ownership.get_owner_id(&"tavern") == &"b"
		and ownership.get_assigned_character_id(&"tavern") == &"shady"
		and ownership.get_owned_buildings(OwnershipRegistry.OwnerType.DYNASTY, &"a").is_empty(),
		"Transfer updates ownership and assignee"
	)
	_check(
		ownership.set_building_owner(&"tavern", OwnershipRegistry.OwnerType.CITY, &"luebeck"),
		"Transfer to city"
	)
	_check(
		ownership.get_assigned_character_id(&"tavern") == &"",
		"Transfer to city removes character assignment"
	)
	_check(
		not ownership.set_building_owner(&"tavern", OwnershipRegistry.OwnerType.NONE, &"luebeck"),
		"NONE cannot have an owner ID"
	)
	_check(
		ownership.set_building_owner(&"tavern", OwnershipRegistry.OwnerType.NONE),
		"Set unowned"
	)
	_check(
		ownership.get_owner_type(&"tavern") == OwnershipRegistry.OwnerType.NONE
		and ownership.get_owner_id(&"tavern") == &""
		and ownership.get_assigned_character_id(&"tavern") == &"",
		"Unowned property has no owner nor assignment"
	)

	if _failures == 0:
		print("OWNERSHIP SMOKE TEST PASSED")
	else:
		printerr("OWNERSHIP SMOKE TEST FAILED: %d checks" % _failures)
	quit(0 if _failures == 0 else 1)


func _spawn_actor(
	stage: Node, exterior: Node3D, places: PlaceManager3D, id: StringName
) -> PlaceActor:
	var body := CharacterBody3D.new()
	exterior.add_child(body)
	var actor := PlaceActor.new()
	actor.actor_id = id
	stage.add_child(actor)
	if not actor.bind_body(places, body, &"city"):
		actor.free()
		body.free()
		return null
	return actor


func _check(ok: bool, message: String) -> void:
	if not ok:
		_fail(message)


func _fail(message: String) -> void:
	_failures += 1
	push_error("Ownership test: " + message)
