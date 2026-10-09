import { newEntityId, validateEntities } from './entity-edit.mjs';
import { validateRoads } from './road-edit.mjs';

/** Coordinate grid is optional, applies only to spatial editing, never terrain brushes. */
export function snapPoint(point, size, enabled, step) {
  if (!Array.isArray(point) || point.length !== 2 || point.some(n => !Number.isFinite(n)) ||
      !Array.isArray(size) || size.length !== 2 || size.some(n => !Number.isFinite(n) || n <= 0)) {
    throw new Error('Invalid map coordinates');
  }
  if (!enabled) return [...point];
  if (!Number.isFinite(step) || step < 0.25 || step > 100) throw new Error('Grid step must be between 0.25 and 100 meters');
  return point.map((n, i) => {
    const rounded = Math.round(n / step) * step;
    return Number(Math.max(0, Math.min(size[i], rounded)).toFixed(6));
  });
}

/** Selection is a set of same-kind IDs; toggling does not silently select a new kind. */
export function toggleSelection(selected, id, additive = false) {
  const next = new Set(additive ? selected : []);
  if (additive && next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Move every selected marker by the same delta, preserving relative spacing. */
export function moveEntities(entries, ids, anchorId, position, size) {
  const chosen = new Set(ids);
  const anchor = entries.find(e => e.id === anchorId);
  if (!anchor || !chosen.has(anchorId) || chosen.size === 0 || chosen.size !== entries.filter(e => chosen.has(e.id)).length) {
    throw new Error('Invalid marker selection');
  }
  if (!Array.isArray(position) || position.length !== 2 || position.some(n => !Number.isFinite(n))) throw new Error('Invalid destination');
  const dx = position[0] - anchor.position[0], dz = position[1] - anchor.position[1];
  const moved = entries.map(e => chosen.has(e.id) ? { ...e, position: [Number((e.position[0] + dx).toFixed(6)), Number((e.position[1] + dz).toFixed(6))] } : structuredClone(e));
  for (const item of moved) if (chosen.has(item.id) && (item.position[0] < 0 || item.position[1] < 0 || item.position[0] > size[0] || item.position[1] > size[1])) {
    throw new Error('Selection extends outside the map');
  }
  return moved;
}

/** Duplicate selected markers, preserving kind/definition/rotation and unique IDs. */
export function duplicateEntities(kind, entries, ids, size, offset = [5, 5], occupiedIds = []) {
  const chosen = new Set(ids);
  if (!chosen.size || entries.filter(e => chosen.has(e.id)).length !== chosen.size ||
      !Array.isArray(offset) || offset.length !== 2 || offset.some(n => !Number.isFinite(n))) {
    throw new Error('Invalid marker duplication');
  }
  const used = new Set([...occupiedIds, ...entries.map(e => e.id)]);
  const copies = [];
  for (const e of entries) {
    if (!chosen.has(e.id)) continue;
    const id = newEntityId(kind, used);
    used.add(id);
    copies.push({ ...structuredClone(e), id, position: [Number((e.position[0] + offset[0]).toFixed(6)), Number((e.position[1] + offset[1]).toFixed(6))] });
  }
  validateEntities(kind, [...entries, ...copies], size, occupiedIds);
  return { entries: [...structuredClone(entries), ...copies], addedIds: copies.map(e => e.id) };
}

export function duplicateRoad(roads, id, size, offset = [5, 5], occupiedIds = []) {
  const source = roads.find(r => r.id === id);
  if (!source || !Array.isArray(offset) || offset.length !== 2 || offset.some(n => !Number.isFinite(n))) throw new Error('Invalid road duplication');
  const used = new Set([...occupiedIds, ...roads.map(r => r.id)]);
  let index = 1;
  while (used.has(`road_${String(index).padStart(2, '0')}`)) index++;
  const copy = { ...structuredClone(source), id: `road_${String(index).padStart(2, '0')}`, points: source.points.map(p => p.map((n, i) => Number((n + offset[i]).toFixed(6)))) };
  const entries = [...structuredClone(roads), copy];
  validateRoads(entries, size);
  return { entries, addedId: copy.id };
}
