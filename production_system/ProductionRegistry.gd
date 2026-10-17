class_name ProductionRegistry
extends Node

# Stateful, deterministic production jobs. The game resolves recipes and work rates.
# All pending goods are kept inside persistent production cycles.
# No building/character dependencies and no hidden per-frame simulation.

signal station_registered(station_id: StringName)
signal station_removed(station_id: StringName)
signal station_changed(station_id: StringName)
signal station_paused_changed(station_id: StringName, paused: bool)
signal station_phase_changed(station_id: StringName, old_phase: StringName, new_phase: StringName)
signal station_blocked(station_id: StringName, reason: StringName)
signal station_unblocked(station_id: StringName, previous_reason: StringName)
signal order_queued(station_id: StringName, order_id: StringName)
signal queued_order_removed(station_id: StringName, order_id: StringName)
signal order_completed(station_id: StringName, order_id: StringName)
signal work_contributed(station_id: StringName, units: int)
signal station_inventories_changed(station_id: StringName)
signal order_canceled(station_id: StringName, order_id: StringName)
signal settlement_created(station_id: StringName, order_id: StringName, kind: StringName)
signal settlement_resolved(station_id: StringName, order_id: StringName, disposition: StringName)
signal cycle_started(station_id: StringName, order_id: StringName)
signal cycle_completed(station_id: StringName, order_id: StringName)
signal state_restored()

const SNAPSHOT_VERSION := 5
const IDLE := &"idle"
const BLOCK_INPUTS := &"inputs_unavailable"
const BLOCK_OUTPUTS := &"outputs_full"
const BLOCK_RECIPE := &"recipe_unavailable"
const REFUND := &"refund"
const DELIVERY := &"delivery"
const INPUT := &"input"
const WORK := &"work"
const OUTPUT := &"output"

var _stations: Dictionary = {}
var _inventories: Dictionary = {} # Stable game-owned ID -> Inventory
var _order_ids: Dictionary = {} # Order ID -> Station ID
var _busy_stations: Dictionary = {} # Reject synchronous reentrant writes during inventory signals.

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
		or _busy_stations.has(station_id)
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


func _phase(station: ProductionStation) -> StringName:
	return IDLE if station.cycle.is_empty() else station.cycle["phase"]


func _notify_phase(station: ProductionStation, old_phase: StringName) -> void:
	var current_phase := _phase(station)
	if old_phase != current_phase:
		station_phase_changed.emit(station.id, old_phase, current_phase)


func _set_block(station: ProductionStation, reason: StringName) -> bool:
	var previous := station.block_reason
	if previous == reason:
		return false
	station.block_reason = reason
	if previous != &"":
		station_unblocked.emit(station.id, previous)
	if reason != &"":
		station_blocked.emit(station.id, reason)
	return true


func _valid_inventory_ids(ids: Array[StringName]) -> bool:
	if ids.is_empty():
		return false
	var seen: Dictionary = {}
	var seen_instances: Dictionary = {}
	for inventory_id in ids:
		if (
			not _valid_id(inventory_id) or seen.has(inventory_id)
			or not _inventories.has(inventory_id)
			or not is_instance_valid(_inventories[inventory_id])
			or not _inventories[inventory_id].is_configured()
		):
			return false
		var inventory: Inventory = _inventories[inventory_id]
		if seen_instances.has(inventory):
			return false
		seen[inventory_id] = true
		seen_instances[inventory] = true
	return true


func _plan_materials(ids: Array[StringName], items: Dictionary, adding: bool) -> Dictionary:
	if not _valid_inventory_ids(ids):
		return {"ok": false}
	var inventories: Array[Inventory] = []
	for inventory_id in ids:
		inventories.append(_inventories[inventory_id])
	return InventoryBatch.plan_distribution(inventories, items, adding)


# Reconfigure storage while active work or pending deliveries exist.
# The game owns permissions and relocation policy; no items are moved here.
func set_station_inventories(
	station_id: StringName, input_ids: Array[StringName], output_ids: Array[StringName]
) -> bool:
	if _busy_stations.has(station_id):
		return false
	var station := _get_station(station_id)
	if station == null or not _valid_inventory_ids(input_ids) or not _valid_inventory_ids(output_ids):
		return false
	if station.input_inventory_ids == input_ids and station.output_inventory_ids == output_ids:
		return true
	_busy_stations[station_id] = true
	station.input_inventory_ids = input_ids.duplicate()
	station.output_inventory_ids = output_ids.duplicate()
	station_inventories_changed.emit(station_id)
	station_changed.emit(station_id)
	_busy_stations.erase(station_id)
	return true


func get_stations() -> Array[ProductionStation]:
	var result: Array[ProductionStation] = []
	for station in _stations.values():
		result.append(station.copy())
	return result


func unregister_station(station_id: StringName) -> bool:
	if _busy_stations.has(station_id):
		return false
	var station := _get_station(station_id)
	if station == null or not station.cycle.is_empty() or not station.queue.is_empty() or not station.settlements.is_empty():
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
	if _busy_stations.has(station_id):
		return false
	var station := _get_station(station_id)
	if (
		station == null or not _valid_id(order_id) or not _valid_id(recipe_id)
		or _order_ids.has(order_id) or (cycles <= 0 and cycles != -1)
	):
		return false
	_busy_stations[station_id] = true
	station.queue.append({"id": order_id, "recipe_id": recipe_id, "remaining": cycles})
	_order_ids[order_id] = station_id
	order_queued.emit(station_id, order_id)
	station_changed.emit(station_id)
	_busy_stations.erase(station_id)
	return true


func set_paused(station_id: StringName, paused: bool) -> bool:
	if _busy_stations.has(station_id):
		return false
	var station := _get_station(station_id)
	if station == null:
		return false
	if station.paused == paused:
		return true
	_busy_stations[station_id] = true
	station.paused = paused
	station_paused_changed.emit(station_id, paused)
	station_changed.emit(station_id)
	_busy_stations.erase(station_id)
	return true


# Indices refer to the full queue. An active order is pinned at index 0.
# Reordering a queued job into that slot would invalidate the live cycle.
func move_queued_order(station_id: StringName, order_id: StringName, index: int) -> bool:
	if _busy_stations.has(station_id):
		return false
	var station := _get_station(station_id)
	if station == null or index < 0 or index >= station.queue.size():
		return false
	var active := not station.cycle.is_empty()
	if active and index == 0:
		return false
	for i in station.queue.size():
		var order: Dictionary = station.queue[i]
		if order["id"] != order_id:
			continue
		if active and i == 0:
			return false
		if i == index:
			return true
		_busy_stations[station_id] = true
		station.queue.remove_at(i)
		station.queue.insert(index, order)
		if station.cycle.is_empty() and index == 0:
			_set_block(station, &"")
		station_changed.emit(station_id)
		_busy_stations.erase(station_id)
		return true
	return false

# Only queued, not currently active, orders can be removed this way.
func remove_queued_order(station_id: StringName, order_id: StringName) -> bool:
	if _busy_stations.has(station_id):
		return false
	var station := _get_station(station_id)
	if station == null or (
		not station.cycle.is_empty() and station.cycle["order_id"] == order_id
	):
		return false
	for i in station.queue.size():
		if station.queue[i]["id"] == order_id:
			_busy_stations[station_id] = true
			station.queue.remove_at(i)
			_order_ids.erase(order_id)
			if station.cycle.is_empty() and i == 0:
				_set_block(station, &"")
			queued_order_removed.emit(station_id, order_id)
			station_changed.emit(station_id)
			_busy_stations.erase(station_id)
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
		"phase": WORK, "reserved": {}, "pending": {}
	}


# Request a new production cycle at a meaningful gameplay event (order
# queued, materials delivered, worker begins working), never on every frame.
# Success atomically reserves all inputs and enters the WORK phase.
# Failure does not create a cycle or consume goods; it may report a block reason.
func try_begin_cycle(station_id: StringName) -> bool:
	if _busy_stations.has(station_id):
		return false
	_busy_stations[station_id] = true
	var accepted := _try_begin_cycle_internal(station_id)
	_busy_stations.erase(station_id)
	return accepted


func _try_begin_cycle_internal(station_id: StringName) -> bool:
	var station := _get_station(station_id)
	if station == null or station.paused or not station.cycle.is_empty() or station.queue.is_empty():
		return false

	var order: Dictionary = station.queue.front()
	var cycle := _resolve_cycle(station, order)
	if cycle.is_empty():
		if _set_block(station, BLOCK_RECIPE):
			station_changed.emit(station_id)
		return false

	var planned := _plan_materials(station.input_inventory_ids, cycle["inputs"], false)
	if not planned.get("ok", false):
		if _set_block(station, BLOCK_INPUTS):
			station_changed.emit(station_id)
		return false
	var changes: Array[Dictionary] = planned["changes"]
	if not changes.is_empty() and not InventoryBatch.apply(changes, false):
		if _set_block(station, BLOCK_INPUTS):
			station_changed.emit(station_id)
		return false

	# Every new cycle begins ready for *externally supplied work*. No internal
	# timer, worker schedule, ETA, frame loop, or per-tick work accumulation.
	cycle["reserved"] = cycle["inputs"].duplicate(true)
	cycle["phase"] = WORK
	station.cycle = cycle
	_set_block(station, &"")
	cycle_started.emit(station_id, order["id"])
	_notify_phase(station, IDLE)
	InventoryBatch.notify_contents_changed(changes)
	station_changed.emit(station_id)
	return true


# Called after the *game* observes work completion or output-space changes.
# Never starts another cycle implicitly; orchestration remains in the game.
func try_deliver_outputs(station_id: StringName) -> bool:
	if _busy_stations.has(station_id):
		return false
	_busy_stations[station_id] = true
	var station := _get_station(station_id)
	var delivered := false
	if station != null and not station.paused:
		delivered = _finish_output(station, false)
	_busy_stations.erase(station_id)
	return delivered


# A read-only, time-free work ledger for the game's event scheduler and UI.
# There is intentionally no finish_at, duration, rate, employee, or timestamp.
# A station not in WORK has no outstanding *work contribution* to schedule.
func get_work_state(station_id: StringName) -> Dictionary:
	var station := _get_station(station_id)
	if station == null:
		return {}
	var phase := _phase(station)
	var completed := 0
	var required := 0
	if not station.cycle.is_empty():
		completed = station.cycle["work_done"]
		required = station.cycle["work_required"]
	return {
		"phase": phase,
		"paused": station.paused,
		"block_reason": station.block_reason,
		"work_completed": completed,
		"work_required": required,
		"work_remaining": required - completed
	}


# Accepts up to the remaining work, returns the accepted number of work units.
# Only externally measured work is accepted; no simulation clock inside this package.
func contribute_work(station_id: StringName, units: int) -> int:
	if _busy_stations.has(station_id):
		return 0
	_busy_stations[station_id] = true
	var applied := _contribute_work_internal(station_id, units)
	_busy_stations.erase(station_id)
	return applied


func _contribute_work_internal(station_id: StringName, units: int) -> int:
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
	work_contributed.emit(station_id, applied)
	if cycle["phase"] == OUTPUT:
		_notify_phase(station, WORK)
	station_changed.emit(station_id)
	return applied


# A cancellation ends the active job immediately, including on paused stations.
# Reserved inputs or finished outputs become independently persistent settlements.
# Nothing can be deleted by lack of destination capacity.
func cancel_active_order(station_id: StringName) -> bool:
	if _busy_stations.has(station_id):
		return false
	_busy_stations[station_id] = true
	var accepted := _cancel_internal(station_id)
	_busy_stations.erase(station_id)
	return accepted


func cancel_order(station_id: StringName, order_id: StringName) -> bool:
	var station := _get_station(station_id)
	if station == null or _busy_stations.has(station_id):
		return false
	if not station.cycle.is_empty() and station.cycle["order_id"] == order_id:
		return cancel_active_order(station_id)
	if remove_queued_order(station_id, order_id):
		order_canceled.emit(station_id, order_id)
		return true
	return false


func _cancel_internal(station_id: StringName) -> bool:
	var station := _get_station(station_id)
	if station == null or station.cycle.is_empty():
		return false
	var cycle: Dictionary = station.cycle
	var order_id: StringName = cycle["order_id"]
	var phase: StringName = cycle["phase"]
	var kind: StringName = &""
	var held_items: Dictionary = {}
	if phase == WORK:
		kind = REFUND
		held_items = cycle["reserved"].duplicate(true)
	elif phase == OUTPUT:
		kind = DELIVERY
		held_items = cycle["pending"].duplicate(true)
	if not held_items.is_empty():
		station.settlements.append({
			"order_id": order_id, "kind": kind, "items": held_items
		})
	else:
		_order_ids.erase(order_id)
	station.cycle = {}
	station.queue.pop_front()
	_set_block(station, &"")
	_notify_phase(station, phase)
	if not held_items.is_empty():
		settlement_created.emit(station_id, order_id, kind)
	order_canceled.emit(station_id, order_id)
	station_changed.emit(station_id)
	return true


# Resolve one cancellation settlement into currently bound inventories.
# Without an order ID, the oldest is selected. Failed placement changes nothing.
func settle_pending(station_id: StringName, order_id: StringName = &"") -> bool:
	if _busy_stations.has(station_id):
		return false
	_busy_stations[station_id] = true
	var accepted := _settle_pending_internal(station_id, order_id)
	_busy_stations.erase(station_id)
	return accepted


func _settle_pending_internal(station_id: StringName, order_id: StringName) -> bool:
	var station := _get_station(station_id)
	if station == null or station.settlements.is_empty():
		return false
	var index := 0
	if order_id != &"":
		index = -1
		for candidate in station.settlements.size():
			if station.settlements[candidate]["order_id"] == order_id:
				index = candidate
				break
		if index == -1:
			return false
	var entry: Dictionary = station.settlements[index]
	var ids: Array[StringName] = (
		station.input_inventory_ids if entry["kind"] == REFUND else station.output_inventory_ids
	)
	var planned := _plan_materials(ids, entry["items"], true)
	if not planned.get("ok", false):
		return false
	var changes: Array[Dictionary] = planned["changes"]
	if not changes.is_empty() and not InventoryBatch.apply(changes, false):
		return false
	var order_id: StringName = entry["order_id"]
	station.settlements.remove_at(index)
	_order_ids.erase(order_id)
	InventoryBatch.notify_contents_changed(changes)
	settlement_resolved.emit(station_id, order_id, &"stored")
	station_changed.emit(station_id)
	return true


# Explicit destructive policy, initiated by the game (e.g. building razing).
# Does not silently convert a failed deposit into item loss.
func discard_settlement(station_id: StringName, order_id: StringName) -> bool:
	if _busy_stations.has(station_id):
		return false
	var station := _get_station(station_id)
	if station == null:
		return false
	for index in station.settlements.size():
		if station.settlements[index]["order_id"] != order_id:
			continue
		_busy_stations[station_id] = true
		station.settlements.remove_at(index)
		_order_ids.erase(order_id)
		settlement_resolved.emit(station_id, order_id, &"discarded")
		station_changed.emit(station_id)
		_busy_stations.erase(station_id)
		return true
	return false


func _finish_output(station: ProductionStation, cancel_repetitions: bool) -> bool:
	var cycle := station.cycle
	if cycle.is_empty() or cycle["phase"] != OUTPUT:
		return false
	var planned := _plan_materials(station.output_inventory_ids, cycle["pending"], true)
	if not planned.get("ok", false):
		if _set_block(station, BLOCK_OUTPUTS):
			station_changed.emit(station.id)
		return false
	var changes: Array[Dictionary] = planned["changes"]
	if not changes.is_empty() and not InventoryBatch.apply(changes, false):
		if _set_block(station, BLOCK_OUTPUTS):
			station_changed.emit(station.id)
		return false
	var order_id: StringName = cycle["order_id"]
	station.cycle = {}
	var order: Dictionary = station.queue.front()
	if order["remaining"] > 0:
		order["remaining"] -= 1
	var finished := order["remaining"] == 0 or cancel_repetitions
	if finished:
		station.queue.pop_front()
		_order_ids.erase(order_id)
	_set_block(station, &"")
	_notify_phase(station, OUTPUT)
	InventoryBatch.notify_contents_changed(changes)
	cycle_completed.emit(station.id, order_id)
	if finished:
		order_completed.emit(station.id, order_id)
	station_changed.emit(station.id)
	return true


func export_state() -> Dictionary:
	if not _busy_stations.is_empty():
		push_error("Production cannot export a consistent snapshot during an active transaction.")
		return {}
	var ids: Array[String] = []
	for station_id in _stations:
		ids.append(String(station_id))
	ids.sort()
	var entries: Array[Dictionary] = []
	for id in ids:
		entries.append(_get_station(StringName(id)).to_snapshot())
	return {"version": SNAPSHOT_VERSION, "stations": entries}


func restore_state(snapshot: Dictionary) -> bool:
	if not _busy_stations.is_empty():
		return false
	if snapshot.get("version") != SNAPSHOT_VERSION or not snapshot.get("stations") is Array:
		return false
	var restored: Dictionary = {}
	var order_ids: Dictionary = {}
	for value in snapshot["stations"]:
		if not value is Dictionary or value.size() != 8:
			return false
		for key in ["id", "paused", "block_reason", "queue", "cycle", "settlements", "input_inventory_ids", "output_inventory_ids"]:
			if not value.has(key):
				return false
		if (
			not value["id"] is StringName or not _valid_id(value["id"])
			or not value["paused"] is bool
			or not value["block_reason"] is StringName
			or not value["block_reason"] in [&"", BLOCK_INPUTS, BLOCK_OUTPUTS, BLOCK_RECIPE]
			or not value["queue"] is Array
			or not value["cycle"] is Dictionary
			or not value["settlements"] is Array
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
		station.block_reason = value["block_reason"]
		station.queue = value["queue"].duplicate(true)
		station.cycle = value["cycle"].duplicate(true)
		station.settlements = value["settlements"].duplicate(true)
		for order in station.queue:
			if not order is Dictionary or order.size() != 3 or not order.has("id") or not order.has("recipe_id") or not order.has("remaining"):
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
		if station.block_reason == BLOCK_RECIPE and (not station.cycle.is_empty() or station.queue.is_empty()):
			return false
		if station.block_reason == BLOCK_INPUTS and (not station.cycle.is_empty() or station.queue.is_empty()):
			return false
		if station.block_reason == BLOCK_OUTPUTS and (station.cycle.is_empty() or station.cycle["phase"] != OUTPUT):
			return false
		for entry in station.settlements:
			if not _valid_settlement(entry) or order_ids.has(entry["order_id"]):
				return false
			order_ids[entry["order_id"]] = station.id
		restored[station.id] = station
	_stations = restored
	_order_ids = order_ids
	state_restored.emit()
	return true


func _valid_settlement(entry: Variant) -> bool:
	if not entry is Dictionary or entry.size() != 3:
		return false
	for key in ["order_id", "kind", "items"]:
		if not entry.has(key):
			return false
	return (
		entry["order_id"] is StringName and _valid_id(entry["order_id"])
		and entry["kind"] is StringName
		and entry["kind"] in [REFUND, DELIVERY]
		and _valid_items(entry["items"]) and not entry["items"].is_empty()
	)


func _valid_cycle(station: ProductionStation) -> bool:
	var cycle := station.cycle
	if cycle.size() != 9:
		return false
	for key in ["order_id", "recipe_id", "inputs", "outputs", "work_required", "work_done", "phase", "reserved", "pending"]:
		if not cycle.has(key):
			return false
	if (
		station.queue.is_empty()
		or not cycle["order_id"] is StringName
		or not _valid_id(cycle["order_id"])
		or station.queue.front()["id"] != cycle["order_id"]
		or not cycle["recipe_id"] is StringName
		or not _valid_id(cycle["recipe_id"])
		or station.queue.front()["recipe_id"] != cycle["recipe_id"]
		or not _valid_items(cycle["inputs"]) or not _valid_items(cycle["outputs"])
		or not _valid_items(cycle["reserved"]) or not _valid_items(cycle["pending"])
		or typeof(cycle["work_required"]) != TYPE_INT or cycle["work_required"] <= 0
		or typeof(cycle["work_done"]) != TYPE_INT or cycle["work_done"] < 0
		or cycle["work_done"] > cycle["work_required"]
		or not cycle["phase"] is StringName
		or not cycle["phase"] in [WORK, OUTPUT]
	):
		return false
		if cycle["phase"] == WORK:
		return cycle["work_done"] < cycle["work_required"] and cycle["reserved"] == cycle["inputs"] and cycle["pending"].is_empty()
	return cycle["work_done"] == cycle["work_required"] and cycle["reserved"].is_empty() and cycle["pending"] == cycle["outputs"]


static func _valid_id(id: StringName) -> bool:
	return not String(id).strip_edges().is_empty()
