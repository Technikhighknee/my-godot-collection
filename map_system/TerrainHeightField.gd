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
	var image := Image.load_from_file(path);
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


func height_at(position: Vector2) -> float:
	var x := clampf(position.x, 0.0, _world_size.x) / _world_size.x * float(_image.get_width() - 1);
	var z := clampf(position.y, 0.0, _world_size.y) / _world_size.y * float(_image.get_height() - 1);

	var x0 := int(floor(x));
	var z0 := int(floor(z));
	var x1 := mini(x0 + 1, _image.get_width() - 1);
	var z1 := mini(z0 + 1, _image.get_height() - 1);
	var tx := x - float(x0);
	var tz := z - float(z0);

	var top := lerpf(_sample_height(x0, z0), _sample_height(x1, z0), tx);
	var bottom := lerpf(_sample_height(x0, z1), _sample_height(x1, z1), tx);
	return lerpf(top, bottom, tz);


func height_at_sample(x: int, z: int) -> float:
	assert(x >= 0 and x < _image.get_width());
	assert(z >= 0 and z < _image.get_height());
	return _sample_height(x, z);


func normal_at(position: Vector2) -> Vector3:
	var sample_step := Vector2(
		_world_size.x / float(_image.get_width() - 1),
		_world_size.y / float(_image.get_height() - 1)
	);
	var left_x := maxf(0.0, position.x - sample_step.x);
	var right_x := minf(_world_size.x, position.x + sample_step.x);
	var near_z := maxf(0.0, position.y - sample_step.y);
	var far_z := minf(_world_size.y, position.y + sample_step.y);

	var tangent_x := Vector3(
		right_x - left_x,
		height_at(Vector2(right_x, position.y)) - height_at(Vector2(left_x, position.y)),
		0.0
	);
	var tangent_z := Vector3(
		0.0,
		height_at(Vector2(position.x, far_z)) - height_at(Vector2(position.x, near_z)),
		far_z - near_z
	);

	return tangent_z.cross(tangent_x).normalized();


func slope_at(position: Vector2) -> float:
	return rad_to_deg(acos(clampf(normal_at(position).y, -1.0, 1.0)));


func _sample_height(x: int, z: int) -> float:
	return lerpf(_min_height, _max_height, _image.get_pixel(x, z).r);
