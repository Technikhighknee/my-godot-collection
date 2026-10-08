class_name GameMapBuilder
extends RefCounted;


const ROAD_Y_OFFSET := 0.02;
const TERRAIN_COLLISION_DEPTH := 0.2;


static func build(
	map_data: Dictionary,
	parent: Node3D,
	building_spawner: Callable = Callable(),
	object_spawner: Callable = Callable()
) -> Node3D:
	if parent == null:
		push_error("GameMapBuilder requires a parent Node3D.");
		return null;

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

	var terrain: Dictionary = map_data["terrain"];
	var map_size := _vec2(terrain["size"]);
	var height := float(terrain.get("height", 0.0));

	var root := Node3D.new();
	root.name = "Map";

	root.add_child(_build_terrain(map_size, height));

	var roads := _build_roads(map_data["roads"], height);
	if roads == null:
		root.free();
		return null;
	root.add_child(roads);

	var buildings := Node3D.new();
	buildings.name = "Buildings";
	root.add_child(buildings);
	if not _spawn_entries(map_data["buildings"], buildings, building_spawner, height, "building"):
		root.free();
		return null;

	var objects := Node3D.new();
	objects.name = "Objects";
	root.add_child(objects);
	if not _spawn_entries(map_data["objects"], objects, object_spawner, height, "object"):
		root.free();
		return null;

	parent.add_child(root);
	return root;


static func _build_terrain(size: Vector2, height: float) -> Node3D:
	var root := Node3D.new();
	root.name = "Terrain";

	var mesh := PlaneMesh.new();
	mesh.size = size;

	var visual := MeshInstance3D.new();
	visual.name = "Surface";
	visual.mesh = mesh;
	visual.position = Vector3(size.x * 0.5, height, size.y * 0.5);
	visual.material_override = _material(Color(0.32, 0.36, 0.28));
	root.add_child(visual);

	var body := StaticBody3D.new();
	body.name = "Collision";
	body.position = Vector3(
		size.x * 0.5,
		height - TERRAIN_COLLISION_DEPTH * 0.5,
		size.y * 0.5
	);

	var shape := BoxShape3D.new();
	shape.size = Vector3(size.x, TERRAIN_COLLISION_DEPTH, size.y);

	var collision := CollisionShape3D.new();
	collision.shape = shape;
	body.add_child(collision);
	root.add_child(body);

	return root;


static func _build_roads(entries: Array, height: float) -> Node3D:
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

		for polygon in polygons:
			var triangles := Geometry2D.triangulate_polygon(polygon);
			if triangles.is_empty():
				push_error("Could not triangulate road geometry: %s" % road["id"]);
				root.free();
				return null;

			# Geometry2D triangulates counter-clockwise in XY. Mapping its Y to
			# world Z flips the winding, so emit each triangle in reverse order.
			for triangle_index in range(0, triangles.size(), 3):
				for offset in [0, 2, 1]:
					var vertex_index := triangles[triangle_index + offset];
					var point: Vector2 = polygon[vertex_index];
					surface.set_normal(Vector3.UP);
					surface.add_vertex(Vector3(point.x, height + ROAD_Y_OFFSET, point.y));

		var mesh_instance := MeshInstance3D.new();
		mesh_instance.name = String(road["id"]);
		mesh_instance.mesh = surface.commit();
		mesh_instance.material_override = _material(Color(0.26, 0.23, 0.20));
		root.add_child(mesh_instance);

	return root;


static func _spawn_entries(
	entries: Array,
	container: Node3D,
	spawner: Callable,
	height: float,
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
		node.position = Vector3(position.x, height, position.y);
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
