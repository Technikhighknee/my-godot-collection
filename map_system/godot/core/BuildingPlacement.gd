class_name BuildingPlacement
extends RefCounted;


static func check(
	game_map: GameMap,
	definition: Dictionary,
	position: Vector2,
	rotation_degrees: float,
	occupied: Array = []
) -> Dictionary:
	if game_map == null:
		return _invalid(&"invalid_map");

	var map_data := game_map.data;
	var footprint_size := _read_positive_size(definition.get("footprint"));
	if footprint_size == Vector2.ZERO:
		return _invalid(&"invalid_definition");

	var footprint := _rectangle(footprint_size, position, rotation_degrees);
	var terrain_value: Variant = map_data.get("terrain");
	if typeof(terrain_value) != TYPE_DICTIONARY:
		return _invalid(&"invalid_map");

	var terrain: Dictionary = terrain_value;
	var map_size := _read_positive_size(terrain.get("size"));
	if map_size == Vector2.ZERO:
		return _invalid(&"invalid_map");

	if not _contains_polygon(_map_bounds(map_size), footprint):
		return _invalid(&"outside_map");

	if definition.has("requires_build_area") and typeof(definition["requires_build_area"]) != TYPE_BOOL:
		return _invalid(&"invalid_definition");

	var settlement_id := "";
	if bool(definition.get("requires_build_area", true)):
		settlement_id = _find_settlement(map_data, footprint);
		if settlement_id.is_empty():
			return _invalid(&"outside_build_area");

	var blocking_water := _overlapping_water(map_data, footprint);
	if not blocking_water.is_empty():
		return _invalid(&"overlaps_water", {"water_id": blocking_water});

	var blocking_road := _overlapping_road(map_data, footprint);
	if not blocking_road.is_empty():
		return _invalid(&"overlaps_road", {"road_id": blocking_road});

	for index in range(occupied.size()):
		if not _valid_occupied_entry(occupied[index]):
			return _invalid(&"invalid_occupied", {"occupied_index": index});

	var blocking_building := _overlapping_building(footprint, occupied);
	if not blocking_building.is_empty():
		return _invalid(&"overlaps_building", {"building_id": blocking_building});

	var terrain_slope := _max_terrain_slope(game_map.terrain, footprint);
	if definition.has("max_slope"):
		var max_slope_value: Variant = definition["max_slope"];
		if (
			not _is_number(max_slope_value)
			or float(max_slope_value) < 0.0
			or float(max_slope_value) >= 90.0
		):
			return _invalid(&"invalid_definition");

		if terrain_slope > float(max_slope_value):
			return _invalid(
				&"terrain_too_steep",
				{
					"ground_height": game_map.terrain.height_at(position),
					"terrain_slope": terrain_slope,
				}
			);

	var result := {
		"valid": true,
		"reason": &"",
		"settlement_id": settlement_id,
		"water_id": "",
		"road_id": "",
		"road_distance": INF,
		"ground_height": game_map.terrain.height_at(position),
		"terrain_slope": terrain_slope,
	};

	if definition.has("max_road_distance"):
		var max_distance_value: Variant = definition["max_road_distance"];
		if not _is_number(max_distance_value) or float(max_distance_value) < 0.0:
			return _invalid(&"invalid_definition");
		if not _is_vec2(definition.get("entrance")):
			return _invalid(&"invalid_definition");

		var entrance := _transform_local_point(
			_vec2(definition["entrance"]),
			position,
			rotation_degrees
		);
		var nearest := _nearest_road(map_data, entrance);
		var max_distance := float(max_distance_value);

		if String(nearest["road_id"]).is_empty() or float(nearest["distance"]) > max_distance:
			return _invalid(
				&"road_too_far",
				{
					"road_id": nearest["road_id"],
					"road_distance": nearest["distance"],
				}
			);

		result["road_id"] = nearest["road_id"];
		result["road_distance"] = nearest["distance"];

	return result;


static func _max_terrain_slope(
	height_field: TerrainHeightField,
	footprint: PackedVector2Array
) -> float:
	var max_slope := 0.0;

	for fragment in TerrainGeometry.clip_polygon_to_grid(footprint, height_field):
		var centroid := Vector2.ZERO;
		for point in fragment:
			centroid += point;
		centroid /= float(fragment.size());
		max_slope = maxf(max_slope, height_field.slope_at(centroid));

	return max_slope;


static func _find_settlement(map_data: Dictionary, footprint: PackedVector2Array) -> String:
	for settlement_value in map_data.get("settlements", []):
		var settlement: Dictionary = settlement_value;
		for area_value in settlement.get("build_areas", []):
			var area := _polygon(area_value);
			if _contains_polygon(area, footprint):
				return String(settlement["id"]);

	return "";


static func _overlapping_water(map_data: Dictionary, footprint: PackedVector2Array) -> String:
	for value in map_data.get("water", []):
		var water: Dictionary = value;
		var polygon := _polygon(water["polygon"]);
		if not Geometry2D.intersect_polygons(footprint, polygon).is_empty():
			return String(water["id"]);

	return "";


static func _overlapping_road(map_data: Dictionary, footprint: PackedVector2Array) -> String:
	for road_value in map_data.get("roads", []):
		var road: Dictionary = road_value;
		var centerline := _polygon(road["points"]);
		var road_polygons := Geometry2D.offset_polyline(
			centerline,
			float(road["width"]) * 0.5,
			Geometry2D.JOIN_MITER,
			Geometry2D.END_SQUARE
		);

		for road_polygon in road_polygons:
			if not Geometry2D.intersect_polygons(footprint, road_polygon).is_empty():
				return String(road["id"]);

	return "";


static func _overlapping_building(
	footprint: PackedVector2Array,
	occupied: Array
) -> String:
	for value in occupied:
		var other: Dictionary = value;
		var other_footprint := _rectangle(
			_read_positive_size(other["footprint"]),
			_vec2(other["position"]),
			float(other["rotation"])
		);
		if not Geometry2D.intersect_polygons(footprint, other_footprint).is_empty():
			return String(other.get("id", "<unnamed>"));

	return "";


static func _valid_occupied_entry(value: Variant) -> bool:
	if typeof(value) != TYPE_DICTIONARY:
		return false;

	var entry: Dictionary = value;
	return (
		_read_positive_size(entry.get("footprint")) != Vector2.ZERO
		and _is_vec2(entry.get("position"))
		and _is_number(entry.get("rotation"))
	);


static func _nearest_road(map_data: Dictionary, point: Vector2) -> Dictionary:
	var nearest_id := "";
	var nearest_distance := INF;

	for road_value in map_data.get("roads", []):
		var road: Dictionary = road_value;
		var points: Array = road["points"];
		var half_width := float(road["width"]) * 0.5;

		for index in range(points.size() - 1):
			var a := _vec2(points[index]);
			var b := _vec2(points[index + 1]);
			var closest := Geometry2D.get_closest_point_to_segment(point, a, b);
			var distance := maxf(0.0, point.distance_to(closest) - half_width);

			if distance < nearest_distance:
				nearest_distance = distance;
				nearest_id = String(road["id"]);

	return {
		"road_id": nearest_id,
		"distance": nearest_distance,
	};


static func _contains_polygon(
	container: PackedVector2Array,
	shape: PackedVector2Array
) -> bool:
	return Geometry2D.clip_polygons(shape, container).is_empty();


static func _rectangle(
	size: Vector2,
	position: Vector2,
	rotation_degrees: float
) -> PackedVector2Array:
	var half := size * 0.5;
	var local := PackedVector2Array([
		Vector2(-half.x, -half.y),
		Vector2(half.x, -half.y),
		Vector2(half.x, half.y),
		Vector2(-half.x, half.y),
	]);
	var result := PackedVector2Array();
	var rotation := -deg_to_rad(rotation_degrees);

	for point in local:
		result.append(point.rotated(rotation) + position);

	return result;


static func _transform_local_point(
	point: Vector2,
	position: Vector2,
	rotation_degrees: float
) -> Vector2:
	return point.rotated(-deg_to_rad(rotation_degrees)) + position;


static func _map_bounds(size: Vector2) -> PackedVector2Array:
	return PackedVector2Array([
		Vector2.ZERO,
		Vector2(size.x, 0.0),
		size,
		Vector2(0.0, size.y),
	]);


static func _polygon(value: Array) -> PackedVector2Array:
	var result := PackedVector2Array();
	for point in value:
		result.append(_vec2(point));
	return result;


static func _read_positive_size(value: Variant) -> Vector2:
	if not _is_vec2(value):
		return Vector2.ZERO;

	var result := _vec2(value);
	if result.x <= 0.0 or result.y <= 0.0:
		return Vector2.ZERO;

	return result;


static func _invalid(reason: StringName, extra: Dictionary = {}) -> Dictionary:
	var result := {
		"valid": false,
		"reason": reason,
		"settlement_id": "",
		"water_id": "",
		"road_id": "",
		"road_distance": INF,
		"ground_height": NAN,
		"terrain_slope": NAN,
	};
	result.merge(extra, true);
	return result;


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
