class_name TerrainGeometry
extends RefCounted;


static func clip_polygon_to_grid(
	polygon: PackedVector2Array,
	height_field: TerrainHeightField
) -> Array[PackedVector2Array]:
	var result: Array[PackedVector2Array] = [];
	var spacing := height_field.get_sample_spacing();
	var samples := height_field.get_sample_count();
	var bounds := _polygon_bounds(polygon);
	var min_x := clampi(int(floor(bounds.position.x / spacing.x)), 0, samples.x - 2);
	var max_x := clampi(int(floor(bounds.end.x / spacing.x)), 0, samples.x - 2);
	var min_z := clampi(int(floor(bounds.position.y / spacing.y)), 0, samples.y - 2);
	var max_z := clampi(int(floor(bounds.end.y / spacing.y)), 0, samples.y - 2);

	for z in range(min_z, max_z + 1):
		var z0 := float(z) * spacing.y;
		var z1 := float(z + 1) * spacing.y;

		for x in range(min_x, max_x + 1):
			var x0 := float(x) * spacing.x;
			var x1 := float(x + 1) * spacing.x;
			var top_left := Vector2(x0, z0);
			var top_right := Vector2(x1, z0);
			var bottom_left := Vector2(x0, z1);
			var bottom_right := Vector2(x1, z1);
			var terrain_triangles := [
				PackedVector2Array([top_left, bottom_left, top_right]),
				PackedVector2Array([top_right, bottom_left, bottom_right]),
			];

			for triangle in terrain_triangles:
				for clipped in Geometry2D.intersect_polygons(polygon, triangle):
					if clipped.size() >= 3:
						result.append(clipped);

	return result;


static func _polygon_bounds(polygon: PackedVector2Array) -> Rect2:
	var min_point := polygon[0];
	var max_point := polygon[0];

	for point in polygon:
		min_point.x = minf(min_point.x, point.x);
		min_point.y = minf(min_point.y, point.y);
		max_point.x = maxf(max_point.x, point.x);
		max_point.y = maxf(max_point.y, point.y);

	return Rect2(min_point, max_point - min_point);
