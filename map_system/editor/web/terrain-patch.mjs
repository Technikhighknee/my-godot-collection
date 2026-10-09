import { paletteColor, surfaceAt } from './mesh-data.mjs';

/** Apply just the touched terrain rows in-place; return GPU upload ranges in floats.
 * Height normals include one neighboring vertex because adjacent triangles share them.
 * The triangle winding is the same as buildTerrainGeometry() / Three.js.
 */
export function updateTerrainPatch(terrain, height, surface, definitions, positions, normals, colors, changes) {
  const width = height.width, rows = height.height;
  const result = { positions: [], normals: [], colors: [] };
  const rect = (box, xLimit, zLimit, extra = 0) => ({
    minX: Math.max(0, box.minX - extra), maxX: Math.min(xLimit - 1, box.maxX + extra),
    minZ: Math.max(0, box.minZ - extra), maxZ: Math.min(zLimit - 1, box.maxZ + extra),
  });
  const range = box => {
    const ranges = [];
    for (let z = box.minZ; z <= box.maxZ; z++)
      ranges.push([(z * width + box.minX) * 3, (box.maxX - box.minX + 1) * 3]);
    return ranges;
  };
  if (changes.height) {
    const box = rect(changes.height, width, rows);
    const heightRange = terrain.max_height - terrain.min_height;
    for (let z = box.minZ; z <= box.maxZ; z++)
      for (let x = box.minX; x <= box.maxX; x++) {
        const i = z * width + x;
        positions[i * 3 + 1] = terrain.min_height + height.data[i] * heightRange;
      }
    result.positions = range(box);
    const outer = rect(changes.height, width, rows, 1);
    for (let z = outer.minZ; z <= outer.maxZ; z++)
      for (let x = outer.minX; x <= outer.maxX; x++) {
        const index = z * width + x;
        let nx = 0, ny = 0, nz = 0;
        for (let cz = Math.max(0, z - 1); cz <= Math.min(rows - 2, z); cz++)
          for (let cx = Math.max(0, x - 1); cx <= Math.min(width - 2, x); cx++) {
            const a = cz * width + cx, b = a + 1, c = a + width, d = c + 1;
            for (const tri of [[a, c, b], [b, c, d]]) {
              if (!tri.includes(index)) continue;
              const [v0, v1, v2] = tri;
              const i0 = v0 * 3, i1 = v1 * 3, i2 = v2 * 3;
              const ax = positions[i1] - positions[i0], ay = positions[i1 + 1] - positions[i0 + 1], az = positions[i1 + 2] - positions[i0 + 2];
              const bx = positions[i2] - positions[i0], by = positions[i2 + 1] - positions[i0 + 1], bz = positions[i2 + 2] - positions[i0 + 2];
              nx += ay * bz - az * by;
              ny += az * bx - ax * bz;
              nz += ax * by - ay * bx;
            }
          }
        const magnitude = Math.hypot(nx, ny, nz) || 1;
        normals[index * 3] = nx / magnitude;
        normals[index * 3 + 1] = ny / magnitude;
        normals[index * 3 + 2] = nz / magnitude;
      }
    result.normals = range(outer);
  }
  if (changes.surface) {
    const box = rect({
      minX: changes.surface.minX, maxX: changes.surface.maxX + 1,
      minZ: changes.surface.minZ, maxZ: changes.surface.maxZ + 1,
    }, width, rows);
    const palette = definitions.map(paletteColor);
    for (let z = box.minZ; z <= box.maxZ; z++)
      for (let x = box.minX; x <= box.maxX; x++) {
        const worldX = x / (width - 1) * terrain.size[0];
        const worldZ = z / (rows - 1) * terrain.size[1];
        const rgb = palette[surfaceAt(terrain, surface, worldX, worldZ)];
        const i = (z * width + x) * 3;
        colors[i] = rgb[0]; colors[i + 1] = rgb[1]; colors[i + 2] = rgb[2];
      }
    result.colors = range(box);
  }
  return result;
}
