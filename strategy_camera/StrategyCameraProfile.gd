class_name StrategyCameraProfile
extends Resource

# Only the settings currently different between exterior and interior cameras.
@export_range(0.35, 120.0, 0.5, "suffix:m") var starting_height := 60.0
@export_range(0.0, 90.0, 1.0, "suffix:°") var starting_tilt_degrees := 0.0
@export var zoom_enabled := true
@export_range(0.0, 89.0, 1.0, "suffix:°") var near_min_tilt_degrees := 65.0
@export_range(0.0, 89.0, 1.0, "suffix:°") var far_min_tilt_degrees := 25.0
