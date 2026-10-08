class_name MapImageLoader
extends RefCounted;


static func load(path: String) -> Image:
	# Project resources must use Godot's import pipeline so they are available
	# after export. External map assets can still be loaded directly.
	if path.begins_with("res://"):
		var resource := ResourceLoader.load(path);
		if resource is Image:
			return (resource as Image).duplicate();

		if resource is Texture2D:
			var image := (resource as Texture2D).get_image();
			if image != null and not image.is_empty():
				return image;

		push_error("Map image did not import as an Image or Texture2D: %s" % path);
		return null;

	return Image.load_from_file(path);
