class_name GameMap
extends RefCounted;


var data: Dictionary;
var source_path: String;
var terrain: TerrainHeightField;
var terrain_surfaces: TerrainSurfaceField;


func _init(
	data_value: Dictionary,
	source_path_value: String,
	terrain_value: TerrainHeightField,
	terrain_surfaces_value: TerrainSurfaceField
) -> void:
	data = data_value;
	source_path = source_path_value;
	terrain = terrain_value;
	terrain_surfaces = terrain_surfaces_value;


func asset_path(relative_path: String) -> String:
	return source_path.get_base_dir().path_join(relative_path);
