class_name TerrainHeightField
extends RefCounted;


var _image: Image;
var _world_size: Vector2;
var _min_height: float;
var _max_height: float;


static func load_file(
	path: String,
	world_size: Vector2,
	min_height: float,
	max_height: float
) -> TerrainHeightField:
	var image := MapImageLoader.load(path);
	if image == null or image.is_empty():
		push_error("Could not load terrain heightmap: %s" % path);
		return null;

	if image.get_width() < 2 or image.get_height() < 2:
		push_error("Terrain heightmap must be at least 2x2 pixels: %s" % path);
		return null;

	if world_size.x <= 0.0 or world_size.y <= 0.0:
		push_error("Terrain world size must be positive.");
		return null;

	if max_height <= min_height:
		push_error("Terrain max_height must be greater than min_height.");
		return null;

	image.convert(Image.FORMAT_RF);
	return TerrainHeightField.new(image, world_size, min_height, max_height);


func _init(
	image: Image,
	world_size: Vector2,
	min_height: float,
	max_height: float
) -> void:
	_image = image;
	_world_size = world_size;
	_min_height = min_height;
	_max_height = max_height;


func get_world_size() -> Vector2:
	return _world_size;


func get_sample_count() -> Vector2i:
	return Vector2i(_image.get_width(), _image.get_height());


func get_sample_spacing() -> Vector2:
	return Vector2(
		_world_size.x / float(_image.get_width() - 1),
		_world_size.y / float(_image.get_height() - 1)
	);


func height_at(position: Vector2) -> float:
	var cell := _cell_at(position);
	var x0: int = cell["x"];
	var z0: int = cell["z"];
	var tx: float = cell["tx"];
	var tz: float = cell["tz"];

	var h00 := _sample_height(x0, z0);
	var h10 := _sample_height(x0 + 1, z0);
	var h01 := _sample_height(x0, z0 + 1);
	var h11 := _sample_height(x0 + 1, z0 + 1);

	if tx + tz <= 1.0:
		return h00 + tx * (h10 - h00) + tz * (h01 - h00);

	return h11 + (1.0 - tx) * (h01 - h11) + (1.0 - tz) * (h10 - h11);


func height_at_sample(x: int, z: int) -> float:
	assert(x >= 0 and x < _image.get_width());
	assert(z >= 0 and z < _image.get_height());
	return _sample_height(x, z);


func smooth_normal_at_sample(x: int, z: int) -> Vector3:
	assert(x >= 0 and x < _image.get_width());
	assert(z >= 0 and z < _image.get_height());

	var spacing := get_sample_spacing();
	var left := maxi(0, x - 1);
	var right := mini(_image.get_width() - 1, x + 1);
	var near := maxi(0, z - 1);
	var far := mini(_image.get_height() - 1, z + 1);

	var tangent_x := Vector3(
		float(right - left) * spacing.x,
		_sample_height(right, z) - _sample_height(left, z),
		0.0
	);
	var tangent_z := Vector3(
		0.0,
		_sample_height(x, far) - _sample_height(x, near),
		float(far - near) * spacing.y
	);
	return tangent_z.cross(tangent_x).normalized();


func normal_at(position: Vector2) -> Vector3:
	var cell := _cell_at(position);
	var x0: int = cell["x"];
	var z0: int = cell["z"];
	var tx: float = cell["tx"];
	var tz: float = cell["tz"];
	var spacing := get_sample_spacing();

	var top_left := Vector3(
		float(x0) * spacing.x,
		_sample_height(x0, z0),
		float(z0) * spacing.y
	);
	var top_right := Vector3(
		float(x0 + 1) * spacing.x,
		_sample_height(x0 + 1, z0),
		float(z0) * spacing.y
	);
	var bottom_left := Vector3(
		float(x0) * spacing.x,
		_sample_height(x0, z0 + 1),
		float(z0 + 1) * spacing.y
	);
	var bottom_right := Vector3(
		float(x0 + 1) * spacing.x,
		_sample_height(x0 + 1, z0 + 1),
		float(z0 + 1) * spacing.y
	);

	if tx + tz <= 1.0:
		return (bottom_left - top_left).cross(top_right - top_left).normalized();

	return (bottom_left - top_right).cross(bottom_right - top_right).normalized();


func slope_at(position: Vector2) -> float:
	return rad_to_deg(acos(clampf(normal_at(position).y, -1.0, 1.0)));


func _cell_at(position: Vector2) -> Dictionary:
	var sample_position := Vector2(
		clampf(position.x, 0.0, _world_size.x) / _world_size.x * float(_image.get_width() - 1),
		clampf(position.y, 0.0, _world_size.y) / _world_size.y * float(_image.get_height() - 1)
	);
	var x := mini(int(floor(sample_position.x)), _image.get_width() - 2);
	var z := mini(int(floor(sample_position.y)), _image.get_height() - 2);
	return {
		"x": x,
		"z": z,
		"tx": sample_position.x - float(x),
		"tz": sample_position.y - float(z),
	};


func _sample_height(x: int, z: int) -> float:
	return lerpf(_min_height, _max_height, _image.get_pixel(x, z).r);
