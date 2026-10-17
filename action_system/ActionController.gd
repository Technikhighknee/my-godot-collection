class_name ActionController
extends Node


signal actions_changed()
signal target_required(action_id: StringName, target_kind: ActionDefinition.TargetKind)
signal targeting_canceled(action_id: StringName)
signal action_rejected(action_id: StringName, reason: StringName)
signal action_started(execution: ActionExecution)
signal action_finished(execution: ActionExecution)
signal cooldown_started(action_id: StringName, seconds: float)
signal cooldown_finished(action_id: StringName)

var _definitions: Dictionary = {}
var _pending_action: StringName = &""
var _running: Array[ActionExecution] = []
var _execution_definitions: Dictionary = {} # ActionExecution -> ActionDefinition
var _cooldowns: Dictionary = {} # StringName -> Timer


func register_action(definition: ActionDefinition) -> bool:
	if definition == null or not definition.is_valid_definition():
		return false
	if _definitions.has(definition.id):
		return false

	_definitions[definition.id] = definition
	actions_changed.emit()
	return true


func unregister_action(action_id: StringName) -> void:
	if not _definitions.erase(action_id):
		return

	if _pending_action == action_id:
		cancel_targeting()

	_clear_cooldown(action_id)

# Unregistering an action leaves its running executions intact.
	actions_changed.emit()


func notify_actions_changed() -> void:
	actions_changed.emit()


func get_actions() -> Array[ActionDefinition]:
	var result: Array[ActionDefinition] = []
	for definition in _definitions.values():
		result.append(definition)
	return result


func get_action(action_id: StringName) -> ActionDefinition:
	return _definitions.get(action_id) as ActionDefinition


func is_available(action_id: StringName) -> bool:
	var definition := get_action(action_id)
	return definition != null and not is_on_cooldown(action_id) and definition.is_available(get_parent())


func is_on_cooldown(action_id: StringName) -> bool:
	return get_cooldown_remaining(action_id) > 0.0


func get_cooldown_remaining(action_id: StringName) -> float:
	var timer := _cooldowns.get(action_id) as Timer
	if timer == null or not is_instance_valid(timer):
		return 0.0
	return timer.time_left


func request_action(action_id: StringName) -> bool:
	var definition := get_action(action_id)
	if definition == null:
		action_rejected.emit(action_id, &"unknown_action")
		return false
	if is_on_cooldown(action_id):
		action_rejected.emit(action_id, &"cooldown")
		return false
	if not definition.is_available(get_parent()):
		action_rejected.emit(action_id, &"unavailable")
		return false

	cancel_targeting()
	if definition.target_kind == ActionDefinition.TargetKind.NONE:
		return execute_action(action_id) != null

	_pending_action = action_id
	target_required.emit(action_id, definition.target_kind)
	return true


func is_awaiting_target() -> bool:
	return _pending_action != &""


func get_pending_action() -> StringName:
	return _pending_action


# Invalid targets leave targeting active for another attempt.
func submit_target(target: Variant) -> ActionExecution:
	if _pending_action == &"":
		return null

	var id := _pending_action
	# Clear the pending target before invoking a callback that may start another action.
	_pending_action = &""
	var execution := execute_action(id, target)
	if execution == null and _pending_action == &"":
		_pending_action = id
	return execution


func cancel_targeting() -> void:
	if _pending_action == &"":
		return
	var previous := _pending_action
	_pending_action = &""
	targeting_canceled.emit(previous)


func execute_action(action_id: StringName, target: Variant = null) -> ActionExecution:
	var definition := get_action(action_id)
	if definition == null:
		action_rejected.emit(action_id, &"unknown_action")
		return null

	var actor := get_parent()
	if is_on_cooldown(action_id):
		action_rejected.emit(action_id, &"cooldown")
		return null
	if not definition.is_available(actor):
		action_rejected.emit(action_id, &"unavailable")
		return null

	if not definition.accepts_target(actor, target):
		action_rejected.emit(action_id, &"invalid_target")
		return null

	var execution := ActionExecution.new(action_id, actor, target)
	_running.append(execution)
	_execution_definitions[execution] = definition
	execution.finished.connect(_on_execution_finished)
	action_started.emit(execution)

	# An action_started listener may immediately cancel this execution.
	if execution.is_running():
		definition.perform(actor, target, execution)
	return execution


func get_running_actions() -> Array[ActionExecution]:
	return _running.duplicate()


func cancel_execution(execution: ActionExecution) -> void:
	if _running.has(execution):
		execution.cancel()


func cancel_all() -> void:
	cancel_targeting()
	for execution in _running.duplicate():
		execution.cancel()


func _on_execution_finished(execution: ActionExecution) -> void:
	_running.erase(execution)
	var definition := _execution_definitions.get(execution) as ActionDefinition
	_execution_definitions.erase(execution)
	# Only the original definition may start a cooldown after completion.
	if (
		execution.status == ActionExecution.Status.COMPLETED
		and definition != null
		and get_action(execution.id) == definition
		and definition.cooldown_seconds > 0.0
	):
		_start_cooldown(execution.id, definition.cooldown_seconds)
		if _pending_action == execution.id:
			cancel_targeting()
	action_finished.emit(execution)


func _start_cooldown(action_id: StringName, seconds: float) -> void:
	_clear_cooldown(action_id)

	var timer := Timer.new()
	timer.one_shot = true
	timer.ignore_time_scale = false
	add_child(timer)
	_cooldowns[action_id] = timer
	timer.timeout.connect(_on_cooldown_timeout.bind(action_id, timer))
	timer.start(seconds)

	cooldown_started.emit(action_id, seconds)
	actions_changed.emit()


func _on_cooldown_timeout(action_id: StringName, timer: Timer) -> void:
	if _cooldowns.get(action_id) != timer:
		return

	_cooldowns.erase(action_id)
	timer.queue_free()
	cooldown_finished.emit(action_id)
	actions_changed.emit()


func _clear_cooldown(action_id: StringName) -> void:
	var timer := _cooldowns.get(action_id) as Timer
	if timer == null:
		return
	_cooldowns.erase(action_id)
	timer.stop()
	timer.queue_free()


func _exit_tree() -> void:
	cancel_all()
