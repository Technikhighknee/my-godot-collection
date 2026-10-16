class_name SelectionTarget3D
extends Area3D

# Put a CollisionShape3D below this Area3D and place it on the selection layer.
# The subject can be a character, a building, or any other Node3D.

const GROUP: StringName = &"selection_targets"

@export var subject: Node3D
@export var marquee_anchor: Node3D


func _enter_tree() -> void:
	add_to_group(GROUP)


func get_subject() -> Node3D:
	if subject != null:
		return subject
	return get_parent() as Node3D


func get_marquee_position() -> Vector3:
	if marquee_anchor != null:
		return marquee_anchor.global_position
	return global_position
