/** Exact picking of the two heightfield triangles in each traversed grid cell.
 * Avoids Three.js Mesh.raycast's linear scan over the entire terrain mesh.
 * Coordinates, triangle diagonal and height interpolation match mesh-data.mjs.
 */
export function intersectTerrainRay(terrain, height, origin, direction) {
  const { width, height: rows, data } = height;
  const [sizeX, sizeZ] = terrain.size;
  if (width < 2 || rows < 2 || sizeX <= 0 || sizeZ <= 0) return null;
  const stepX = sizeX / (width - 1), stepZ = sizeZ / (rows - 1);
  const [ox, oy, oz] = origin, [vx, vy, vz] = direction;
  let enter = 0, exit = Infinity;
  for (const [p, v, size] of [[ox, vx, sizeX], [oz, vz, sizeZ]]) {
    if (Math.abs(v) < 1e-14) { if (p < 0 || p > size) return null; continue; }
    const a = -p / v, b = (size - p) / v;
    enter = Math.max(enter, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
  }
  if (exit < enter || exit < 0) return null;
  let cx = Math.max(0, Math.min(width - 2, Math.floor((ox + enter * vx) / stepX)));
  let cz = Math.max(0, Math.min(rows - 2, Math.floor((oz + enter * vz) / stepZ)));
  const advanceX = vx > 0 ? 1 : vx < 0 ? -1 : 0;
  const advanceZ = vz > 0 ? 1 : vz < 0 ? -1 : 0;
  const range = terrain.max_height - terrain.min_height;
  const read = i => terrain.min_height + data[i] * range;
  const tolerance = 1e-7;
  let current = enter;
  for (let n = 0; n <= width + rows + 2; n++) {
    const x0 = cx * stepX, z0 = cz * stepZ;
    const tx = advanceX ? ((cx + (advanceX > 0 ? 1 : 0)) * stepX - ox) / vx : Infinity;
    const tz = advanceZ ? ((cz + (advanceZ > 0 ? 1 : 0)) * stepZ - oz) / vz : Infinity;
    const boundary = Math.min(tx, tz, exit);
    const i = cz * width + cx;
    const a = read(i), b = read(i + 1), c = read(i + width), d = read(i + width + 1);
    // Plane 1: h00 + fx(h10-h00) + fz(h01-h00)
    // Plane 2: h11 + (1-fx)(h01-h11) + (1-fz)(h10-h11)
    const trials = [
      [a, b - a, c - a, true],
      [c + b - d, d - c, d - b, false],
    ];
    let best = Infinity;
    for (const [base, slopeX, slopeZ, lower] of trials) {
      const divisor = vy - slopeX * vx / stepX - slopeZ * vz / stepZ;
      if (Math.abs(divisor) < 1e-13) continue;
      const t = (base + slopeX * (ox - x0) / stepX + slopeZ * (oz - z0) / stepZ - oy) / divisor;
      if (t < current - tolerance || t > boundary + tolerance || t < -tolerance) continue;
      const fx = (ox + t * vx - x0) / stepX;
      const fz = (oz + t * vz - z0) / stepZ;
      if (fx < -tolerance || fz < -tolerance || fx > 1 + tolerance || fz > 1 + tolerance) continue;
      if (lower ? fx + fz > 1 + tolerance : fx + fz < 1 - tolerance) continue;
      if (t < best) best = t;
    }
    if (Number.isFinite(best)) return { point: { x: ox + vx * best, y: oy + vy * best, z: oz + vz * best }, distance: best };
    if (boundary >= exit || !Number.isFinite(boundary)) break;
    if (tx <= tz) cx += advanceX;
    if (tz <= tx) cz += advanceZ;
    if (cx < 0 || cx >= width - 1 || cz < 0 || cz >= rows - 1) break;
    current = boundary;
  }
  return null;
}
