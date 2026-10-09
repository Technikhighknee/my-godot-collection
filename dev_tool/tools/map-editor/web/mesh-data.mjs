/** Geometry math shared by the browser and headless tests. All coordinates match Godot (x, y, z). */
export function sampleHeight(terrain, image, x, z) {
  const [sx, sz] = terrain.size;
  const { width, height, data } = image;
  if (!Number.isFinite(x) || !Number.isFinite(z)) throw new Error('Expected finite world coordinates');
  const gx = Math.max(0, Math.min(sx, x)) / sx * (width - 1);
  const gz = Math.max(0, Math.min(sz, z)) / sz * (height - 1);
  const ix = Math.min(width - 2, Math.floor(gx)), iz = Math.min(height - 2, Math.floor(gz));
  const tx = gx - ix, tz = gz - iz;
  const read = (dx, dz) => terrain.min_height + data[(iz + dz) * width + ix + dx] * (terrain.max_height - terrain.min_height);
  const a = read(0, 0), b = read(1, 0), c = read(0, 1), d = read(1, 1);
  return tx + tz <= 1 ? a + tx * (b - a) + tz * (c - a) : d + (1 - tx) * (c - d) + (1 - tz) * (b - d);
}

export function buildTerrainGeometry(terrain, image) {
  const { width, height, data } = image;
  if (width < 2 || height < 2 || data.length !== width * height) throw new Error('Invalid height field');
  const positions = new Float32Array(width * height * 3);
  const indices = new Uint32Array((width - 1) * (height - 1) * 6);
  const worldRange = terrain.max_height - terrain.min_height;
  let p = 0, n = 0;
  for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
    positions[p++] = x / (width - 1) * terrain.size[0];
    positions[p++] = terrain.min_height + data[z * width + x] * worldRange;
    positions[p++] = z / (height - 1) * terrain.size[1];
  }
  // Three.js front-face orientation is counter-clockwise, opposite Godot's winding.
  for (let z = 0; z < height - 1; z++) for (let x = 0; x < width - 1; x++) {
    const a = z * width + x, b = a + 1, c = a + width, d = c + 1;
    indices[n++] = a; indices[n++] = c; indices[n++] = b;
    indices[n++] = b; indices[n++] = c; indices[n++] = d;
  }
  return { positions, indices };
}

/** Pixel nearest-cell lookup. Never treats a categorical index as interpolatable data. */
export function surfaceAt(terrain, surface, x, z) {
  const cx = Math.max(0, Math.min(surface.width - 1, Math.floor(x / terrain.size[0] * surface.width)));
  const cz = Math.max(0, Math.min(surface.height - 1, Math.floor(z / terrain.size[1] * surface.height)));
  return surface.data[cz * surface.width + cx];
}

export function paletteColor(definition) {
  if (definition.endsWith('.dirt')) return [0.42, 0.30, 0.19];
  if (definition.endsWith('.rock')) return [0.41, 0.43, 0.45];
  if (definition.endsWith('.sand')) return [0.58, 0.49, 0.34];
  if (definition.endsWith('.moss')) return [0.25, 0.40, 0.28];
  if (definition.endsWith('.grass')) return [0.32, 0.42, 0.28];
  // Stable fallback independent of palette ordering.
  let hash = 2166136261;
  for (let i = 0; i < definition.length; i++) hash = Math.imul(hash ^ definition.charCodeAt(i), 16777619);
  return [0.25 + ((hash >>> 16) & 255) / 1200, 0.27 + ((hash >>> 8) & 255) / 1200, 0.28 + (hash & 255) / 1200];
}

/** Vertex tint is a readable palette preview, not Godot's shader texture blend. */
export function makeVertexColors(terrain, image, surface, definitions) {
  const colors = new Float32Array(image.width * image.height * 3);
  const palette = definitions.map(paletteColor);
  let i = 0;
  for (let z = 0; z < image.height; z++) for (let x = 0; x < image.width; x++) {
    const worldX = x / (image.width - 1) * terrain.size[0];
    const worldZ = z / (image.height - 1) * terrain.size[1];
    const rgb = palette[surfaceAt(terrain, surface, worldX, worldZ)];
    colors[i++] = rgb[0]; colors[i++] = rgb[1]; colors[i++] = rgb[2];
  }
  return colors;
}
