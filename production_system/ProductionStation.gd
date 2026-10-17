class_name ProductionStation
extends RefCounted

# Pure station state. ProductionRegistry owns mutations and resource accounting.
var id: StringName
var paused := false
var queue: Array[Dictionary] = []
var cycle: Dictionary = {}
var input_inventory_id: StringName
var output_inventory_id: StringName

func _init(station_id: StringName, input_id: StringName, output_id: StringName) -> void:
	id = station_id
	input_inventory_id = input_id
	output_inventory_id = output_id

func get_queue() -> Array[Dictionary]:
	return queue.duplicate(true)

func get_cycle() -> Dictionary:
	return cycle.duplicate(true)

func to_snapshot() -> Dictionary:
	return {
		"id": id, "paused": paused, "queue": get_queue(), "cycle": get_cycle(),
		"input_inventory_id": input_inventory_id, "output_inventory_id": output_inventory_id
	}
