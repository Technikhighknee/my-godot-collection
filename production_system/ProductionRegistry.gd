class_name ProductionRegistry
extends Node

# Stateful, deterministic production jobs. The game resolves recipes and work rates.
# All pending goods are kept inside persistent production cycles.
# No building/character dependencies and no hidden per-frame simulation.

signal station_registered(station_id: StringName)
signal station_removed(station_id: StringName)
signal station_changed(station_id: StringName)
signal cycle_started(station_id: StringName, order_id: StringName)
signal cycle_completed(station_id: StringName, order_id: StringName)
signal state_restored()

const SNAPSHOT_VERSION := 2
const INPUT := &"input"
const WORK := &"work"
const OUTPUT := &"output"

var _stations: Dictionary = {}
var _inventories: Dictionary = {} # Stable game-owned ID -> Inventory
var _order_ids: Dictionary = {} # Order ID -> Station ID

# Game-provided resolver(recipe_id, station_id) -> Dictionary:
# {"inputs": {StringName: positive int}, "outputs": {...}, "work": positive int}
# Called only when starting a new cycle. No script objects in saves.
var recipe_resolver: Callable


func bind_inventory(inventory_id: StringName, inventory: Inventory) -> bool:
	if not _valid_id(inventory_id) or not is_instance_valid(inventory) or not inventory.is_configured():
		return false
	if _inventories.has(inventory_id) and _inventories[inventory_id] != inventory:
		return false
	_inventories[inventory_id] = inventory
	return true


func unbind_inventory(inventory_id: StringName) -> bool:
	# References remain stable during jobs. Only allow detaching unused inventories.
	for station in _stations.values():
		if inventory_id in station.input_inventory_ids or inventory_id in station.output_inventory_ids:
			return false
	return _inventories.erase(inventory_id)


func register_station(
	station_id: StringName, input_ids: Array[StringName],
	output_ids: Array[StringName]
) -> bool:
	if (
		not _valid_id(station_id) or _stations.has(station_id)
		or not _valid_inventory_ids(input_ids) or not _valid_inventory_ids(output_ids)
	):
		return false
	_stations[station_id] = ProductionStation.new(station_id, input_ids, output_ids)
	station_registered.emit(station_id)
	return true


# Return detached copies. No direct external mutations of the live queue/cycle.
func get_station(station_id: StringName) -> ProductionStation:
	var station := _get_station(station_id)
	return station.copy() if station != null else null


func _get_station(station_id: StringName) -> ProductionStation:
	return _stations.get(station_id) as ProductionStation


func _valid_inventory_ids(ids: Array[StringName]) -> bool:
	if ids.is_empty():
		return false
	var seen: Dictionary = {}
	for inventory_id in ids:
		if (
			not _valid_id(inventory_id) or seen.has(inventory_id)
			or not _inventories.has(inventory_id)
			or not is_instance_valid(_inventories[inventory_id])
			or not _inventories[inventory_id].is_configured()
		):
			return false
		seen[inventory_id] = true
	return true


func _plan_materials(ids: Array[StringName], items: Dictionary, adding: bool) -> Dictionary:
	if not _valid_inventory_ids(ids):
		return {"ok": false}
	var inventories: Array[Inventory] = []
	for inventory_id in ids:
		inventories.append(_inventories[inventory_id])
	return InventoryBatch.plan_distribution(inventories, items, adding)


func get_stations() -> Array[ProductionStation]:
	var result: Array[ProductionStation] = []
	for station in _stations.values():
		result.append(station.copy())
	return result


func unregister_station(station_id: StringName) -> bool:
	var station := _get_station(station_id)
	if station == null or not station.cycle.is_empty() or not station.queue.is_empty():
		return false
	_stations.erase(station_id)
	station_removed.emit(station_id)
	return true


# One order can produce once, a fixed count, or indefinitely (-1).
# Order IDs are unique across the registry.
func enqueue_order(
	station_id: StringName, order_id: StringName,
	recipe_id: StringName, cycles: int = 1
) -> bool:
	var station := _get_station(station_id)
	if (
		station == null or not _valid_id(order_id) or not _valid_id(recipe_id)
		or _order_ids.has(order_id) or (cycles <= 0 and cycles != -1)
	):
		return false
	station.queue.append({"id": order_id, "recipe_id": recipe_id, "remaining": cycles})
	_order_ids[order_id] = station_id
	station_changed.emit(station_id)
	return true


func set_paused(station_id: StringName, paused: bool) -> bool:
	var station := _get_station(station_id)
	if station == null:
		return false
	if station.paused == paused:
		return true
	station.paused = paused
	station_changed.emit(station_id)
	return true


func move_queued_order(station_id: StringName, order_id: StringName, index: int) -> bool:
	var station := _get_station(station_id)
	if station == null or index < 0 or index >= station.queue.size():
		return false
	for i in station.queue.size():
		var order: Dictionary = station.queue[i]
		if order["id"] == order_id:
			if not station.cycle.is_empty() and station.cycle["order_id"] == order_id:
				return false
			station.queue.remove_at(i)
			station.queue.insert(index, order)
			station_changed.emit(station_id)
			return true
	return false


# Only queued, not currently active, orders can be removed this way.
func remove_queued_order(station_id: StringName, order_id: StringName) -> bool:
	var station := _get_station(station_id)
	if station == null or (
		not station.cycle.is_empty() and station.cycle["order_id"] == order_id
	):
		return false
	for i in station.queue.size():
		if station.queue[i]["id"] == order_id:
			station.queue.remove_at(i)
			_order_ids.erase(order_id)
			station_changed.emit(station_id)
			return true
	return false


func _valid_items(items: Variant) -> bool:
	if not items is Dictionary:
		return false
	for key in items:
		var quantity: Variant = items[key]
		if not key is StringName or not _valid_id(key) or typeof(quantity) != TYPE_INT or quantity <= 0:
			return false
	return true


func _resolve_cycle(station: ProductionStation, order: Dictionary) -> Dictionary:
	if not recipe_resolver.is_valid():
		return {}
	var spec: Variant = recipe_resolver.call(order["recipe_id"], station.id)
	if not spec is Dictionary or not spec.has("inputs") or not spec.has("outputs") or not spec.has("work"):
		return {}
	if not _valid_items(spec["inputs"]) or not _valid_items(spec["outputs"]):
		return {}
	if typeof(spec["work"]) != TYPE_INT or spec["work"] <= 0:
		return {}
	return {
		"order_id": order["id"], "recipe_id": order["recipe_id"],
		"inputs": spec["inputs"].duplicate(true), "outputs": spec["outputs"].duplicate(true),
		"work_required": spec["work"], "work_done": 0,
		"phase": INPUT, "reserved": {}, "pending": {}
	}


# Starts the next job, or tries the next blocked resource transition.
# This method never silently advances simulated work.
func advance(station_id: StringName) -> bool:
	var station := _get_station(station_id)
	if station == null or station.paused:
		return false
	if station.cycle.is_empty():
		if station.queue.is_empty():
			return false
		var order: Dictionary = station.queue.front()
		var resolved := _resolve_cycle(station, order)
		if resolved.is_empty():
			return false
		station.cycle = resolved
		cycle_started.emit(station_id, order["id"])
	var cycle := station.cycle
	if cycle["phase"] == INPUT:
		var planned := _plan_materials(station.input_inventory_ids, cycle["inputs"], false)
		if not planned.get("ok", false):
			return false
		var changes: Array[Dictionary] = planned["changes"]
		if not changes.is_empty() and not InventoryBatch.apply(changes):
			return false
		cycle["reserved"] = cycle["inputs"].duplicate(true)
		cycle["phase"] = WORK
		station_changed.emit(station_id)
		return true
	if cycle["phase"] == OUTPUT:
		return _finish_output(station, false)
	return false


# Accepts up to the remaining work, returns the accepted number of work units.
func contribute_work(station_id: StringName, units: int) -> int:
	var station := _get_station(station_id)
	if station == null or station.paused or units <= 0 or station.cycle.is_empty():
		return 0
	var cycle := station.cycle
	if cycle["phase"] != WORK:
		return 0
	var applied: int = mini(units, cycle["work_required"] - cycle["work_done"])
	cycle["work_done"] += applied
	if cycle["work_done"] == cycle["work_required"]:
		cycle["reserved"] = {}
		cycle["pending"] = cycle["outputs"].duplicate(true)
		cycle["phase"] = OUTPUT
	station_changed.emit(station_id)
	return applied


# Cancellation keeps any in-flight materials in a persistent settlement cycle.
# Input reservation can be refunded, finished outputs can be delivered.
# No implicit destruction of goods.
# Cancellation is safe even for paused stations. If an input refund or output
# delivery cannot fit, return false and retain all materials and progress.
func cancel_active_order(station_id: StringName) -> bool:
	var station := _get_station(station_id)
	if station == null or station.cycle.is_empty():
		return false
	var cycle := station.cycle
	if cycle["phase"] == WORK:
		var planned := _plan_materials(station.input_inventory_ids, cycle["reserved"], true)
		if not planned.get("ok", false):
			return false
		var changes: Array[Dictionary] = planned["changes"]
		if not changes.is_empty() and not InventoryBatch.apply(changes):
			return false
	elif cycle["phase"] == OUTPUT:
		return _finish_output(station, true)
	var order_id: StringName = cycle["order_id"]
	station.cycle = {}
	station.queue.pop_front()
	_order_ids.erase(order_id)
	station_changed.emit(station_id)
	return true


func _finish_output(station: ProductionStation, cancel_repetitions: bool) -> bool:
	var cycle := station.cycle
	if cycle.is_empty() or cycle["phase"] != OUTPUT:
		return false
	var planned := _plan_materials(station.output_inventory_ids, cycle["pending"], true)
	if not planned.get("ok", false):
		return false
	var changes: Array[Dictionary] = planned["changes"]
	if not changes.is_empty() and not InventoryBatch.apply(changes):
		return false
	var order_id: StringName = cycle["order_id"]
	station.cycle = {}
	var order: Dictionary = station.queue.front()
	if order["remaining"] > 0:
		order["remaining"] -= 1
	if order["remaining"] == 0 or cancel_repetitions:
		station.queue.pop_front()
		_order_ids.erase(order_id)
	cycle_completed.emit(station.id, order_id)
	station_changed.emit(station.id)
	return true


func export_state() -> Dictionary:
	var ids: Array[String] = []
	for station_id in _stations:
		ids.append(String(station_id))
	ids.sort()
	var entries: Array[Dictionary] = []
	for id in ids:
		entries.append(_get_station(StringName(id)).to_snapshot())
	return {"version": SNAPSHOT_VERSION, "stations": entries}


func restore_state(snapshot: Dictionary) -> bool:
	if snapshot.get("version") != SNAPSHOT_VERSION or not snapshot.get("stations") is Array:
		return false
	var restored: Dictionary = {}
	var order_ids: Dictionary = {}
	for value in snapshot["stations"]:
		if not value is Dictionary:
			return false
		for key in ["id", "paused", "queue", "cycle", "input_inventory_ids", "output_inventory_ids"]:
			if not value.has(key):
				return false
		if (
			not value["id"] is StringName or not _valid_id(value["id"])
			or not value["paused"] is bool or not value["queue"] is Array
			or not value["cycle"] is Dictionary
			or not value["input_inventory_ids"] is Array
			or not value["output_inventory_ids"] is Array
			or restored.has(value["id"])
		):
			return false
		var input_ids: Array[StringName] = []
		var output_ids: Array[StringName] = []
		for inventory_id in value["input_inventory_ids"]:
			if not inventory_id is StringName:
				return false
			input_ids.append(inventory_id)
		for inventory_id in value["output_inventory_ids"]:
			if not inventory_id is StringName:
				return false
			output_ids.append(inventory_id)
		if not _valid_inventory_ids(input_ids) or not _valid_inventory_ids(output_ids):
			return false
		var station := ProductionStation.new(value["id"], input_ids, output_ids)
		station.paused = value["paused"]
		station.queue = value["queue"].duplicate(true)
		station.cycle = value["cycle"].duplicate(true)
		for order in station.queue:
			if not order is Dictionary or not order.has("id") or not order.has("recipe_id") or not order.has("remaining"):
				return false
			if (
				not order["id"] is StringName or not _valid_id(order["id"])
				or not order["recipe_id"] is StringName or not _valid_id(order["recipe_id"])
				or typeof(order["remaining"]) != TYPE_INT
				or (order["remaining"] <= 0 and order["remaining"] != -1)
				or order_ids.has(order["id"])
			):
				return false
			order_ids[order["id"]] = station.id
		if not station.cycle.is_empty() and not _valid_cycle(station):
			return false
		restored[station.id] = station
	_stations = restored
	_order_ids = order_ids
	state_restored.emit()
	return true


func _valid_cycle(station: ProductionStation) -> bool:
	var cycle := station.cycle
	for key in ["order_id", "recipe_id", "inputs", "outputs", "work_required", "work_done", "phase", "reserved", "pending"]:
		if not cycle.has(key):
			return false
	if (
		station.queue.is_empty() or station.queue.front()["id"] != cycle["order_id"]
		or not cycle["recipe_id"] is StringName
		or not _valid_id(cycle["recipe_id"])
		or station.queue.front()["recipe_id"] != cycle["recipe_id"]
		or not _valid_items(cycle["inputs"]) or not _valid_items(cycle["outputs"])
		or not _valid_items(cycle["reserved"]) or not _valid_items(cycle["pending"])
		or typeof(cycle["work_required"]) != TYPE_INT or cycle["work_required"] <= 0
		or typeof(cycle["work_done"]) != TYPE_INT or cycle["work_done"] < 0
		or cycle["work_done"] > cycle["work_required"]
		or not cycle["phase"] is StringName
		or not cycle["phase"] in [INPUT, WORK, OUTPUT]
	):
		return false
	if cycle["phase"] == INPUT:
		return cycle["work_done"] == 0 and cycle["reserved"].is_empty() and cycle["pending"].is_empty()
	if cycle["phase"] == WORK:
		return cycle["work_done"] < cycle["work_required"] and cycle["reserved"] == cycle["inputs"] and cycle["pending"].is_empty()
	return cycle["work_done"] == cycle["work_required"] and cycle["reserved"].is_empty() and cycle["pending"] == cycle["outputs"]


static func _valid_id(id: StringName) -> bool:
	return not String(id).strip_edges().is_empty()
