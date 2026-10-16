class_name ActionController
extends Node

# Attach to a citizen, cart, building, etc. The game registers definitions
# and decides what each measure actually does. No input or UI lives here.

signal actions_changed()
signal target_required(action_id: StringName, target_kind: ActionDefinition.TargetKind)
signal targeting_canceled(action_id: StringName)
signal action_rejected(action_id: StringName, reason: StringName)
signal action_started(execution: ActionExecution)
signal action_finished(execution: ActionExecution)

var _definitions: Dictionary = {}
var _pending_action: StringName = &""
var _running: Array[ActionExecution] = []


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

	# Existing executions remain alive. Unregistering removes the measure
	# from the menu, not a task that was already accepted.
	actions_changed.emit()


# Availability depends on game state. Call this when those rules change so
# an action bar can rebuild without polling.
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
	return definition != null and definition.is_available(get_parent())


# Usually called when the user clicks a measure in the action bar.
# Actions with no target execute immediately; others request targeting.
func request_action(action_id: StringName) -> bool:
	var definition := get_action(action_id)
	if definition == null:
		action_rejected.emit(action_id, &"unknown_action")
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


# Called by the game when the selection system emits a target/location.
# Invalid targets leave targeting active so the player can retry.
func submit_target(target: Variant) -> ActionExecution:
	if _pending_action == &"":
		return null

	var id := _pending_action
	# Clear before execution; a gameplay callback can immediately request a
	# different measure without having its pending target overwritten.
	_pending_action = &""
	var execution := execute_action(id, target)
	if execution == null and _pending_action == &"":
		# Invalid targets leave the original measure pending for another try.
		_pending_action = id
	return execution


func cancel_targeting() -> void:
	if _pending_action == &"":
		return
	var previous := _pending_action
	_pending_action = &""
	targeting_canceled.emit(previous)


# Also usable directly by NPC/game code without involving player input.
# Immediate actions finish by calling execution.complete() in their callback.
# Long-running actions settle later (e.g. on movement_arrived).
func execute_action(action_id: StringName, target: Variant = null) -> ActionExecution:
	var definition := get_action(action_id)
	if definition == null:
		action_rejected.emit(action_id, &"unknown_action")
		return null

	var actor := get_parent()
	if not definition.is_available(actor):
		action_rejected.emit(action_id, &"unavailable")
		return null

	if not definition.accepts_target(actor, target):
		action_rejected.emit(action_id, &"invalid_target")
		return null

	var execution := ActionExecution.new(action_id, actor, target)
	_running.append(execution)
	execution.finished.connect(_on_execution_finished)
	action_started.emit(execution)

	# A listener may cancel the task in response to action_started.
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
	action_finished.emit(execution)


func _exit_tree() -> void:
	cancel_all()
