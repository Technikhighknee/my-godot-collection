class_name PlacePortal3D
extends Marker3D

# Portal destinations are configured through PlaceManager3D.
@export var portal_id: StringName = &""
@export_range(0.1, 20.0, 0.1, "or_greater", "suffix:m") var interaction_radius := 1.75
