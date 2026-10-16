class_name ActionExecution
extends RefCounted

# One invocation of a measure. Its gameplay callback owns the actual work.
enum Status { RUNNING, COMPLETED, FAILED, CANCELED }

signal finished(execution: ActionExecution)

var id: StringName
var actor: Node
var target: Variant
var status: Status = Status.RUNNING
var failure_reason: StringName = &""

var _cancel_handler: Callable


func _init(action_id: StringName, action_actor: Node, action_target: Variant) -> void:
	id = action_id
	actor = action_actor
	target = action_target


func is_running() -> bool:
	return status == Status.RUNNING


# For ongoing measures, the game should stop outstanding work and disconnect
# any callbacks here. This is invoked only when the execution is canceled.
func set_cancel_handler(handler: Callable) -> void:
	if is_running():
		_cancel_handler = handler


func complete() -> bool:
	return _settle(Status.COMPLETED)


func fail(reason: StringName) -> bool:
	return _settle(Status.FAILED, reason)


func cancel() -> bool:
	return _settle(Status.CANCELED)


func _settle(result: Status, reason: StringName = &"") -> bool:
	if not is_running():
		return false

	status = result
	failure_reason = reason

	if result == Status.CANCELED and _cancel_handler.is_valid():
		_cancel_handler.call()

	_cancel_handler = Callable()
	finished.emit(self)
	return true
