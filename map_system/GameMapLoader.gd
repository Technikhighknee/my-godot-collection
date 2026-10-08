class_name GameMapLoader
extends RefCounted;


const ROOT_KEYS := ["name", "terrain", "roads", "settlements", "buildings", "objects"];
const TERRAIN_KEYS := ["size", "heightmap", "min_height", "max_height"];
const ROAD_KEYS := ["id", "width", "points"];
const SETTLEMENT_KEYS := ["id", "name", "build_areas"];
const ENTITY_KEYS := ["id", "definition", "position", "rotation"];


static func load_file(path: String) -> GameMap:
	if not FileAccess.file_exists(path):
		push_error("Map file does not exist: %s" % path);
		return null;

	var file := FileAccess.open(path, FileAccess.READ);
	if file == null:
		push_error("Could not open map file: %s" % path);
		return null;

	var json := JSON.new();
	var parse_error := json.parse(file.get_as_text());

	if parse_error != OK:
		push_error(
			"Invalid JSON in %s at line %d: %s"
			% [path, json.get_error_line(), json.get_error_message()]
		);
		return null;

	if typeof(json.data) != TYPE_DICTIONARY:
		push_error("Map root must be an object: %s" % path);
		return null;

	var map_data: Dictionary = json.data;
	var errors := validate(map_data);

	if not errors.is_empty():
		push_error("Invalid map %s:\n- %s" % [path, "\n- ".join(errors)]);
		return null;

	var terrain: Dictionary = map_data["terrain"];
	var heightmap_path := path.get_base_dir().path_join(String(terrain["heightmap"]));
	var height_field := TerrainHeightField.load_file(
		heightmap_path,
		_vec2(terrain["size"]),
		float(terrain["min_height"]),
		float(terrain["max_height"])
	);
	if height_field == null:
		push_error("Could not load terrain heightmap for map: %s" % path);
		return null;

	return GameMap.new(map_data.duplicate(true), path, height_field);


static func validate(map_data: Dictionary) -> PackedStringArray:
	var errors := PackedStringArray();
	_check_keys(map_data, ROOT_KEYS, ROOT_KEYS, "map", errors);

	if not _is_non_empty_string(map_data.get("name")):
		errors.append("map.name must be a non-empty string.");

	var terrain_value: Variant = map_data.get("terrain");
	if typeof(terrain_value) != TYPE_DICTIONARY:
		errors.append("map.terrain must be an object.");
		return errors;

	var terrain: Dictionary = terrain_value;
	_check_keys(terrain, TERRAIN_KEYS, TERRAIN_KEYS, "map.terrain", errors);

	if not _is_vec2(terrain.get("size")):
		errors.append("map.terrain.size must be [width, depth].");
		return errors;

	var size := _vec2(terrain["size"]);
	if size.x <= 0.0 or size.y <= 0.0:
		errors.append("map.terrain.size values must be greater than zero.");

	if not _is_relative_png_path(terrain.get("heightmap")):
		errors.append("map.terrain.heightmap must be a relative .png path without '.' or '..' segments.");

	if not _is_number(terrain.get("min_height")):
		errors.append("map.terrain.min_height must be a number.");

	if not _is_number(terrain.get("max_height")):
		errors.append("map.terrain.max_height must be a number.");

	if (
		_is_number(terrain.get("min_height"))
		and _is_number(terrain.get("max_height"))
		and float(terrain["max_height"]) <= float(terrain["min_height"])
	):
		errors.append("map.terrain.max_height must be greater than min_height.");

	var ids := {};
	_validate_roads(map_data.get("roads"), size, ids, errors);
	_validate_settlements(map_data.get("settlements"), size, ids, errors);
	_validate_entities(map_data.get("buildings"), "buildings", size, ids, errors);
	_validate_entities(map_data.get("objects"), "objects", size, ids, errors);

	return errors;


static func _validate_roads(
	value: Variant,
	map_size: Vector2,
	ids: Dictionary,
	errors: PackedStringArray
) -> void:
	if typeof(value) != TYPE_ARRAY:
		errors.append("map.roads must be an array.");
		return;

	var roads: Array = value;
	for index in range(roads.size()):
		var path := "map.roads[%d]" % index;
		var road_value: Variant = roads[index];

		if typeof(road_value) != TYPE_DICTIONARY:
			errors.append("%s must be an object." % path);
			continue;

		var road: Dictionary = road_value;
		_check_keys(road, ROAD_KEYS, ROAD_KEYS, path, errors);
		_register_id(road.get("id"), path, ids, errors);

		if not _is_number(road.get("width")) or float(road.get("width", 0.0)) <= 0.0:
			errors.append("%s.width must be greater than zero." % path);

		var points_value: Variant = road.get("points");
		if typeof(points_value) != TYPE_ARRAY:
			errors.append("%s.points must be an array." % path);
			continue;

		var points: Array = points_value;
		if points.size() < 2:
			errors.append("%s.points must contain at least two points." % path);
			continue;

		var previous := Vector2.ZERO;
		var has_previous := false;

		for point_index in range(points.size()):
			var point_path := "%s.points[%d]" % [path, point_index];
			if not _validate_map_point(points[point_index], map_size, point_path, errors):
				continue;

			var point := _vec2(points[point_index]);
			if has_previous and point.is_equal_approx(previous):
				errors.append("%s duplicates the previous road point." % point_path);

			previous = point;
			has_previous = true;


static func _validate_settlements(
	value: Variant,
	map_size: Vector2,
	ids: Dictionary,
	errors: PackedStringArray
) -> void:
	if typeof(value) != TYPE_ARRAY:
		errors.append("map.settlements must be an array.");
		return;

	var settlements: Array = value;
	for index in range(settlements.size()):
		var path := "map.settlements[%d]" % index;
		var settlement_value: Variant = settlements[index];

		if typeof(settlement_value) != TYPE_DICTIONARY:
			errors.append("%s must be an object." % path);
			continue;

		var settlement: Dictionary = settlement_value;
		_check_keys(settlement, SETTLEMENT_KEYS, SETTLEMENT_KEYS, path, errors);
		_register_id(settlement.get("id"), path, ids, errors);

		if not _is_non_empty_string(settlement.get("name")):
			errors.append("%s.name must be a non-empty string." % path);

		var areas_value: Variant = settlement.get("build_areas");
		if typeof(areas_value) != TYPE_ARRAY:
			errors.append("%s.build_areas must be an array." % path);
			continue;

		var areas: Array = areas_value;
		if areas.is_empty():
			errors.append("%s.build_areas must contain at least one polygon." % path);
			continue;

		for area_index in range(areas.size()):
			var area_path := "%s.build_areas[%d]" % [path, area_index];
			var area_value: Variant = areas[area_index];

			if typeof(area_value) != TYPE_ARRAY:
				errors.append("%s must be an array of points." % area_path);
				continue;

			var area: Array = area_value;
			if area.size() < 3:
				errors.append("%s must contain at least three points." % area_path);
				continue;

			var polygon := PackedVector2Array();
			var valid_points := true;

			for point_index in range(area.size()):
				var point_path := "%s[%d]" % [area_path, point_index];
				if not _validate_map_point(area[point_index], map_size, point_path, errors):
					valid_points = false;
					continue;
				polygon.append(_vec2(area[point_index]));

			if valid_points and Geometry2D.triangulate_polygon(polygon).is_empty():
				errors.append("%s must be a valid, non-self-intersecting polygon." % area_path);


static func _validate_entities(
	value: Variant,
	section: String,
	map_size: Vector2,
	ids: Dictionary,
	errors: PackedStringArray
) -> void:
	if typeof(value) != TYPE_ARRAY:
		errors.append("map.%s must be an array." % section);
		return;

	var entries: Array = value;
	for index in range(entries.size()):
		var path := "map.%s[%d]" % [section, index];
		var entry_value: Variant = entries[index];

		if typeof(entry_value) != TYPE_DICTIONARY:
			errors.append("%s must be an object." % path);
			continue;

		var entry: Dictionary = entry_value;
		_check_keys(entry, ENTITY_KEYS, ENTITY_KEYS, path, errors);
		_register_id(entry.get("id"), path, ids, errors);

		if not _is_non_empty_string(entry.get("definition")):
			errors.append("%s.definition must be a non-empty string." % path);

		_validate_map_point(entry.get("position"), map_size, "%s.position" % path, errors);

		if not _is_number(entry.get("rotation")):
			errors.append("%s.rotation must be a number in degrees." % path);


static func _validate_map_point(
	value: Variant,
	map_size: Vector2,
	path: String,
	errors: PackedStringArray
) -> bool:
	if not _is_vec2(value):
		errors.append("%s must be [x, z]." % path);
		return false;

	var point := _vec2(value);
	if point.x < 0.0 or point.y < 0.0 or point.x > map_size.x or point.y > map_size.y:
		errors.append("%s lies outside the terrain bounds." % path);
		return false;

	return true;


static func _register_id(
	value: Variant,
	path: String,
	ids: Dictionary,
	errors: PackedStringArray
) -> void:
	if not _is_non_empty_string(value):
		errors.append("%s.id must be a non-empty string." % path);
		return;

	var id := String(value);
	if ids.has(id):
		errors.append("%s.id duplicates %s: %s" % [path, ids[id], id]);
		return;

	ids[id] = path;


static func _check_keys(
	value: Dictionary,
	required: Array,
	allowed: Array,
	path: String,
	errors: PackedStringArray
) -> void:
	for key in required:
		if not value.has(key):
			errors.append("%s.%s is required." % [path, key]);

	for key in value.keys():
		if key not in allowed:
			errors.append("%s contains unknown key: %s" % [path, key]);


static func _is_relative_png_path(value: Variant) -> bool:
	if not _is_non_empty_string(value):
		return false;

	var path := String(value);
	if path.contains("\\") or path.begins_with("/") or path.contains(":"):
		return false;
	if not path.to_lower().ends_with(".png"):
		return false;

	for segment in path.split("/"):
		if segment.is_empty() or segment == "." or segment == "..":
			return false;

	return true;


static func _is_non_empty_string(value: Variant) -> bool:
	return typeof(value) == TYPE_STRING and not String(value).strip_edges().is_empty();


static func _is_number(value: Variant) -> bool:
	var type := typeof(value);
	return type == TYPE_INT or type == TYPE_FLOAT;


static func _is_vec2(value: Variant) -> bool:
	return (
		typeof(value) == TYPE_ARRAY
		and value.size() == 2
		and _is_number(value[0])
		and _is_number(value[1])
	);


static func _vec2(value: Array) -> Vector2:
	return Vector2(float(value[0]), float(value[1]));
