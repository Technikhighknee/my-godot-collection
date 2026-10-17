class_name ProductionStation
extends RefCounted

# Detached query value. ProductionRegistry keeps its own authoritative copy.
# This structure is gameplay-agnostic and does not own Inventory/Nodes.
var id: StringName
var paused := false
var queue: Array[Dictionary] = []
var cycle: Dictionary = {}
var settlements: Array[Dictionary] = [] # Resolvable goods from canceled cycles
var input_inventory_ids: Array[StringName] = []
var output_inventory_ids: Array[StringName] = []


func _init(
	station_id: StringName, input_ids: Array[StringName],
	output_ids: Array[StringName]
) -> void:
	id = station_id
	input_inventory_ids = input_ids.duplicate()
	output_inventory_ids = output_ids.duplicate()


func get_queue() -> Array[Dictionary]:
	return queue.duplicate(true)


func get_cycle() -> Dictionary:
	return cycle.duplicate(true)


func get_settlements() -> Array[Dictionary]:
	return settlements.duplicate(true)


func copy() -> ProductionStation:
	var value := ProductionStation.new(id, input_inventory_ids, output_inventory_ids)
	value.paused = paused
	value.queue = get_queue()
	value.cycle = get_cycle()
	value.settlements = get_settlements()
	return value


func to_snapshot() -> Dictionary:
	return {
		"id": id, "paused": paused, "queue": get_queue(), "cycle": get_cycle(),
		"settlements": get_settlements(),
		"input_inventory_ids": input_inventory_ids.duplicate(),
		"output_inventory_ids": output_inventory_ids.duplicate()
	}
