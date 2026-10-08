class_name GameMapBuilder
extends RefCounted;


const ROAD_Y_OFFSET := 0.02;


static func build(
	game_map: GameMap,
	parent: Node3D,
	building_spawner: Callable = Callable(),
	object_spawner: Callable = Callable()
) -> Node3D:
	if game_map == null:
		push_error("GameMapBuilder requires a loaded GameMap.");
		return null;

	if parent == null:
		push_error("GameMapBuilder requires a parent Node3D.");
		return null;

	var map_data := game_map.data;
	var errors := GameMapLoader.validate(map_data);
	if not errors.is_empty():
		push_error("Cannot build invalid map:\n- %s" % "\n- ".join(errors));
		return null;

	if not map_data["buildings"].is_empty() and not building_spawner.is_valid():
		push_error("Map contains buildings, but no building spawner was provided.");
		return null;

	if not map_data["objects"].is_empty() and not object_spawner.is_valid():
		push_error("Map contains objects, but no object spawner was provided.");
		return null;

	var root := Node3D.new();
	root.name = "Map";

	var terrain := _build_terrain(game_map.terrain);
	if terrain == null:
		root.free();
		return null;
	root.add_child(terrain);

	var roads := _build_roads(map_data["roads"], game_map.terrain);
	if roads == null:
		root.free();
		return null;
	root.add_child(roads);

	var buildings := Node3D.new();
	buildings.name = "Buildings";
	root.add_child(buildings);
	if not _spawn_entries(
		map_data["buildings"],
		buildings,
		building_spawner,
		game_map.terrain,
		"building"
	):
		root.free();
		return null;

	var objects := Node3D.new();
	objects.name = "Objects";
	root.add_child(objects);
	if not _spawn_entries(
		map_data["objects"],
		objects,
		object_spawner,
		game_map.terrain,
		"object"
	):
		root.free();
		return null;

	parent.add_child(root);
	return root;


static func _build_terrain(height_field: TerrainHeightField) -> Node3D:
	var size := height_field.get_world_size();
	var samples := height_field.get_sample_count();
	var surface := SurfaceTool.new();
	surface.begin(Mesh.PRIMITIVE_TRIANGLES);

	for z in range(samples.y):
		var z_ratio := float(z) / float(samples.y - 1);
		var world_z := z_ratio * size.y;
		for x in range(samples.x):
			var x_ratio := float(x) / float(samples.x - 1);
			var world_x := x_ratio * size.x;
			surface.set_uv(Vector2(x_ratio, z_ratio));
			surface.add_vertex(Vector3(
				world_x,
				height_field.height_at_sample(x, z),
				world_z
			));

	for z in range(samples.y - 1):
		for x in range(samples.x - 1):
			var top_left := z * samples.x + x;
			var top_right := top_left + 1;
			var bottom_left := top_left + samples.x;
			var bottom_right := bottom_left + 1;

			surface.add_index(top_left);
			surface.add_index(bottom_left);
			surface.add_index(top_right);

			surface.add_index(top_right);
			surface.add_index(bottom_left);
			surface.add_index(bottom_right);

	surface.generate_normals();
	var mesh := surface.commit();
	if mesh == null:
		push_error("Could not build terrain mesh.");
		return null;

	var root := Node3D.new();
	root.name = "Terrain";

	var visual := MeshInstance3D.new();
	visual.name = "Surface";
	visual.mesh = mesh;
	visual.material_override = _material(Color(0.32, 0.36, 0.28));
	root.add_child(visual);

	var body := StaticBody3D.new();
	body.name = "Collision";
	var collision := CollisionShape3D.new();
	collision.shape = mesh.create_trimesh_shape();
	body.add_child(collision);
	root.add_child(body);

	return root;


static func _build_roads(entries: Array, height_field: TerrainHeightField) -> Node3D:
	var root := Node3D.new();
	root.name = "Roads";

	for value in entries:
		var road: Dictionary = value;
		var centerline := _polygon(road["points"]);
		var polygons := Geometry2D.offset_polyline(
			centerline,
			float(road["width"]) * 0.5,
			Geometry2D.JOIN_MITER,
			Geometry2D.END_SQUARE
		);

		if polygons.is_empty():
			push_error("Could not build road geometry: %s" % road["id"]);
			root.free();
			return null;

		var surface := SurfaceTool.new();
		surface.begin(Mesh.PRIMITIVE_TRIANGLES);
		var triangle_count := 0;

		for polygon in polygons:
			triangle_count += _emit_terrain_conforming_road(
				surface,
				polygon,
				height_field
			);

		if triangle_count == 0:
			push_error("Road does not produce drawable geometry: %s" % road["id"]);
			root.free();
			return null;

		var mesh_instance := MeshInstance3D.new();
		mesh_instance.name = String(road["id"]);
		mesh_instance.mesh = surface.commit();
		mesh_instance.material_override = _material(Color(0.26, 0.23, 0.20));
		root.add_child(mesh_instance);

	return root;


static func _emit_terrain_conforming_road(
	surface: SurfaceTool,
	road_polygon: PackedVector2Array,
	height_field: TerrainHeightField
) -> int:
	var spacing := height_field.get_sample_spacing();
	var samples := height_field.get_sample_count();
	var bounds := _polygon_bounds(road_polygon);
	var min_x := clampi(int(floor(bounds.position.x / spacing.x)), 0, samples.x - 2);
	var max_x := clampi(int(floor(bounds.end.x / spacing.x)), 0, samples.x - 2);
	var min_z := clampi(int(floor(bounds.position.y / spacing.y)), 0, samples.y - 2);
	var max_z := clampi(int(floor(bounds.end.y / spacing.y)), 0, samples.y - 2);
	var triangle_count := 0;

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

			for terrain_triangle in terrain_triangles:
				var clipped_polygons := Geometry2D.intersect_polygons(
					road_polygon,
					terrain_triangle
				);

				for clipped in clipped_polygons:
					if clipped.size() < 3:
						continue;

					var indices := Geometry2D.triangulate_polygon(clipped);
					for index in range(0, indices.size(), 3):
						if _emit_road_triangle(
							surface,
							clipped[indices[index]],
							clipped[indices[index + 1]],
							clipped[indices[index + 2]],
							height_field
						):
							triangle_count += 1;

	return triangle_count;


static func _emit_road_triangle(
	surface: SurfaceTool,
	a: Vector2,
	b: Vector2,
	c: Vector2,
	height_field: TerrainHeightField
) -> bool:
	var a3 := Vector3(a.x, height_field.height_at(a) + ROAD_Y_OFFSET, a.y);
	var b3 := Vector3(b.x, height_field.height_at(b) + ROAD_Y_OFFSET, b.y);
	var c3 := Vector3(c.x, height_field.height_at(c) + ROAD_Y_OFFSET, c.y);
	var normal := (b3 - a3).cross(c3 - a3);

	if normal.length_squared() <= 0.0000001:
		return false;

	if normal.y < 0.0:
		var swap := b3;
		b3 = c3;
		c3 = swap;
		normal = -normal;

	normal = normal.normalized();
	for vertex in [a3, b3, c3]:
		surface.set_normal(normal);
		surface.add_vertex(vertex);

	return true;


static func _polygon_bounds(polygon: PackedVector2Array) -> Rect2:
	var min_point := polygon[0];
	var max_point := polygon[0];

	for point in polygon:
		min_point.x = minf(min_point.x, point.x);
		min_point.y = minf(min_point.y, point.y);
		max_point.x = maxf(max_point.x, point.x);
		max_point.y = maxf(max_point.y, point.y);

	return Rect2(min_point, max_point - min_point);


static func _spawn_entries(
	entries: Array,
	container: Node3D,
	spawner: Callable,
	height_field: TerrainHeightField,
	kind: String
) -> bool:
	for value in entries:
		var entry: Dictionary = value;
		var created: Variant = spawner.call(
			String(entry["definition"]),
			entry.duplicate(true)
		);

		if not (created is Node3D):
			push_error(
				"Spawner for %s %s (%s) must return a Node3D."
				% [kind, entry["id"], entry["definition"]]
			);
			return false;

		var node := created as Node3D;
		if node.get_parent() != null:
			push_error("Spawner returned an already-parented node for %s: %s" % [kind, entry["id"]]);
			return false;

		var position := _vec2(entry["position"]);
		node.name = String(entry["id"]);
		node.position = Vector3(
			position.x,
			height_field.height_at(position),
			position.y
		);
		node.rotation.y = deg_to_rad(float(entry["rotation"]));
		container.add_child(node);

	return true;


static func _material(color: Color) -> StandardMaterial3D:
	var material := StandardMaterial3D.new();
	material.albedo_color = color;
	material.roughness = 1.0;
	return material;


static func _polygon(value: Array) -> PackedVector2Array:
	var result := PackedVector2Array();
	for point in value:
		result.append(_vec2(point));
	return result;


static func _vec2(value: Array) -> Vector2:
	return Vector2(float(value[0]), float(value[1]));
