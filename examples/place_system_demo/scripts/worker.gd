extends Node

# Demo-only production job on a PERSISTENT actor.
# Rendering a room must never affect work; being at the assigned workstation
# does. The regular ActionController drives the actual job lifecycle.

const GOODS_PER_JOB := 2
const WORK_RADIUS := 0.85

var completed_jobs := 0

var _actor: PlaceActor
var _actions: ActionController
var _inventory: Inventory
var _traveler: PlaceTraveler
var _work_clock: Timer
var _decision_clock: Timer
var _current_execution: ActionExecution
var _work_place_id: StringName = &""
var _work_position := Vector3.ZERO


func _ready() -> void:
	_actor = get_parent() as PlaceActor
	_actions = _actor.get_node("ActionController") as ActionController
	_inventory = _actor.get_node("Inventory") as Inventory
	_traveler = _actor.get_node("PlaceTraveler") as PlaceTraveler
	_inventory.configure(8, 999)

	# A work order is unavailable outside the assigned workplace, even if
	# some other game code invokes the ActionController directly.
	_actions.register_action(ActionDefinition.new(
		&"brew", "Produce goods", ActionDefinition.TargetKind.NONE,
		_start_work, _can_start_work, Callable(), 1.0
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

	_traveler.travel_started.connect(_on_travel_started)
	_actor.place_changed.connect(_on_place_changed)


# The demo game assigns the workplace per actor, never through a room
# template singleton. Both taverns reuse Hall.tscn but have separate IDs.
func assign_workplace(place_id: StringName, position: Vector3) -> bool:
	if _work_place_id != &"" or place_id == &"" or not position.is_finite():
		return false
	_work_place_id = place_id
	_work_position = position
	return true


func is_at_workplace() -> bool:
	return (
		_actor.is_bound()
		and _work_place_id != &""
		and _actor.get_place_id() == _work_place_id
		and _actor.get_place_position().distance_to(_work_position) <= WORK_RADIUS
	)


func is_working() -> bool:
	return _current_execution != null and _current_execution.is_running()


func _can_start_work(owner: Node) -> bool:
	return (
		owner == _actor
		and is_at_workplace()
		and not _traveler.is_traveling()
		and not is_working()
	)


func _maybe_work() -> void:
	if _actions.is_available(&"brew"):
		_actions.execute_action(&"brew")


func _start_work(owner: Node, _target: Variant, execution: ActionExecution) -> void:
	if not _can_start_work(owner):
		execution.fail(&"not_at_workplace")
		return

	_current_execution = execution
	execution.set_cancel_handler(_cancel_work)
	execution.finished.connect(_on_work_settled)
	_work_clock.start()


func _finish_work() -> void:
	if not is_working():
		return
	# Check the actual workplace again. A room transfer or any movement
	# cannot allow a job begun in the hall to complete somewhere else.
	if not is_at_workplace() or _traveler.is_traveling():
		_current_execution.fail(&"left_workplace")
		return

	if _inventory.add(&"goods", GOODS_PER_JOB):
		completed_jobs += 1
		_current_execution.complete()
	else:
		_current_execution.fail(&"storage_full")


func _on_travel_started(_place_id: StringName, _position: Vector3) -> void:
	_interrupt_work()


func _on_place_changed(_from: StringName, _to: StringName) -> void:
	if not is_at_workplace():
		_interrupt_work()


func _interrupt_work() -> void:
	if is_working():
		_current_execution.cancel()


func _cancel_work() -> void:
	_work_clock.stop()


func _on_work_settled(execution: ActionExecution) -> void:
	if execution == _current_execution:
		_work_clock.stop()
		_current_execution = null
