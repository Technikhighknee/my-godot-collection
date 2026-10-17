extends SceneTree

# Executed by tests/run_godot.py in a temporary standalone Godot project.
# No 1400 project, content, scenes, or smoke-test fixtures are required.

var failures := 0
var assertions := 0


func _initialize() -> void:
	call_deferred("_run")


func _check(condition: bool, message: String) -> void:
	assertions += 1
	if not condition:
		failures += 1
		push_error("FAILED: " + message)


func _run() -> void:
	_buildings()
	_inventory()
	_production()
	if failures == 0:
		print("GAMEPLAY SYSTEM TESTS PASSED (%d assertions)" % assertions)
	else:
		push_error("%d/%d gameplay assertions failed" % [failures, assertions])
	quit(0 if failures == 0 else 1)


func _buildings() -> void:
	var registry := BuildingRegistry.new()
	var original := Building.new(
		&"workshop_1", &"workshop", &"town", Transform3D.IDENTITY,
		{&"condition": 1.0}
	)
	_check(registry.register_building(original), "register building")
	_check(not registry.register_building(original), "duplicate building rejected")
	original._type_id = &"changed_outside"
	_check(registry.get_building(&"workshop_1").get_type_id() == &"workshop",
		"registration makes a defensive copy")
	var observed := registry.get_building(&"workshop_1")
	observed._type_id = &"unwanted"
	_check(registry.get_building(&"workshop_1").get_type_id() == &"workshop",
		"returned building is a snapshot")
	_check(registry.set_upgrade_level(&"workshop_1", &"larger_storage", 2),
		"install upgrade")
	_check(not registry.set_upgrade_level(&"workshop_1", &"larger_storage", -1),
		"negative upgrade level rejected")
	_check(registry.get_building(&"workshop_1").get_upgrade_level(&"larger_storage") == 2,
		"upgrade state retained")
	_check(registry.set_property_value(&"workshop_1", &"condition", 0.5),
		"update persistent property")
	_check(not registry.set_property_value(&"workshop_1", &"condition", "damaged"),
		"implicit property type change rejected")
	var snapshot := registry.export_state()
	var reloaded := BuildingRegistry.new()
	_check(reloaded.restore_state(snapshot), "restore building snapshot")
	_check(reloaded.get_building(&"workshop_1").get_upgrade_level(&"larger_storage") == 2,
		"restore upgrade")
	var malformed := snapshot.duplicate(true)
	malformed["buildings"].append(snapshot["buildings"][0].duplicate(true))
	_check(not reloaded.restore_state(malformed), "invalid building snapshot rejected")
	_check(reloaded.get_buildings().size() == 1, "invalid restore leaves registry intact")
	_check(registry.unregister_building(&"workshop_1"), "remove building")
	registry.free()
	reloaded.free()


func _inventory() -> void:
	var storage := Inventory.new()
	_check(storage.configure(2, 10), "configure storage")
	_check(storage.add(&"wood", 17), "add across slots")
	_check(storage.set_capacity(1, 5), "shrink storage without deleting goods")
	_check(storage.is_over_capacity(), "detect over-capacity")
	_check(storage.get_item_quantity(&"wood") == 17, "goods survive shrinking")
	_check(not storage.add(&"wood", 1), "no additions to overfilled storage")
	_check(storage.remove_from_slot(1, 7), "overflow slot can be emptied")
	_check(storage.remove_from_slot(0, 5), "overstack can be reduced")
	_check(not storage.is_over_capacity(), "under-capacity after removal")
	_check(storage.add(&"wood", 1), "can add goods after overflow is resolved")
	var snapshot := storage.export_state()
	var restored := Inventory.new()
	_check(restored.restore_state(snapshot), "inventory restores from snapshot")
	_check(restored.get_item_quantity(&"wood") == storage.get_item_quantity(&"wood"),
		"inventory round-trip quantity")
	var malformed := snapshot.duplicate(true)
	malformed["slots"][0]["quantity"] = -1
	_check(not restored.restore_state(malformed), "corrupt inventory rejected")
	_check(restored.get_item_quantity(&"wood") == storage.get_item_quantity(&"wood"),
		"failed inventory restore is atomic")
	var source_a := Inventory.new()
	var source_b := Inventory.new()
	_check(source_a.configure(1, 3), "configure first source")
	_check(source_b.configure(1, 4), "configure second source")
	_check(source_a.add(&"grain", 3), "fill source a")
	_check(source_b.add(&"grain", 4), "fill source b")
	var sources: Array[Inventory] = [source_a, source_b]
	var planned := InventoryBatch.plan_distribution(sources, {&"grain": 6}, false)
	_check(planned.get("ok", false), "split consumption across inventories")
	var changes: Array[Dictionary] = planned.get("changes", [])
	_check(InventoryBatch.apply(changes), "commit split consumption atomically")
	_check(source_a.get_item_quantity(&"grain") + source_b.get_item_quantity(&"grain") == 1,
		"exactly six units removed")
	var impossible := InventoryBatch.plan_distribution(sources, {&"grain": 2}, false)
	_check(not impossible.get("ok", false), "insufficient combined stock rejected")
	_check(source_a.get_item_quantity(&"grain") + source_b.get_item_quantity(&"grain") == 1,
		"unsuccessful planning consumes nothing")
	for item in [storage, restored, source_a, source_b]:
		item.free()


func _recipe(recipe_id: StringName, _station_id: StringName) -> Dictionary:
	if recipe_id != &"bread":
		return {}
	return {
		"inputs": {&"grain": 4},
		"outputs": {&"bread": 2},
		"work": 10
	}


func _production() -> void:
	var grain_a := Inventory.new()
	var grain_b := Inventory.new()
	var output := Inventory.new()
	grain_a.configure(1, 2)
	grain_b.configure(1, 4)
	output.configure(1, 2)
	grain_a.add(&"grain", 2)
	grain_b.add(&"grain", 4)
	var prod := ProductionRegistry.new()
	prod.recipe_resolver = _recipe
	_check(prod.bind_inventory(&"grain_a", grain_a), "bind source a")
	_check(prod.bind_inventory(&"grain_b", grain_b), "bind source b")
	_check(prod.bind_inventory(&"finished", output), "bind finished inventory")
	var inputs: Array[StringName] = [&"grain_a", &"grain_b"]
	var outputs: Array[StringName] = [&"finished"]
	_check(prod.register_station(&"oven", inputs, outputs), "register multi-storage station")
	_check(prod.enqueue_order(&"oven", &"order_a", &"bread", 2), "queue two cycles")
	_check(prod.advance(&"oven"), "reserve first cycle")
	_check(grain_a.get_item_quantity(&"grain") + grain_b.get_item_quantity(&"grain") == 2,
		"inputs reserved exactly once")
	var exposed := prod.get_station(&"oven")
	exposed.queue.clear()
	_check(prod.get_station(&"oven").queue.size() == 1, "station query returns a snapshot")
	_check(prod.contribute_work(&"oven", 5) == 5, "accept half the work")
	_check(prod.set_paused(&"oven", true), "pause station")
	_check(prod.contribute_work(&"oven", 5) == 0, "pause blocks work")
	_check(prod.set_paused(&"oven", false), "resume station")
	_check(prod.contribute_work(&"oven", 8) == 5, "cap excess work")
	_check(prod.get_station(&"oven").cycle["phase"] == &"output",
		"completed batch waits for delivery")
	var before_save := prod.export_state()
	var reloaded := ProductionRegistry.new()
	reloaded.recipe_resolver = _recipe
	reloaded.bind_inventory(&"grain_a", grain_a)
	reloaded.bind_inventory(&"grain_b", grain_b)
	reloaded.bind_inventory(&"finished", output)
	_check(reloaded.restore_state(before_save), "restore pending production")
	_check(reloaded.get_station(&"oven").cycle["pending"][&"bread"] == 2,
		"saved output buffer restored")
	var bad := before_save.duplicate(true)
	bad["stations"][0]["cycle"]["work_done"] = 100
	_check(not reloaded.restore_state(bad), "reject impossible work progress")
	_check(reloaded.get_station(&"oven").cycle["work_done"] == 10,
		"rejected production restore retains prior state")
	_check(reloaded.advance(&"oven"), "deliver completed batch")
	_check(output.get_item_quantity(&"bread") == 2, "goods delivered once")
	_check(reloaded.advance(&"oven") == false, "insufficient remaining input blocks next cycle")
	_check(reloaded.get_station(&"oven").cycle["phase"] == &"input", "blocked cycle persisted")
	_check(reloaded.cancel_active_order(&"oven"), "cancel unreserved cycle")
	_check(reloaded.unregister_station(&"oven"), "unregister settled station")
	prod.free()
	reloaded.free()
	grain_a.free()
	grain_b.free()
	output.free()
