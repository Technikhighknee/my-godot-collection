extends SceneTree

# Godot 4 smoke test. Deploy PlaceSystem, CharacterSystem and DynastySystem
# to a game project; copy this file into that project's res://tests and run:
# godot --headless --path <game-project> --script res://tests/character_dynasty_smoke.gd

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
		_fail("Exterior registration")
		quit(1)
		return

	var people := CharacterRegistry.new()
	stage.add_child(people)
	var houses := DynastyRegistry.new()
	stage.add_child(houses)
	_check(houses.configure(people), "Configure registry")

	var ids: Array[StringName] = [&"mother", &"father", &"child", &"guard"]
	var first_names := ["Anna", "Heinrich", "Lena", "Karl"]
	var last_names := ["Müller", "Müller", "Müller", "Wagner"]
	var actors: Dictionary = {}
	for i in ids.size():
		var id := ids[i]
		var actor := _bound_actor(stage, exterior, places, id)
		if actor == null:
			_fail("Actor binding: " + String(id))
			quit(1)
			return
		actors[id] = actor
		_check(
			people.register_character(Character.new(id, first_names[i], last_names[i]), actor),
			"Character registration: " + String(id)
		)

	_check(not Character.new(&"x", "", "Wagner").is_valid(), "First name mandatory")
	_check(not Character.new(&"x", "Karl", "  ").is_valid(), "Surname mandatory")
	_check(
		not people.register_character(
			Character.new(&"guard", "Other", "Name"), actors[&"guard"]
		), "Duplicate person rejected"
	)
	var unbound := PlaceActor.new()
	unbound.actor_id = &"unbound"
	stage.add_child(unbound)
	_check(
		not people.register_character(
			Character.new(&"unbound", "Hans", "Fischer"), unbound
		), "Physical actor required"
	)

	_check(people.get_parents(&"guard").is_empty(), "No family automatically created")
	_check(people.get_character(&"guard").get_last_name() == "Wagner", "Unrelated surname")
	_check(people.get_character(&"guard").get_full_name() == "Karl Wagner", "Full name")
	_check(people.set_parents(&"child", [&"mother", &"father"]), "Parents assigned")
	_check(people.get_children(&"mother").has(&"child"), "Children derived")
	_check(not people.set_parents(&"mother", [&"child"]), "Cycle rejected")
	_check(not people.set_parents(&"child", [&"mother", &"mother"]), "Duplicate parent rejected")
	_check(people.marry(&"mother", &"father"), "Marriage")
	_check(people.get_spouse(&"father") == &"mother", "Marriage reciprocal")
	_check(people.get_character(&"mother").rename("Anna", "Schmidt"), "Rename")
	_check(people.get_parents(&"child").has(&"mother"), "Ancestry independent of surname")

	var regular := Dynasty.new(&"house_a", "House A", Dynasty.Kind.REGULAR, 100)
	var shadow := Dynasty.new(&"house_b", "House B", Dynasty.Kind.SHADOW, 20)
	_check(houses.register_dynasty(regular), "Regular dynasty")
	_check(houses.register_dynasty(shadow) and shadow.is_shadow(), "Shadow dynasty")
	_check(not houses.register_dynasty(shadow), "Duplicate dynasty rejected")
	_check(houses.assign_member(&"mother", &"house_a"), "First member")
	_check(houses.assign_member(&"father", &"house_a"), "Second member")
	_check(houses.assign_member(&"mother", &"house_b"), "Membership transfer")
	_check(
		houses.get_members(&"house_a") == [&"father"]
		and houses.get_members(&"house_b") == [&"mother"],
		"Membership transfer removes old association"
	)
	_check(houses.get_dynasty_for(&"guard") == null, "Familyless guard has no dynasty")
	_check(people.get_spouse(&"mother") == &"father", "Transfer preserves marriage")
	var member_snapshot := houses.get_members(&"house_b")
	member_snapshot.clear()
	_check(houses.get_members(&"house_b").size() == 1, "Member collection immutable by caller")

	_check(regular.deposit(40) and regular.get_treasury() == 140, "Deposit")
	_check(regular.spend(50) and regular.get_treasury() == 90, "Spend")
	_check(not regular.spend(91) and regular.get_treasury() == 90, "No overdraft")
	_check(not regular.deposit(-1), "No negative deposit")
	var capped := Dynasty.new(&"cap", "Cap", Dynasty.Kind.REGULAR, Dynasty.MAX_TREASURY)
	_check(not capped.deposit(1), "No overflow")

	var actor_mother := actors[&"mother"] as PlaceActor
	actor_mother.unbind_body()
	_check(people.get_actor(&"mother") == null, "Physical actor detached")
	_check(people.get_character(&"mother") != null, "Identity retained")
	_check(people.get_parents(&"child").has(&"mother"), "Ancestry retained")
	_check(houses.get_dynasty_id_for(&"mother") == &"house_b", "Membership retained")
	var restored := _bound_actor(stage, exterior, places, &"mother")
	if restored == null:
		_fail("Physical restoration failed")
	else:
		_check(people.attach_actor(&"mother", restored), "Reattach same character identity")
		_check(people.get_actor(&"mother") == restored, "Restored actor lookup")
		restored.unbind_body()
	_check(people.unregister_character(&"mother"), "Explicitly remove person")
	_check(people.get_spouse(&"father") == &"", "Spouse link cleaned")
	_check(not people.get_parents(&"child").has(&"mother"), "Parent link cleaned")
	_check(houses.get_dynasty_id_for(&"mother") == &"", "Membership cleaned")

	if _failures == 0:
		print("CHARACTER + DYNASTY SMOKE TEST PASSED")
	else:
		printerr("CHARACTER + DYNASTY SMOKE TEST FAILED: %d checks" % _failures)
	quit(0 if _failures == 0 else 1)


func _bound_actor(
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
	push_error("Character/Dynasty smoke test: " + message)
