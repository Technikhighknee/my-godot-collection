// Geometry for map-space, closed polygons. No implicit closing vertex in the JSON.
const finite = n => typeof n === 'number' && Number.isFinite(n);
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const same = (a, b) => a[0] === b[0] && a[1] === b[1];

function segmentsMeet(a, b, c, d) {
  const eps = 1e-10;
  const abC = cross(a, b, c), abD = cross(a, b, d);
  const cdA = cross(c, d, a), cdB = cross(c, d, b);
  const on = (p, q, v) => Math.abs(cross(p, q, v)) <= eps &&
    v[0] >= Math.min(p[0], q[0]) - eps && v[0] <= Math.max(p[0], q[0]) + eps &&
    v[1] >= Math.min(p[1], q[1]) - eps && v[1] <= Math.max(p[1], q[1]) + eps;
  return ((abC > eps && abD < -eps || abC < -eps && abD > eps) &&
    (cdA > eps && cdB < -eps || cdA < -eps && cdB > eps)) ||
    on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b);
}

export function validatePolygon(points, size) {
  if (!Array.isArray(points) || points.length < 3) throw new Error('Invalid polygon: at least three vertices required');
  for (const point of points) {
    if (!Array.isArray(point) || point.length !== 2 || !point.every(finite) || point[0] < 0 || point[1] < 0 || point[0] > size[0] || point[1] > size[1]) {
      throw new Error('Invalid polygon: vertex outside map bounds or non-finite');
    }
  }
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (same(a, b)) throw new Error('Invalid polygon: adjacent duplicate vertices');
    area += a[0] * b[1] - b[0] * a[1];
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      if (segmentsMeet(a, b, points[j], points[(j + 1) % points.length])) {
        throw new Error('Invalid polygon: self-intersection or touching nonadjacent edges');
      }
    }
  }
  if (Math.abs(area) < 1e-9) throw new Error('Invalid polygon: zero area');
  return points;
}

const hasOnly = (entry, keys) => Object.keys(entry).every(k => keys.includes(k)) && keys.every(k => Object.hasOwn(entry, k));
const nonEmpty = s => typeof s === 'string' && s.trim().length > 0;

export function validatePolygons(kind, entries, size, occupiedIds = []) {
  if (!['water', 'settlements'].includes(kind) || !Array.isArray(entries)) throw new Error('Invalid polygon collection');
  const ids = new Set(occupiedIds);
  for (const item of entries) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || !nonEmpty(item.id) || ids.has(item.id)) {
      throw new Error('Invalid polygon: missing or duplicate ID');
    }
    ids.add(item.id);
    if (kind === 'water') {
      if (!hasOnly(item, ['id', 'definition', 'height', 'polygon']) || !nonEmpty(item.definition) || !finite(item.height)) {
        throw new Error('Invalid water properties');
      }
      validatePolygon(item.polygon, size);
    } else {
      if (!hasOnly(item, ['id', 'name', 'build_areas']) || !nonEmpty(item.name) || !Array.isArray(item.build_areas) || item.build_areas.length === 0) {
        throw new Error('Invalid settlement properties');
      }
      for (const area of item.build_areas) validatePolygon(area, size);
    }
  }
  return entries;
}

export function newPolygonId(kind, occupiedIds = []) {
  if (!['water', 'settlements'].includes(kind)) throw new Error('Invalid polygon collection');
  const used = new Set(occupiedIds), prefix = kind === 'water' ? 'water_' : 'settlement_';
  let n = 1;
  while (used.has(prefix + String(n).padStart(3, '0'))) n++;
  return prefix + String(n).padStart(3, '0');
}

export function nearestPolygonEdge(points, point) {
  let index = -1, distance = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const lengthSq = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / lengthSq));
    const d = Math.hypot(point[0] - (a[0] + dx * t), point[1] - (a[1] + dz * t));
    if (d < distance) { distance = d; index = i; }
  }
  return { index, distance };
}
