import { validateRoads } from './road-edit.mjs';
import { sampleHeight } from './mesh-data.mjs';
import { validateEntities } from './entity-edit.mjs';
import { validatePolygons } from './polygon-edit.mjs';

const clone = value => structuredClone(value);
const clamp = (value, a, b) => Math.max(a, Math.min(b, value));

/** Modifies only grid samples/cells inside the world-space brush circle. */
export function dab(doc, kind, x, z, radius, strength, surfaceIndex, flattenHeight, changed) {
  const { terrain } = doc.map;
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(radius) || radius <= 0 ||
      !Number.isFinite(strength) || strength <= 0 || strength > 50 ||
      !['raise', 'lower', 'smooth', 'flatten', 'paint'].includes(kind)) throw new Error('Invalid brush parameters');
  if (kind === 'paint' && (!Number.isInteger(surfaceIndex) || surfaceIndex < 0 || surfaceIndex >= terrain.surface_palette.length)) throw new Error('Invalid surface index');
  const paint = kind === 'paint', image = paint ? doc.surface : doc.height;
  const width = image.width, height = image.height, sx = terrain.size[0], sz = terrain.size[1];
  const dx = sx / (paint ? width : width - 1), dz = sz / (paint ? height : height - 1);
  const minX = clamp(Math.ceil((x - radius) / dx - (paint ? 0.5 : 0)), 0, width - 1);
  const maxX = clamp(Math.floor((x + radius) / dx - (paint ? 0.5 : 0)), 0, width - 1);
  const minZ = clamp(Math.ceil((z - radius) / dz - (paint ? 0.5 : 0)), 0, height - 1);
  const maxZ = clamp(Math.floor((z + radius) / dz - (paint ? 0.5 : 0)), 0, height - 1);
  const range = terrain.max_height - terrain.min_height;
  const snapX = Math.max(0, minX - 1), snapZ = Math.max(0, minZ - 1);
  const snapWidth = Math.min(width - 1, maxX + 1) - snapX + 1;
  const snapHeight = Math.min(height - 1, maxZ + 1) - snapZ + 1;
  const snapshot = kind === 'smooth' ? new Float32Array(snapWidth * snapHeight) : null;
  if (snapshot) for (let row = 0; row < snapHeight; row++)
    snapshot.set(image.data.subarray((snapZ + row) * width + snapX, (snapZ + row) * width + snapX + snapWidth), row * snapWidth);
  const nextValue = (value, i, cx, cz, falloff) => {
    if (paint) return surfaceIndex;
    if (kind === 'raise') return clamp(value + strength * falloff / range, 0, 1);
    if (kind === 'lower') return clamp(value - strength * falloff / range, 0, 1);
    if (kind === 'flatten') return clamp(value + (flattenHeight - value) * Math.min(1, strength / 5) * falloff, 0, 1);
    // Snapshot, never read a neighbor already modified by this dab.
    let sum = 0, n = 0;
    for (let zz = Math.max(0, cz - 1); zz <= Math.min(height - 1, cz + 1); zz++) {
      for (let xx = Math.max(0, cx - 1); xx <= Math.min(width - 1, cx + 1); xx++) { sum += snapshot[(zz - snapZ) * snapWidth + xx - snapX]; n++; }
    }
    return clamp(value + (sum / n - value) * Math.min(1, strength / 5) * falloff, 0, 1);
  };
  let count = 0;
  for (let cz = minZ; cz <= maxZ; cz++) for (let cx = minX; cx <= maxX; cx++) {
    const px = (cx + (paint ? 0.5 : 0)) * dx, pz = (cz + (paint ? 0.5 : 0)) * dz;
    const t = Math.hypot(px - x, pz - z) / radius;
    if (t > 1) continue;
    const falloff = paint ? 1 : (1 - t) ** 2 * (1 + 2 * t);
    const index = cz * width + cx, before = image.data[index];
    const value = nextValue(before, index, cx, cz, falloff);
    const after = paint ? value : Math.fround(value);
    if (before !== after) {
      image.data[index] = after;
      changed(paint ? 'surface' : 'height', index, before, after);
      count++;
    }
  }
  return count;
}

/** One unified, sparse, bounded history for road changes and terrain brush strokes. */
export class MapEdits {
  #doc;
  #roads;
  #savedRoads;
  #buildings;
  #objects;
  #savedEntities;
  #water;
  #settlements;
  #savedPolygons;
  #savedHeight;
  #savedSurface;
  #heightDirty = new Set();
  #surfaceDirty = new Set();
  #undo = [];
  #redo = [];
  #stroke = null;
  #undoCost = 0;
  constructor(doc) {
    this.#doc = doc;
    this.#roads = clone(validateRoads(doc.map.roads, doc.map.terrain.size));
    this.#savedRoads = JSON.stringify(this.#roads);
    this.#buildings = clone(validateEntities('buildings', doc.map.buildings ?? [], doc.map.terrain.size, [...doc.map.roads, ...(doc.map.settlements ?? []), ...(doc.map.water ?? []), ...(doc.map.objects ?? [])].map(x => x.id)));
    this.#objects = clone(validateEntities('objects', doc.map.objects ?? [], doc.map.terrain.size, [...doc.map.roads, ...(doc.map.settlements ?? []), ...(doc.map.water ?? []), ...(doc.map.buildings ?? [])].map(x => x.id)));
    this.#savedEntities = { buildings: JSON.stringify(this.#buildings), objects: JSON.stringify(this.#objects) };
    this.#water = clone(validatePolygons('water', doc.map.water ?? [], doc.map.terrain.size));
    this.#settlements = clone(validatePolygons('settlements', doc.map.settlements ?? [], doc.map.terrain.size));
    this.#savedPolygons = { water: JSON.stringify(this.#water), settlements: JSON.stringify(this.#settlements) };
    this.#savedHeight = doc.height.data.slice();
    this.#savedSurface = doc.surface.data.slice();
  }
  get roads() { return clone(this.#roads); }
  get buildings() { return clone(this.#buildings); }
  get objects() { return clone(this.#objects); }
  get water() { return clone(this.#water); }
  get settlements() { return clone(this.#settlements); }
  get polygonDirty() { return JSON.stringify(this.#water) !== this.#savedPolygons.water || JSON.stringify(this.#settlements) !== this.#savedPolygons.settlements; }
  get entityDirty() { return JSON.stringify(this.#buildings) !== this.#savedEntities.buildings || JSON.stringify(this.#objects) !== this.#savedEntities.objects; }
  get isDirty() { return this.roadDirty || this.entityDirty || this.polygonDirty || this.heightDirty || this.surfaceDirty; }
  get roadDirty() { return JSON.stringify(this.#roads) !== this.#savedRoads; }
  get heightDirty() { return this.#heightDirty.size > 0; }
  get surfaceDirty() { return this.#surfaceDirty.size > 0; }
  get canUndo() { return this.#undo.length > 0; }
  get canRedo() { return this.#redo.length > 0; }
  get painting() { return this.#stroke !== null; }
  #cost(entry) { return ['roads', 'buildings', 'objects', 'water', 'settlements'].includes(entry.kind) ? 20 : entry.changes.length; }
  #push(entry) {
    this.#undo.push(entry);
    this.#undoCost += this.#cost(entry);
    // A hundred large terrain strokes must not retain unbounded history memory.
    while (this.#undo.length > 100 || (this.#undoCost > 250000 && this.#undo.length > 1)) {
      this.#undoCost -= this.#cost(this.#undo.shift());
    }
    this.#redo.length = 0;
  }
  commit(roads) {
    if (this.#stroke) throw new Error('Finish brush stroke before editing roads');
    const next = clone(validateRoads(roads, this.#doc.map.terrain.size));
    if (JSON.stringify(next) === JSON.stringify(this.#roads)) return false;
    this.#push({ kind: 'roads', before: this.#roads, after: next });
    this.#roads = next;
    return true;
  }
  commitEntities(kind, entries) {
    if (this.#stroke) throw new Error('Finish brush stroke before editing entities');
    if (kind !== 'buildings' && kind !== 'objects') throw new Error('Invalid entity collection');
    const other = kind === 'buildings' ? this.#objects : this.#buildings;
    const occupied = [...this.#roads, ...this.#settlements, ...this.#water, ...other].map(x => x.id);
    const next = clone(validateEntities(kind, entries, this.#doc.map.terrain.size, occupied));
    const before = kind === 'buildings' ? this.#buildings : this.#objects;
    if (JSON.stringify(next) === JSON.stringify(before)) return false;
    this.#push({ kind, before, after: next });
    if (kind === 'buildings') this.#buildings = next; else this.#objects = next;
    return true;
  }
  commitPolygons(kind, entries) {
    if (this.#stroke) throw new Error('Finish brush stroke before editing polygons');
    if (kind !== 'water' && kind !== 'settlements') throw new Error('Invalid polygon collection');
    const other = kind === 'water' ? this.#settlements : this.#water;
    const occupied = [...this.#roads, ...this.#buildings, ...this.#objects, ...other].map(x => x.id);
    const next = clone(validatePolygons(kind, entries, this.#doc.map.terrain.size, occupied));
    const before = kind === 'water' ? this.#water : this.#settlements;
    if (JSON.stringify(next) === JSON.stringify(before)) return false;
    this.#push({ kind, before, after: next });
    if (kind === 'water') this.#water = next; else this.#settlements = next;
    return true;
  }
  beginStroke(kind, options, point) {
    if (this.#stroke) throw new Error('Brush stroke already active');
    const { radius, strength, surfaceIndex = 0 } = options;
    const terrain = this.#doc.map.terrain;
    const normalized = (sampleHeight(terrain, this.#doc.height, ...point) - terrain.min_height) / (terrain.max_height - terrain.min_height);
    this.#stroke = { kind, radius, strength, surfaceIndex, flattenHeight: normalized, changes: new Map(), previous: null, bounds: null };
    try { return this.strokeTo(point); }
    catch (error) { this.cancelStroke(); throw error; }
  }
  strokeTo(point, overrideKind = null) {
    const stroke = this.#stroke;
    if (!stroke) return false;
    const kind = overrideKind ?? stroke.kind;
    if (stroke.kind === 'paint' ? kind !== 'paint' : !['raise','lower','smooth','flatten'].includes(kind)) {
      throw new Error('Invalid mode for active brush stroke');
    }
    const from = stroke.previous ?? point;
    const distance = Math.hypot(point[0] - from[0], point[1] - from[1]);
    const steps = Math.max(1, Math.min(4096, Math.ceil(distance / Math.max(0.25, stroke.radius / 3))));
    let any = false;
    for (let n = 1; n <= steps; n++) {
      const x = from[0] + (point[0] - from[0]) * n / steps;
      const z = from[1] + (point[1] - from[1]) * n / steps;
      any = dab(this.#doc, kind, x, z, stroke.radius, stroke.strength, stroke.surfaceIndex, stroke.flattenHeight, (layer, index, before, after) => {
        const key = `${layer}:${index}`;
        const delta = stroke.changes.get(key);
        if (delta) delta.after = after;
        else stroke.changes.set(key, { layer, index, before, after });
        this.#updateDirty(layer, index, after);
        const width = layer === 'height' ? this.#doc.height.width : this.#doc.surface.width;
        const ix = index % width, iz = Math.floor(index / width);
        const b = stroke.bounds ?? (stroke.bounds = { layer, minX: ix, maxX: ix, minZ: iz, maxZ: iz });
        b.minX = Math.min(b.minX, ix); b.maxX = Math.max(b.maxX, ix);
        b.minZ = Math.min(b.minZ, iz); b.maxZ = Math.max(b.maxZ, iz);
      }) > 0 || any;
    }
    stroke.previous = [...point];
    return any;
  }
  takeStrokeBounds() {
    if (!this.#stroke || !this.#stroke.bounds) return null;
    const { layer, minX, maxX, minZ, maxZ } = this.#stroke.bounds;
    this.#stroke.bounds = null;
    return layer === 'height' ? { height: { minX, maxX, minZ, maxZ } } : { surface: { minX, maxX, minZ, maxZ } };
  }
  #updateDirty(layer, index, value) {
    const set = layer === 'height' ? this.#heightDirty : this.#surfaceDirty;
    const saved = layer === 'height' ? this.#savedHeight : this.#savedSurface;
    if (value === saved[index]) set.delete(index); else set.add(index);
  }
  endStroke() {
    if (!this.#stroke) return false;
    const changes = [...this.#stroke.changes.values()].filter(c => c.before !== c.after);
    const kind = this.#stroke.kind === 'paint' ? 'surface' : 'height';
    this.#stroke = null;
    if (changes.length) this.#push({ kind, changes });
    return changes.length > 0;
  }
  cancelStroke() {
    if (!this.#stroke) return false;
    for (const change of this.#stroke.changes.values()) {
      this.#doc[change.layer === 'height' ? 'height' : 'surface'].data[change.index] = change.before;
      this.#updateDirty(change.layer, change.index, change.before);
    }
    this.#stroke = null;
    return true;
  }
  #apply(entry, next) {
    if (entry.kind === 'roads') this.#roads = clone(entry[next]);
    else if (entry.kind === 'buildings') this.#buildings = clone(entry[next]);
    else if (entry.kind === 'objects') this.#objects = clone(entry[next]);
    else if (entry.kind === 'water') this.#water = clone(entry[next]);
    else if (entry.kind === 'settlements') this.#settlements = clone(entry[next]);
    else for (const change of entry.changes) {
      const value = change[next];
      this.#doc[change.layer === 'height' ? 'height' : 'surface'].data[change.index] = value;
      this.#updateDirty(change.layer, change.index, value);
    }
    return entry.kind;
  }
  undo() {
    if (this.#stroke || !this.canUndo) return null;
    const entry = this.#undo.pop(); this.#undoCost -= this.#cost(entry); this.#redo.push(entry);
    return this.#apply(entry, 'before');
  }
  redo() {
    if (this.#stroke || !this.canRedo) return null;
    const entry = this.#redo.pop(); this.#undo.push(entry); this.#undoCost += this.#cost(entry);
    return this.#apply(entry, 'after');
  }
  markSaved() {
    if (this.#stroke) throw new Error('Cannot save during brush stroke');
    this.#savedRoads = JSON.stringify(this.#roads);
    this.#savedEntities = { buildings: JSON.stringify(this.#buildings), objects: JSON.stringify(this.#objects) };
    this.#savedPolygons = { water: JSON.stringify(this.#water), settlements: JSON.stringify(this.#settlements) };
    this.#savedHeight.set(this.#doc.height.data);
    this.#savedSurface.set(this.#doc.surface.data);
    this.#heightDirty.clear(); this.#surfaceDirty.clear();
  }
}
