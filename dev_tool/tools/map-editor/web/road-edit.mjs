/** Pure road-document history: a drag is previewed outside this class, then committed once. */
const clone = value => structuredClone(value);
const serialize = value => JSON.stringify(value);

export function validateRoads(roads, size) {
  if (!Array.isArray(roads)) throw new Error('Roads must be an array');
  const seen = new Set();
  let total = 0;
  for (const road of roads) {
    if (!road || typeof road !== 'object' || Array.isArray(road) ||
        Object.keys(road).sort().join(',') !== 'definition,id,points,width' ||
        typeof road.id !== 'string' || !road.id.trim() ||
        typeof road.definition !== 'string' || !road.definition.trim() ||
        seen.has(road.id)) throw new Error('Road ID/definition must be unique and non-empty');
    seen.add(road.id);
    if (!Number.isFinite(road.width) || road.width <= 0) throw new Error('Road width must be positive');
    if (!Array.isArray(road.points) || road.points.length < 2) throw new Error('Road needs at least two points');
    total += road.points.length;
    if (total > 20000) throw new Error('Editing limit: 20,000 road points');
    for (let i = 0; i < road.points.length; i++) {
      const point = road.points[i];
      if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite) ||
          point[0] < 0 || point[1] < 0 || point[0] > size[0] || point[1] > size[1]) {
        throw new Error('Road points must be finite and inside the terrain');
      }
      if (i && Math.hypot(point[0] - road.points[i - 1][0], point[1] - road.points[i - 1][1]) < 1e-8) {
        throw new Error('Adjacent road points must not coincide');
      }
    }
  }
  return roads;
}

export function nearestSegment(points, point) {
  let best = { index: -1, distance: Infinity };
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.min(1, Math.max(0, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / (dx * dx + dz * dz)));
    const distance = Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dz);
    if (distance < best.distance) best = { index: i, distance };
  }
  return best;
}

export class RoadEdits {
  #roads;
  #saved;
  #undo = [];
  #redo = [];
  #size;
  constructor(roads, size) {
    this.#size = [...size];
    this.#roads = clone(validateRoads(roads, size));
    this.#saved = serialize(this.#roads);
  }
  get roads() { return clone(this.#roads); }
  get isDirty() { return serialize(this.#roads) !== this.#saved; }
  get canUndo() { return this.#undo.length > 0; }
  get canRedo() { return this.#redo.length > 0; }
  markSaved(snapshot) { this.#saved = serialize(validateRoads(snapshot, this.#size)); }
  commit(roads) {
    const next = clone(validateRoads(roads, this.#size));
    if (serialize(next) === serialize(this.#roads)) return false;
    this.#undo.push(this.#roads);
    if (this.#undo.length > 100) this.#undo.shift();
    this.#roads = next;
    this.#redo = [];
    return true;
  }
  undo() {
    if (!this.canUndo) return false;
    this.#redo.push(this.#roads);
    this.#roads = this.#undo.pop();
    return true;
  }
  redo() {
    if (!this.canRedo) return false;
    this.#undo.push(this.#roads);
    this.#roads = this.#redo.pop();
    return true;
  }
}
