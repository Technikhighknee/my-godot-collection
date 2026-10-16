extends Node

# A purpose-built integration sandbox. All room scenes are real PackedScenes,
# instantiated by PlaceManager3D in independent active World3Ds.
# This controller only arranges demo content and offers test controls.

const HALL = preload("res://scenes/hall.tscn")
const KITCHEN = preload("res://scenes/kitchen.tscn")
const ACTOR = preload("res://scenes/actor.tscn")
const BODY = preload("res://scenes/body.tscn")

@onready var places: PlaceManager3D = $PlaceManager
@onready var exterior: Node3D = $Exterior
@onready var game_actors: Node = $GameActors
@onready var ui: CanvasLayer = $UI

var _actors: Dictionary = {}
var _unlocked: Dictionary = {&"a": false, &"b": false}
var _view_label: Label
var _status_label: Label
var _selected: PlaceActor
var _last_event := "Ready"
var _refresh_elapsed := 0.0


func _ready() -> void:
	if not places.register_exterior(&"city", exterior):
		push_error("Demo: exterior place registration failed")
		return

	# One template, two actual instances of each interior room.
	for id in [&"a", &"b"]:
		if not places.create_room(
			StringName("%s_hall" % id), StringName("tavern_%s" % id), HALL
		):
			push_error("Demo: hall creation failed for " + String(id))
			return
		if not places.create_room(
			StringName("%s_kitchen" % id), StringName("tavern_%s" % id), KITCHEN
		):
			push_error("Demo: kitchen creation failed for " + String(id))
			return

		if not places.connect_portals(
			&"city", StringName("tavern_%s" % id),
			StringName("%s_hall" % id), &"outside"
		):
			push_error("Demo: outside portal connection failed for " + String(id))
			return
		if not places.connect_portals(
			StringName("%s_hall" % id), &"kitchen",
			StringName("%s_kitchen" % id), &"hall",
			Callable(), false
		):
			push_error("Demo: kitchen portal connection failed for " + String(id))
			return

	# These actors execute real gameplay measures regardless of visibility.
	_spawn(&"a_worker", &"a_hall", Vector3(-2, 0.05, 1.0))
	_spawn(&"b_worker", &"b_hall", Vector3(2, 0.05, 1.0))

	places.portal_traversed.connect(_on_portal_traversed)
	for place_id in [&"city", &"a_hall", &"a_kitchen", &"b_hall", &"b_kitchen"]:
		var place := places.get_place(place_id)
		var selection := place.root.get_node("Selection") as SelectionSystem
		selection.selection_changed.connect(
			_on_selection_changed.bind(place_id)
		)
		selection.location_requested.connect(
			_on_location_requested.bind(place_id)
		)

	_build_ui()
	places.view_place(&"city")


func _spawn(id: StringName, place_id: StringName, position: Vector3) -> void:
	var actor := PlaceActorSpawner.spawn(
		places, game_actors, ACTOR, BODY, id,
		PlaceLocation.new(place_id, position)
	)
	if actor == null:
		push_error("Demo: failed to spawn " + String(id))
		return
	_actors[id] = actor


func _build_ui() -> void:
	var panel := PanelContainer.new()
	panel.position = Vector2(16, 12)
	panel.custom_minimum_size = Vector2(1160, 0)
	ui.add_child(panel)

	var layout := VBoxContainer.new()
	panel.add_child(layout)

	_view_label = Label.new()
	layout.add_child(_view_label)

	var views := HBoxContainer.new()
	layout.add_child(views)
	for entry in [
		["Outside", &"city"], ["A: Hall", &"a_hall"],
		["A: Kitchen", &"a_kitchen"], ["B: Hall", &"b_hall"],
		["B: Kitchen", &"b_kitchen"]
	]:
		_button(views, entry[0], _view.bind(entry[1]))

	var controls := HBoxContainer.new()
	layout.add_child(controls)
	_button(controls, "Unlock A kitchen", _unlock.bind(&"a"))
	_button(controls, "Unlock B kitchen", _unlock.bind(&"b"))
	_button(controls, "A → kitchen", _travel.bind(&"a_worker", &"a_kitchen", Vector3(1, 0.05, 1)))
	_button(controls, "A → outside", _travel.bind(&"a_worker", &"city", Vector3(-12, 0.05, -3)))
	_button(controls, "B → kitchen", _travel.bind(&"b_worker", &"b_kitchen", Vector3(1, 0.05, 1)))
	_button(controls, "B → outside", _travel.bind(&"b_worker", &"city", Vector3(12, 0.05, -3)))

	_status_label = Label.new()
	layout.add_child(_status_label)
	_refresh_status()


func _button(parent: BoxContainer, title: String, callback: Callable) -> void:
	var button := Button.new()
	button.text = title
	button.pressed.connect(callback)
	parent.add_child(button)


func _view(place_id: StringName) -> void:
	places.view_place(place_id)
	_refresh_status()


func _unlock(building_id: StringName) -> void:
	if _unlocked[building_id]:
		return
	_unlocked[building_id] = true
	var room := StringName("%s_hall" % building_id)
	if not places.set_portal_enabled(room, &"kitchen", true):
		push_error("Demo: failed to unlock portal in " + String(room))
		return
	_last_event = "Unlocked kitchen for Tavern %s" % building_id
	_refresh_status()


func _travel(actor_id: StringName, place_id: StringName, position: Vector3) -> void:
	var actor := _actors.get(actor_id) as PlaceActor
	if actor == null:
		return
	var traveler := actor.get_node("PlaceTraveler") as PlaceTraveler
	var ok := traveler.travel_to(place_id, position)
	_last_event = "%s -> %s: %s" % [
		actor_id, place_id, "traveling" if ok else "not available"
	]
	_refresh_status()


func _on_portal_traversed(body: Node3D, from_place: StringName, to_place: StringName) -> void:
	var actor := places.get_actor_for_body(body) as PlaceActor
	_last_event = "%s: %s -> %s" % [
		actor.actor_id if actor != null else &"unknown", from_place, to_place
	]
	_refresh_status()


func _on_selection_changed(selection: Array[Node3D], place_id: StringName) -> void:
	if places.get_viewed_place() != place_id:
		return
	_selected = null
	if not selection.is_empty():
		_selected = places.get_actor_for_body(selection[0]) as PlaceActor
	_refresh_status()


func _on_location_requested(position: Vector3, place_id: StringName) -> void:
	if _selected == null or places.get_viewed_place() != place_id:
		return
	var traveler := _selected.get_node("PlaceTraveler") as PlaceTraveler
	traveler.travel_to(place_id, position)


func _process(delta: float) -> void:
	_refresh_elapsed += delta
	if _refresh_elapsed >= 0.25:
		_refresh_elapsed = 0.0
		_refresh_status()


func _refresh_status() -> void:
	if _status_label == null or _view_label == null:
		return
	var viewed := places.get_viewed_place()
	_view_label.text = "PLACE SYSTEM DEMO    Viewing: %s    |    Select a character and right-click to move" % viewed
	var lines := PackedStringArray()
	for id in [&"a_worker", &"b_worker"]:
		var actor := _actors.get(id) as PlaceActor
		if actor == null:
			continue
		var worker: Node = actor.get_node("Worker")
		var inventory := actor.get_node("Inventory") as Inventory
		var traveler := actor.get_node("PlaceTraveler") as PlaceTraveler
		lines.append("%s    place=%s    goods=%d    jobs=%d    traveling=%s" % [
			id, actor.get_place_id(), inventory.get_item_quantity(&"goods"),
			int(worker.get("completed_jobs")), traveler.is_traveling()
		])
	lines.append("Kitchen access: A=%s / B=%s    |    Selected=%s" % [
		_unlocked[&"a"], _unlocked[&"b"],
		_selected.actor_id if _selected != null else &"none"
	])
	lines.append("Last event: %s" % _last_event)
	_status_label.text = "\n".join(lines)
