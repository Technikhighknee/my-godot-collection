extends Node

# Demo gameplay workload. It is deliberately attached to the PERSISTENT
# PlaceActor, never to an interior scene or its physical body.
# The same ordinary ActionController and Inventory keep processing while the
# camera looks at any other room.

var completed_jobs := 0

var _actor: PlaceActor
var _actions: ActionController
var _inventory: Inventory
var _work_clock: Timer
var _decision_clock: Timer
var _current_execution: ActionExecution


func _ready() -> void:
	_actor = get_parent() as PlaceActor
	_actions = _actor.get_node("ActionController") as ActionController
	_inventory = _actor.get_node("Inventory") as Inventory
	_inventory.configure(8, 999)

	_actions.register_action(ActionDefinition.new(
		&"brew", "Produce goods", ActionDefinition.TargetKind.NONE,
		_start_work, Callable(), Callable(), 1.0
	))

	_work_clock = Timer.new()
	_work_clock.one_shot = true
	_work_clock.wait_time = 1.5
	add_child(_work_clock)
	_work_clock.timeout.connect(_finish_work)

	_decision_clock = Timer.new()
	_decision_clock.wait_time = 0.5
	add_child(_decision_clock)
	_decision_clock.timeout.connect(_maybe_work)
	_decision_clock.start()


func _maybe_work() -> void:
	if not _actor.is_bound() or _current_execution != null:
		return
	if _actions.is_on_cooldown(&"brew"):
		return
	var traveler := _actor.get_node("PlaceTraveler") as PlaceTraveler
	if traveler != null and traveler.is_traveling():
		return
	_actions.execute_action(&"brew")


func _start_work(_owner: Node, _target: Variant, execution: ActionExecution) -> void:
	_current_execution = execution
	execution.set_cancel_handler(_cancel_work)
	execution.finished.connect(_on_work_settled)
	_work_clock.start()


func _finish_work() -> void:
	if _current_execution == null or not _current_execution.is_running():
		return
	if _inventory.add(&"goods", 1):
		completed_jobs += 1
		_current_execution.complete()
	else:
		_current_execution.fail(&"storage_full")


func _cancel_work() -> void:
	_work_clock.stop()


func _on_work_settled(execution: ActionExecution) -> void:
	if execution == _current_execution:
		_current_execution = null
