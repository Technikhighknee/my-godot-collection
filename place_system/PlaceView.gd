class_name PlaceView
extends TextureRect

# Optional UI surface for the ONE place the player is currently viewing.
# The room's actual Node3D tree stays in PlaceManager3D and keeps simulating.
# PlaceView switches textures, never reparents, reloads, or pauses worlds.
@export var place_manager: PlaceManager3D


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	stretch_mode = TextureRect.STRETCH_SCALE
	if place_manager == null:
		push_warning("PlaceView needs a PlaceManager3D.")
		hide()
		return

	place_manager.place_view_changed.connect(_on_place_view_changed)
	mouse_entered.connect(_notify_mouse_entered)
	mouse_exited.connect(_notify_mouse_exited)
	_on_place_view_changed(place_manager.get_viewed_place())


func _notification(what: int) -> void:
	if what == NOTIFICATION_RESIZED and is_instance_valid(place_manager):
		place_manager.set_view_resolution(Vector2i(size))


func _on_place_view_changed(place_id: StringName) -> void:
	if not is_instance_valid(place_manager):
		return

	var place := place_manager.get_place(place_id)
	if place == null or not place.owned_viewport:
		texture = null
		hide()
		return

	place_manager.set_view_resolution(Vector2i(size))
	texture = place.viewport.get_texture()
	show()


func _gui_input(event: InputEvent) -> void:
	if not visible or not is_instance_valid(place_manager):
		return
	var place := place_manager.get_place(place_manager.get_viewed_place())
	if place == null or not place.owned_viewport:
		return

	# TextureRect and room viewport may be different sizes. Forward input in
	# viewport-local pixels so SelectionSystem raycasts have correct positions.
	var forwarded := event.duplicate() as InputEvent
	if forwarded is InputEventMouse:
		if size.x <= 0.0 or size.y <= 0.0:
			return
		var scale := Vector2(place.viewport.size) / size
		var mouse := forwarded as InputEventMouse
		mouse.position *= scale
		mouse.global_position = mouse.position
		if forwarded is InputEventMouseMotion:
			var motion := forwarded as InputEventMouseMotion
			motion.relative *= scale
			motion.screen_relative *= scale

	place.viewport.push_input(forwarded, true)
	accept_event()


func _unhandled_key_input(event: InputEvent) -> void:
	if not visible or not is_instance_valid(place_manager):
		return
	var place := place_manager.get_place(place_manager.get_viewed_place())
	if place == null or not place.owned_viewport:
		return

	place.viewport.push_input(event.duplicate(), true)
	get_viewport().set_input_as_handled()


func _notify_mouse_entered() -> void:
	var place := _shown_room()
	if place != null:
		place.viewport.notify_mouse_entered()


func _notify_mouse_exited() -> void:
	var place := _shown_room()
	if place != null:
		place.viewport.notify_mouse_exited()


func _shown_room() -> PlaceInstance:
	if not is_instance_valid(place_manager):
		return null
	var place := place_manager.get_place(place_manager.get_viewed_place())
	if place != null and place.owned_viewport:
		return place
	return null
