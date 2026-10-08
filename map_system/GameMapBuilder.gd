class_name GameMapBuilder
extends RefCounted;


const ROAD_Y_OFFSET := 0.02;


static func build(
	game_map: GameMap,
	parent: Node3D,
	building_spawner: Callable = Callable(),
	object_spawner: Callable = Callable(),
	material_provider: Callable = Callable()
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

	var terrain := _build_terrain(
		game_map.terrain,
		game_map.terrain_surfaces,
		material_provider
	);
	if terrain == null:
		root.free();
		return null;
	root.add_child(terrain);

	var roads := _build_roads(map_data["roads"], game_map.terrain, material_provider);
	if roads == null:
		root.free();
		return null;
	root.add_child(roads);

	var water := _build_water(map_data["water"], material_provider);
	if water == null:
		root.free();
		return null;
	root.add_child(water);

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


static func _build_terrain(
	height_field: TerrainHeightField,
	surface_field: TerrainSurfaceField,
	material_provider: Callable
) -> Node3D:
	var root := Node3D.new();
	root.name = "Terrain";

	var collision_mesh := _build_terrain_collision_mesh(height_field);
	if collision_mesh == null:
		root.free();
		return null;

	var visuals: Node3D;
	if material_provider.is_valid():
		visuals = _build_terrain_surfaces(height_field, surface_field, material_provider);
	else:
		visuals = _build_blended_debug_terrain(height_field, surface_field);
	if visuals == null:
		root.free();
		return null;
	root.add_child(visuals);

	var body := StaticBody3D.new();
	body.name = "Collision";
	var collision := CollisionShape3D.new();
	collision.shape = collision_mesh.create_trimesh_shape();
	body.add_child(collision);
	root.add_child(body);

	return root;


static func _build_terrain_collision_mesh(height_field: TerrainHeightField) -> ArrayMesh:
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
			surface.add_index(top_right);
			surface.add_index(bottom_left);

			surface.add_index(top_right);
			surface.add_index(bottom_right);
			surface.add_index(bottom_left);

	var mesh := surface.commit();
	if mesh == null:
		push_error("Could not build terrain collision mesh.");
		return null;
	return mesh;


static func _build_blended_debug_terrain(
	height_field: TerrainHeightField,
	surface_field: TerrainSurfaceField
) -> Node3D:
	var root := Node3D.new();
	root.name = "Surfaces";
	var size := height_field.get_world_size();
	var samples := height_field.get_sample_count();
	var surface := SurfaceTool.new();
	surface.begin(Mesh.PRIMITIVE_TRIANGLES);

	for z in range(samples.y):
		for x in range(samples.x):
			var x_ratio := float(x) / float(samples.x - 1);
			var z_ratio := float(z) / float(samples.y - 1);
			var world_x := x_ratio * size.x;
			var world_z := z_ratio * size.y;
			surface.set_color(_blended_debug_terrain_color(surface_field, x, z));
			surface.set_uv(Vector2(world_x, world_z));
			surface.set_normal(height_field.smooth_normal_at_sample(x, z));
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
			surface.add_index(top_right);
			surface.add_index(bottom_left);

			surface.add_index(top_right);
			surface.add_index(bottom_right);
			surface.add_index(bottom_left);

	var mesh := surface.commit();
	if mesh == null:
		push_error("Could not build blended debug terrain.");
		root.free();
		return null;

	var material := StandardMaterial3D.new();
	material.vertex_color_use_as_albedo = true;
	material.roughness = 1.0;

	var visual := MeshInstance3D.new();
	visual.name = "BlendedDebugSurface";
	visual.mesh = mesh;
	visual.material_override = material;
	root.add_child(visual);
	return root;


static func _blended_debug_terrain_color(
	surface_field: TerrainSurfaceField,
	x: int,
	z: int
) -> Color:
	var result := Color(0.0, 0.0, 0.0, 1.0);
	for surface_index in surface_field.blend_weights_at_sample(x, z):
		var weight: float = surface_field.blend_weights_at_sample(x, z)[surface_index];
		result += _debug_terrain_color(int(surface_index)) * weight;
	result.a = 1.0;
	return result;


static func _debug_terrain_color(surface_index: int) -> Color:
	var colors := [
		Color(0.32, 0.36, 0.28),
		Color(0.38, 0.29, 0.20),
		Color(0.38, 0.39, 0.40),
		Color(0.47, 0.43, 0.29),
		Color(0.24, 0.36, 0.24),
	];
	return colors[surface_index % colors.size()];


static func _build_terrain_surfaces(
	height_field: TerrainHeightField,
	surface_field: TerrainSurfaceField,
	material_provider: Callable
) -> Node3D:
	var root := Node3D.new();
	root.name = "Surfaces";
	var definitions := surface_field.get_definitions();
	var size := height_field.get_world_size();
	var samples := height_field.get_sample_count();

	for surface_index in range(definitions.size()):
		var surface := SurfaceTool.new();
		surface.begin(Mesh.PRIMITIVE_TRIANGLES);
		var cell_count := 0;

		for z in range(samples.y - 1):
			for x in range(samples.x - 1):
				if surface_field.index_at_cell(x, z) != surface_index:
					continue;
				_emit_terrain_cell(surface, height_field, x, z, size, samples);
				cell_count += 1;

		if cell_count == 0:
			continue;

		var mesh := surface.commit();
		if mesh == null:
			push_error("Could not build terrain surface: %s" % definitions[surface_index]);
			root.free();
			return null;

		var material := _resolve_material(
			"terrain",
			String(definitions[surface_index]),
			surface_index,
			material_provider
		);
		if material == null:
			root.free();
			return null;

		var visual := MeshInstance3D.new();
		visual.name = String(definitions[surface_index]).replace(".", "_");
		visual.mesh = mesh;
		visual.material_override = material;
		root.add_child(visual);

	return root;


static func _emit_terrain_cell(
	surface: SurfaceTool,
	height_field: TerrainHeightField,
	x: int,
	z: int,
	world_size: Vector2,
	samples: Vector2i
) -> void:
	var points := [
		Vector2i(x, z),
		Vector2i(x + 1, z),
		Vector2i(x, z + 1),
		Vector2i(x + 1, z + 1),
	];
	var order := [0, 1, 2, 1, 3, 2];

	for point_index in order:
		var point: Vector2i = points[point_index];
		var x_ratio := float(point.x) / float(samples.x - 1);
		var z_ratio := float(point.y) / float(samples.y - 1);
		var world_x := x_ratio * world_size.x;
		var world_z := z_ratio * world_size.y;
		surface.set_uv(Vector2(world_x, world_z));
		surface.set_normal(height_field.smooth_normal_at_sample(point.x, point.y));
		surface.add_vertex(Vector3(
			world_x,
			height_field.height_at_sample(point.x, point.y),
			world_z
		));


static func _resolve_material(
	kind: String,
	definition: String,
	debug_index: int,
	provider: Callable
) -> Material:
	if provider.is_valid():
		var created: Variant = provider.call(kind, definition);
		if created is Material:
			return created as Material;
		push_error(
			"Material provider must return a Material for %s definition: %s"
			% [kind, definition]
		);
		return null;

	if kind == "terrain":
		return _material(_debug_terrain_color(debug_index));
	if kind == "road":
		return _material(Color(0.26, 0.23, 0.20));
	return _material(Color(0.16, 0.35, 0.48));


static func _build_roads(
	entries: Array,
	height_field: TerrainHeightField,
	material_provider: Callable
) -> Node3D:
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
		var material := _resolve_material(
			"road",
			String(road["definition"]),
			0,
			material_provider
		);
		if material == null:
			root.free();
			return null;
		mesh_instance.material_override = material;
		root.add_child(mesh_instance);

	return root;


static func _emit_terrain_conforming_road(
	surface: SurfaceTool,
	road_polygon: PackedVector2Array,
	height_field: TerrainHeightField
) -> int:
	var triangle_count := 0;

	for clipped in TerrainGeometry.clip_polygon_to_grid(road_polygon, height_field):
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

	# Godot's front face is clockwise. Keep the rendered triangle clockwise,
	# while the explicit shading normal still points away from the terrain.
	if normal.y > 0.0:
		var swap := b3;
		b3 = c3;
		c3 = swap;
		normal = -normal;

	var shading_normal := -normal.normalized();
	for vertex in [a3, b3, c3]:
		surface.set_uv(Vector2(vertex.x, vertex.z));
		surface.set_normal(shading_normal);
		surface.add_vertex(vertex);

	return true;


static func _build_water(entries: Array, material_provider: Callable) -> Node3D:
	var root := Node3D.new();
	root.name = "Water";

	for value in entries:
		var entry: Dictionary = value;
		var polygon := _polygon(entry["polygon"]);
		var indices := Geometry2D.triangulate_polygon(polygon);
		if indices.is_empty():
			push_error("Could not triangulate water geometry: %s" % entry["id"]);
			root.free();
			return null;

		var surface := SurfaceTool.new();
		surface.begin(Mesh.PRIMITIVE_TRIANGLES);
		var height := float(entry["height"]);

		for index in range(0, indices.size(), 3):
			var points := [
				polygon[indices[index]],
				polygon[indices[index + 1]],
				polygon[indices[index + 2]],
			];
			var vertices := [
				Vector3(points[0].x, height, points[0].y),
				Vector3(points[1].x, height, points[1].y),
				Vector3(points[2].x, height, points[2].y),
			];
			var normal: Vector3 = (vertices[1] - vertices[0]).cross(vertices[2] - vertices[0]);
			if normal.y > 0.0:
				var swap: Vector3 = vertices[1];
				vertices[1] = vertices[2];
				vertices[2] = swap;

			for vertex in vertices:
				surface.set_uv(Vector2(vertex.x, vertex.z));
				surface.set_normal(Vector3.UP);
				surface.add_vertex(vertex);

		var mesh_instance := MeshInstance3D.new();
		mesh_instance.name = String(entry["id"]);
		mesh_instance.mesh = surface.commit();
		var material := _resolve_material(
			"water",
			String(entry["definition"]),
			0,
			material_provider
		);
		if material == null:
			root.free();
			return null;
		mesh_instance.material_override = material;
		root.add_child(mesh_instance);

	return root;


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
