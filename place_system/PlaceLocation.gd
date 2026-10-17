class_name PlaceLocation
extends RefCounted

var place_id: StringName
var position: Vector3


func _init(id: StringName, local_position: Vector3) -> void:
	place_id = id
	position = local_position


func is_valid() -> bool:
	return place_id != &"" and position.is_finite()
