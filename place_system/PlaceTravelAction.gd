class_name PlaceTravelAction
extends RefCounted

# Optional adapter between ActionSystem and PlaceTraveler. Gameplay systems
# remain the source of truth; travel is one long-running ActionExecution.
# This file requires ActionSystem to be installed alongside PlaceSystem.

var _actor: PlaceActor
var _traveler: PlaceTraveler
var _execution: ActionExecution


# Registers a CUSTOM-target measure accepting PlaceLocation. The user/game
# chooses the measure ID/title/cooldown; nothing is hardcoded into the actor.
static func register(
	actor: PlaceActor, controller: ActionController, traveler: PlaceTraveler,
	action_id: StringName, title: String, cooldown_seconds: float = 0.0
) -> bool:
	if not is_instance_valid(actor) or not is_instance_valid(controller):
		return false
	if not is_instance_valid(traveler):
		return false
	if controller.get_parent() != actor or traveler.get_parent() != actor:
		return false

	var binding := PlaceTravelAction.new()
	binding._actor = actor
	binding._traveler = traveler
	var definition := ActionDefinition.new(
		action_id, title, ActionDefinition.TargetKind.CUSTOM,
		binding._perform, binding._available, binding._accepts_destination,
		cooldown_seconds
	)
	return controller.register_action(definition)


func _available(actor: Node) -> bool:
	return (
		actor == _actor
		and _actor.is_bound()
		and is_instance_valid(_traveler)
		and not _traveler.is_traveling()
		and (_execution == null or not _execution.is_running())
	)


func _accepts_destination(_actor_node: Node, target: Variant) -> bool:
	if not target is PlaceLocation:
		return false
	var location := target as PlaceLocation
	var manager := _actor.get_place_manager()
	return (
		location.is_valid()
		and manager != null
		and manager.get_place(location.place_id) != null
	)


func _perform(_actor_node: Node, target: Variant, execution: ActionExecution) -> void:
	if not _available(_actor_node) or not _accepts_destination(_actor_node, target):
		execution.fail(&"unavailable")
		return

	_execution = execution
	_traveler.travel_arrived.connect(_on_arrived)
	_traveler.travel_failed.connect(_on_failed)
	_traveler.travel_canceled.connect(_on_canceled)
	execution.finished.connect(_on_execution_finished)
	execution.set_cancel_handler(_cancel_travel)

	var location := target as PlaceLocation
	if not _traveler.travel_to(location.place_id, location.position):
		# A synchronous travel_failed signal may have already settled it.
		if execution.is_running():
			execution.fail(&"travel_not_started")


func _on_arrived(_place_id: StringName, _position: Vector3) -> void:
	if _execution != null and _execution.is_running():
		_execution.complete()


func _on_failed(reason: StringName) -> void:
	if _execution != null and _execution.is_running():
		_execution.fail(reason)


func _on_canceled() -> void:
	if _execution != null and _execution.is_running():
		_execution.cancel()


func _cancel_travel() -> void:
	if is_instance_valid(_traveler):
		_traveler.cancel()


func _on_execution_finished(execution: ActionExecution) -> void:
	if execution != _execution:
		return

	_execution = null
	if is_instance_valid(_traveler):
		if _traveler.travel_arrived.is_connected(_on_arrived):
			_traveler.travel_arrived.disconnect(_on_arrived)
		if _traveler.travel_failed.is_connected(_on_failed):
			_traveler.travel_failed.disconnect(_on_failed)
		if _traveler.travel_canceled.is_connected(_on_canceled):
			_traveler.travel_canceled.disconnect(_on_canceled)
	# Leave the execution itself to its ActionController.
