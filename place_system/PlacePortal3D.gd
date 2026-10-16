class_name PlacePortal3D
extends Marker3D

# A named doorway/transition point in a room template or exterior scene.
# Destinations and upgrade rules are defined per place INSTANCE by the game.
@export var portal_id: StringName = &""
@export_range(0.1, 20.0, 0.1, "or_greater", "suffix:m") var interaction_radius := 1.75
