extends Node3D;


func _ready() -> void:
	_ensure_key_action(&"camera_left", KEY_A);
	_ensure_key_action(&"camera_right", KEY_D);
	_ensure_key_action(&"camera_forward", KEY_W);
	_ensure_key_action(&"camera_back", KEY_S);


func _ensure_key_action(action: StringName, keycode: Key) -> void:
	if not InputMap.has_action(action):
		InputMap.add_action(action);

	for existing in InputMap.action_get_events(action):
		if existing is InputEventKey and existing.physical_keycode == keycode:
			return;

	var event := InputEventKey.new();
	event.physical_keycode = keycode;
	InputMap.action_add_event(action, event);
