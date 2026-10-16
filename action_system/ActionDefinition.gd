class_name ActionDefinition
extends RefCounted

# Immutable-by-convention description of a game-defined measure.
# Callbacks are provided by the game, not by this package.
enum TargetKind { NONE, OBJECT, LOCATION }

var id: StringName
var title: String
var target_kind: TargetKind
# 0.0 disables the cooldown. Measured in scaled, pausable game seconds.
var cooldown_seconds := 0.0

var _perform: Callable
var _available: Callable
var _valid_target: Callable


# perform(actor: Node, target: Variant, execution: ActionExecution) -> void
# available(actor: Node) -> bool                        [optional]
# valid_target(actor: Node, target: Variant) -> bool     [optional]
# cooldown: float >= 0.0 (0.0 means no cooldown)       [optional]
func _init(
	action_id: StringName,
	action_title: String,
	kind: TargetKind,
	perform: Callable,
	available: Callable = Callable(),
	valid_target: Callable = Callable(),
	cooldown: float = 0.0
) -> void:
	id = action_id
	title = action_title
	target_kind = kind
	_perform = perform
	_available = available
	_valid_target = valid_target
	cooldown_seconds = cooldown


func is_valid_definition() -> bool:
	return id != &"" and _perform.is_valid() and cooldown_seconds >= 0.0 and cooldown_seconds < INF


func is_available(actor: Node) -> bool:
	if not is_instance_valid(actor) or not actor.is_inside_tree():
		return false
	return not _available.is_valid() or bool(_available.call(actor))


func accepts_target(actor: Node, target: Variant) -> bool:
	match target_kind:
		TargetKind.NONE:
			if target != null:
				return false
		TargetKind.OBJECT:
			if not target is Node3D:
				return false
			var object := target as Node3D
			if not is_instance_valid(object) or not object.is_inside_tree():
				return false
		TargetKind.LOCATION:
			if not target is Vector3 or not (target as Vector3).is_finite():
				return false
		_:
			return false

	return not _valid_target.is_valid() or bool(_valid_target.call(actor, target))


func perform(actor: Node, target: Variant, execution: ActionExecution) -> void:
	_perform.call(actor, target, execution)
