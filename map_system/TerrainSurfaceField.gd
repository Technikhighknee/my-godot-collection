class_name TerrainSurfaceField
extends RefCounted;


var _image: Image;
var _world_size: Vector2;
var _definitions: PackedStringArray;


static func load_file(
	path: String,
	world_size: Vector2,
	expected_cells: Vector2i,
	definitions: Array
) -> TerrainSurfaceField:
	var image := MapImageLoader.load(path);
	if image == null or image.is_empty():
		push_error("Could not load terrain surface map: %s" % path);
		return null;

	if image.get_width() != expected_cells.x or image.get_height() != expected_cells.y:
		push_error(
			"Terrain surface map must be %dx%d to match the heightmap cells, got %dx%d: %s"
			% [
				expected_cells.x,
				expected_cells.y,
				image.get_width(),
				image.get_height(),
				path,
			]
		);
		return null;

	var palette := PackedStringArray();
	for value in definitions:
		palette.append(String(value));

	image.convert(Image.FORMAT_L8);
	for y in range(image.get_height()):
		for x in range(image.get_width()):
			var surface_index := _pixel_index(image, x, y);
			if surface_index >= palette.size():
				push_error(
					"Terrain surface map uses palette index %d at (%d, %d), but only %d definitions exist: %s"
					% [surface_index, x, y, palette.size(), path]
				);
				return null;

	return TerrainSurfaceField.new(image, world_size, palette);


func _init(image: Image, world_size: Vector2, definitions: PackedStringArray) -> void:
	_image = image;
	_world_size = world_size;
	_definitions = definitions;


func get_cell_count() -> Vector2i:
	return Vector2i(_image.get_width(), _image.get_height());


func get_definitions() -> PackedStringArray:
	return _definitions.duplicate();


func index_at_cell(x: int, z: int) -> int:
	assert(x >= 0 and x < _image.get_width());
	assert(z >= 0 and z < _image.get_height());
	return _pixel_index(_image, x, z);


func blend_weights_at_sample(x: int, z: int) -> Dictionary:
	assert(x >= 0 and x <= _image.get_width());
	assert(z >= 0 and z <= _image.get_height());

	var weights := {};
	var contributing_cells := 0;

	for cell_z in range(z - 1, z + 1):
		if cell_z < 0 or cell_z >= _image.get_height():
			continue;

		for cell_x in range(x - 1, x + 1):
			if cell_x < 0 or cell_x >= _image.get_width():
				continue;

			var surface_index := index_at_cell(cell_x, cell_z);
			weights[surface_index] = int(weights.get(surface_index, 0)) + 1;
			contributing_cells += 1;

	for surface_index in weights.keys():
		weights[surface_index] = float(weights[surface_index]) / float(contributing_cells);

	return weights;


func definition_at(position: Vector2) -> String:
	var x := mini(
		int(floor(clampf(position.x, 0.0, _world_size.x) / _world_size.x * float(_image.get_width()))),
		_image.get_width() - 1
	);
	var z := mini(
		int(floor(clampf(position.y, 0.0, _world_size.y) / _world_size.y * float(_image.get_height()))),
		_image.get_height() - 1
	);
	return _definitions[index_at_cell(x, z)];


static func _pixel_index(image: Image, x: int, y: int) -> int:
	return clampi(int(round(image.get_pixel(x, y).r * 255.0)), 0, 255);
