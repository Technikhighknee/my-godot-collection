class_name WaterGeometry
extends RefCounted;


# Water follows the same TL/BL/TR, TR/BL/BR split as TerrainHeightField.
# A source floods only triangles reachable across a submerged shared edge.
# This is static connectivity, not a time-dependent fluid simulation.
static func generate(entries: Array, terrain: TerrainHeightField) -> Array:
	var result: Array = [];
	var samples := terrain.get_sample_count();
	var columns := samples.x - 1;
	var rows := samples.y - 1;
	var triangle_count := columns * rows * 2;
	var world_size := terrain.get_world_size();

	for value in entries:
		var source: Dictionary = value;
		var level := float(source["height"]);
		var mask := PackedByteArray();
		mask.resize(triangle_count);
		var queue := PackedInt32Array();
		queue.resize(triangle_count);
		var head := 0;
		var tail := 0;

		if String(source["definition"]) == "water.sea":
			for z in range(rows):
				if minf(terrain.height_at_sample(0, z), terrain.height_at_sample(0, z + 1)) < level:
					var left := z * columns * 2;
					if mask[left] == 0:
						mask[left] = 1;
						queue[tail] = left;
						tail += 1;
				if minf(terrain.height_at_sample(columns, z), terrain.height_at_sample(columns, z + 1)) < level:
					var right := (z * columns + columns - 1) * 2 + 1;
					if mask[right] == 0:
						mask[right] = 1;
						queue[tail] = right;
						tail += 1;
			for x in range(columns):
				if minf(terrain.height_at_sample(x, 0), terrain.height_at_sample(x + 1, 0)) < level:
					var top := x * 2;
					if mask[top] == 0:
						mask[top] = 1;
						queue[tail] = top;
						tail += 1;
				if minf(terrain.height_at_sample(x, rows), terrain.height_at_sample(x + 1, rows)) < level:
					var bottom := ((rows - 1) * columns + x) * 2 + 1;
					if mask[bottom] == 0:
						mask[bottom] = 1;
						queue[tail] = bottom;
						tail += 1;
		else:
			var point := Vector2(float(source["source"][0]), float(source["source"][1]));
			if terrain.height_at(point) >= level:
				push_error("Lake source must be submerged: %s" % source["id"]);
				return [];
			var gx := point.x / world_size.x * float(columns);
			var gz := point.y / world_size.y * float(rows);
			var px := mini(columns - 1, int(floor(gx)));
			var pz := mini(rows - 1, int(floor(gz)));
			var half := 0;
			if gx - float(px) + gz - float(pz) > 1.0:
				half = 1;
			var first := (pz * columns + px) * 2 + half;
			mask[first] = 1;
			queue[tail] = first;
			tail += 1;

		while head < tail:
			var t := queue[head];
			head += 1;
			var cell := t / 2;
			var x := cell % columns;
			var z := cell / columns;
			var a := terrain.height_at_sample(x, z);
			var b := terrain.height_at_sample(x, z + 1);
			var c := terrain.height_at_sample(x + 1, z);
			var d := terrain.height_at_sample(x + 1, z + 1);
			var candidates: Array[int] = [];
			if t % 2 == 0:
				if x > 0 and minf(a, b) < level:
					candidates.append(t - 1);
				if z > 0 and minf(a, c) < level:
					candidates.append(t - columns * 2 + 1);
				if minf(b, c) < level:
					candidates.append(t + 1);
			else:
				if x + 1 < columns and minf(c, d) < level:
					candidates.append(t + 1);
				if z + 1 < rows and minf(b, d) < level:
					candidates.append(t + columns * 2 - 1);
				if minf(b, c) < level:
					candidates.append(t - 1);
			for neighbor in candidates:
				if mask[neighbor] == 0:
					mask[neighbor] = 1;
					queue[tail] = neighbor;
					tail += 1;

		var vertices := PackedVector3Array();
		for index in range(tail):
			var triangle := triangle_points(queue[index], terrain);
			var polygon := clip_below(triangle, level);
			for corner in range(1, polygon.size() - 1):
				for p in [polygon[0], polygon[corner], polygon[corner + 1]]:
					vertices.append(Vector3(p.x, level + 0.025, p.y));
		result.append({
			"id": source["id"],
			"definition": source["definition"],
			"level": level,
			"mask": mask,
			"vertices": vertices,
		});
	return result;


static func triangle_points(t: int, terrain: TerrainHeightField) -> Array[Vector3]:
	var samples := terrain.get_sample_count();
	var columns := samples.x - 1;
	var cell := t / 2;
	var x := cell % columns;
	var z := cell / columns;
	var spacing := terrain.get_sample_spacing();
	var a := Vector3(float(x) * spacing.x, terrain.height_at_sample(x, z), float(z) * spacing.y);
	var b := Vector3(float(x) * spacing.x, terrain.height_at_sample(x, z + 1), float(z + 1) * spacing.y);
	var c := Vector3(float(x + 1) * spacing.x, terrain.height_at_sample(x + 1, z), float(z) * spacing.y);
	var d := Vector3(float(x + 1) * spacing.x, terrain.height_at_sample(x + 1, z + 1), float(z + 1) * spacing.y);
	return [c, b, d] if t % 2 != 0 else [a, b, c];


static func clip_below(triangle: Array[Vector3], level: float) -> PackedVector2Array:
	var result := PackedVector2Array();
	for i in range(triangle.size()):
		var a := triangle[i];
		var b := triangle[(i + 1) % triangle.size()];
		var inside_a := a.y < level;
		var inside_b := b.y < level;
		if inside_a != inside_b:
			var alpha := (level - a.y) / (b.y - a.y);
			var crossing := a.lerp(b, alpha);
			result.append(Vector2(crossing.x, crossing.z));
		if inside_b:
			result.append(Vector2(b.x, b.z));
	return result;


static func source_at(regions: Array, terrain: TerrainHeightField, point: Vector2) -> String:
	var size := terrain.get_world_size();
	if point.x < 0.0 or point.y < 0.0 or point.x > size.x or point.y > size.y:
		return "";
	var samples := terrain.get_sample_count();
	var columns := samples.x - 1;
	var rows := samples.y - 1;
	var gx := point.x / size.x * float(columns);
	var gz := point.y / size.y * float(rows);
	var x := mini(columns - 1, int(floor(gx)));
	var z := mini(rows - 1, int(floor(gz)));
	var t := (z * columns + x) * 2;
	if gx - float(x) + gz - float(z) > 1.0:
		t += 1;
	for region in regions:
		if region["mask"][t] != 0 and terrain.height_at(point) < float(region["level"]):
			return String(region["id"]);
	return "";


static func intersects_footprint(regions: Array, terrain: TerrainHeightField, footprint: PackedVector2Array) -> String:
	var bounds := _bounds(footprint);
	var samples := terrain.get_sample_count();
	var columns := samples.x - 1;
	var rows := samples.y - 1;
	var spacing := terrain.get_sample_spacing();
	var x0 := clampi(int(floor(bounds.position.x / spacing.x)), 0, columns - 1);
	var x1 := clampi(int(floor(bounds.end.x / spacing.x)), 0, columns - 1);
	var z0 := clampi(int(floor(bounds.position.y / spacing.y)), 0, rows - 1);
	var z1 := clampi(int(floor(bounds.end.y / spacing.y)), 0, rows - 1);
	for region in regions:
		for z in range(z0, z1 + 1):
			for x in range(x0, x1 + 1):
				for half in 2:
					var t := (z * columns + x) * 2 + half;
					if region["mask"][t] == 0:
						continue;
					var submerged := clip_below(triangle_points(t, terrain), float(region["level"]));
					if submerged.size() >= 3 and not Geometry2D.intersect_polygons(footprint, submerged).is_empty():
						return String(region["id"]);
	return "";


static func _bounds(poly: PackedVector2Array) -> Rect2:
	var small := poly[0];
	var large := poly[0];
	for p in poly:
		small.x = minf(small.x, p.x);
		small.y = minf(small.y, p.y);
		large.x = maxf(large.x, p.x);
		large.y = maxf(large.y, p.y);
	return Rect2(small, large - small);
