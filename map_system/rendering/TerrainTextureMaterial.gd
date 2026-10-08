class_name TerrainTextureMaterial
extends RefCounted;


# The index texture contains the *categorical* surface IDs as 8-bit values.
# Shader blending happens per pixel, independently of terrain mesh density.
const TEXTURE_SIZE := 128;
const TILE_SCALE := 0.35;

const TERRAIN_SHADER := """
shader_type spatial;
render_mode cull_back, depth_draw_opaque;

uniform sampler2D surface_indices : filter_nearest, repeat_disable;
uniform sampler2DArray layer_albedos : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform vec2 terrain_size = vec2(1.0);
uniform vec2 cell_count = vec2(1.0);
uniform float tiles_per_meter = 0.35;

int definition_at(ivec2 cell) {
	return int(round(texelFetch(surface_indices, cell, 0).r * 255.0));
}

vec3 layer_color(vec2 position, int index) {
	return texture(layer_albedos, vec3(position * tiles_per_meter, float(index))).rgb;
}

void fragment() {
	// Surface pixels describe cells, so their centers live at (cell + 0.5).
	// This reproduces TerrainSurfaceField.blend_weights_at() at fragment resolution.
	vec2 sample_position = clamp(
		(UV / terrain_size) * cell_count - vec2(0.5),
		vec2(0.0),
		cell_count - vec2(1.0)
	);
	ivec2 a = ivec2(floor(sample_position));
	ivec2 b = min(a + ivec2(1), ivec2(cell_count) - ivec2(1));
	vec2 t = fract(sample_position);

	vec3 top = mix(
		layer_color(UV, definition_at(a)),
		layer_color(UV, definition_at(ivec2(b.x, a.y))),
		t.x
	);
	vec3 bottom = mix(
		layer_color(UV, definition_at(ivec2(a.x, b.y))),
		layer_color(UV, definition_at(b)),
		t.x
	);
	ALBEDO = mix(top, bottom, t.y);
	ROUGHNESS = 0.98;
}
""";


static func create(
	surface_field: TerrainSurfaceField,
	texture_provider: Callable = Callable()
) -> ShaderMaterial:
	var definitions := surface_field.get_definitions();
	var layers: Array[Image] = [];
	var dimensions := Vector2i.ZERO;

	for index in range(definitions.size()):
		var image: Image;
		if texture_provider.is_valid():
			var provided: Variant = texture_provider.call(String(definitions[index]));
			if not (provided is Texture2D):
				push_error("Terrain texture provider must return Texture2D for %s." % definitions[index]);
				return null;
			image = (provided as Texture2D).get_image();
			if image == null or image.is_empty():
				push_error("Could not read terrain texture: %s." % definitions[index]);
				return null;
			image = image.duplicate() as Image;
		else:
			image = _default_texture(String(definitions[index]), index);

		var size := Vector2i(image.get_width(), image.get_height());
		if dimensions == Vector2i.ZERO:
			dimensions = size;
		elif size != dimensions:
			push_error(
				"Terrain layer textures must share a size: %s has %s, expected %s."
				% [definitions[index], size, dimensions]
			);
			return null;

		image.convert(Image.FORMAT_RGBA8);
		if image.generate_mipmaps() != OK:
			push_error("Could not generate mipmaps for terrain texture: %s." % definitions[index]);
			return null;
		layers.append(image);

	var texture_array := Texture2DArray.new();
	if texture_array.create_from_images(layers) != OK:
		push_error("Could not create terrain albedo texture array.");
		return null;

	var shader := Shader.new();
	shader.code = TERRAIN_SHADER;
	var material := ShaderMaterial.new();
	material.shader = shader;
	material.set_shader_parameter("surface_indices", surface_field.create_index_texture());
	material.set_shader_parameter("layer_albedos", texture_array);
	material.set_shader_parameter("terrain_size", surface_field.get_world_size());
	material.set_shader_parameter("cell_count", Vector2(surface_field.get_cell_count()));
	material.set_shader_parameter("tiles_per_meter", TILE_SCALE);
	return material;


static func _default_texture(definition: String, index: int) -> Image:
	var base := Color(0.32, 0.36, 0.28);
	if definition.ends_with(".dirt"):
		base = Color(0.40, 0.29, 0.19);
	elif definition.ends_with(".rock"):
		base = Color(0.40, 0.41, 0.41);
	elif definition.ends_with(".sand"):
		base = Color(0.53, 0.46, 0.31);
	elif definition.ends_with(".moss"):
		base = Color(0.24, 0.37, 0.23);

	var image := Image.create_empty(TEXTURE_SIZE, TEXTURE_SIZE, false, Image.FORMAT_RGBA8);
	for z in range(TEXTURE_SIZE):
		for x in range(TEXTURE_SIZE):
			var n := (
				0.55 * _tile_noise(x, z, 4, index) +
				0.30 * _tile_noise(x, z, 16, index + 71) +
				0.15 * _tile_noise(x, z, 48, index + 131)
			);
			var variation := 0.76 + n * 0.48;
			image.set_pixel(x, z, Color(
				clampf(base.r * variation, 0.0, 1.0),
				clampf(base.g * variation, 0.0, 1.0),
				clampf(base.b * variation, 0.0, 1.0),
				1.0
			));
	return image;


static func _tile_noise(x: int, z: int, frequency: int, seed: int) -> float:
	var px := float(x) * float(frequency) / float(TEXTURE_SIZE);
	var pz := float(z) * float(frequency) / float(TEXTURE_SIZE);
	var x0 := int(floor(px));
	var z0 := int(floor(pz));
	var tx := px - float(x0);
	var tz := pz - float(z0);
	tx = tx * tx * (3.0 - 2.0 * tx);
	tz = tz * tz * (3.0 - 2.0 * tz);
	var a := lerpf(_hash(posmod(x0, frequency), posmod(z0, frequency), seed),
		_hash(posmod(x0 + 1, frequency), posmod(z0, frequency), seed), tx);
	var b := lerpf(_hash(posmod(x0, frequency), posmod(z0 + 1, frequency), seed),
		_hash(posmod(x0 + 1, frequency), posmod(z0 + 1, frequency), seed), tx);
	return lerpf(a, b, tz);


static func _hash(x: int, z: int, seed: int) -> float:
	var value := (x * 374761393 + z * 668265263 + seed * 69069) & 0x7fffffff;
	value = ((value ^ (value >> 13)) * 1274126177) & 0x7fffffff;
	return float(value) / 2147483647.0;
