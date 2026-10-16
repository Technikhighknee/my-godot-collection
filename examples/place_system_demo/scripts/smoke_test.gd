extends SceneTree

# Run after deploying the packages:
# godot --headless --path examples/place_system_demo --script res://scripts/smoke_test.gd

func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	var error := change_scene_to_file("res://scenes/main.tscn")
	if error != OK:
		_fail("Main scene could not be loaded")
		return
	await process_frame
	await process_frame

	var demo := current_scene
	if demo == null:
		_fail("Main scene missing")
		return
	var places := demo.get_node("PlaceManager") as PlaceManager3D
	var room_view := demo.get_node("UI/RoomView") as PlaceView
	if room_view.place_manager != places:
		_fail("RoomView did not resolve PlaceManager3D")
		return
	var hall_a := places.get_place(&"a_hall")
	var hall_b := places.get_place(&"b_hall")
	var kitchen_a := places.get_place(&"a_kitchen")
	var kitchen_b := places.get_place(&"b_kitchen")
	if hall_a == null or hall_b == null or kitchen_a == null or kitchen_b == null:
		_fail("All four interior instances must exist")
		return
	if hall_a.root == hall_b.root:
		_fail("Identical room template wrongly shares live scene nodes")
		return
	if not hall_a.get_navigation_map().is_valid() or not hall_b.get_navigation_map().is_valid():
		_fail("Room navigation maps must be valid")
		return
	if hall_a.get_navigation_map() == hall_b.get_navigation_map():
		_fail("Separate hall instances must have distinct navigation maps")
		return

	var a := places.get_actor_by_id(&"a_worker") as PlaceActor
	var b := places.get_actor_by_id(&"b_worker") as PlaceActor
	if a == null or b == null or a.get_physical_body() == b.get_physical_body():
		_fail("Persistent actors must have their own physical bodies")
		return
	var a_body := a.get_physical_body()
	var a_inventory := a.get_node("Inventory") as Inventory
	var b_inventory := b.get_node("Inventory") as Inventory
	var a_actions := a.get_node("ActionController") as ActionController
	if a_actions.get_action(&"brew") == null:
		_fail("Worker action was not registered")
		return

	if not places.find_portal_route(&"a_hall", &"a_kitchen", a_body).is_empty():
		_fail("Kitchen must be locked initially")
		return

	# Neither actor is in the viewed room: both must keep executing
	# the same ActionSystem + Inventory workload.
	places.view_place(&"city")
	await create_timer(4.0).timeout
	if a_inventory.get_item_quantity(&"goods") < 1:
		_fail("Hidden tavern A worker did not complete gameplay work")
		return
	if b_inventory.get_item_quantity(&"goods") < 1:
		_fail("Hidden tavern B worker did not complete gameplay work")
		return

	demo.call("_unlock", &"a")
	if places.find_portal_route(&"a_hall", &"a_kitchen", a_body).is_empty():
		_fail("Kitchen upgrade did not open its portal")
		return
	if not places.find_portal_route(&"b_hall", &"b_kitchen", b.get_physical_body()).is_empty():
		_fail("Kitchen B should remain locked")
		return

	var traveler := a.get_node("PlaceTraveler") as PlaceTraveler
	var a_before := a_inventory.get_item_quantity(&"goods")
	places.view_place(&"b_hall")
	if not traveler.travel_to(&"a_kitchen", Vector3(1, 0.05, 1)):
		_fail("Cross-room travel could not start")
		return
	var moved := await _await_place(a, traveler, &"a_kitchen", 18.0)
	if not moved:
		_fail("Worker failed to travel hall -> kitchen")
		return
	if a.get_physical_body() != a_body or places.get_actor_by_id(&"a_worker") != a:
		_fail("Portal crossing replaced the identity or physical body")
		return
	if a_inventory.get_item_quantity(&"goods") < a_before:
		_fail("Inventory was lost during a room transfer")
		return

	# Multi-hop route: kitchen -> hall -> exterior, while B is displayed.
	if not traveler.travel_to(&"city", Vector3(-12, 0.05, -3)):
		_fail("Multi-hop travel could not start")
		return
	var reached_city := await _await_place(a, traveler, &"city", 24.0)
	if not reached_city:
		_fail("Worker failed multi-hop route kitchen -> hall -> city")
		return
	if b_inventory.get_item_quantity(&"goods") <= 1:
		_fail("Worker B stopped while the camera looked at another place")
		return

	print("PLACE SYSTEM SMOKE TEST PASSED")
	quit(0)


func _await_place(
	actor: PlaceActor, traveler: PlaceTraveler, destination: StringName,
	max_seconds: float
) -> bool:
	var elapsed := 0.0
	while elapsed < max_seconds:
		await create_timer(0.2).timeout
		elapsed += 0.2
		if not traveler.is_traveling():
			return actor.get_place_id() == destination
	return false


func _fail(reason: String) -> void:
	push_error("PLACE SYSTEM SMOKE TEST FAILED: " + reason)
	quit(1)
