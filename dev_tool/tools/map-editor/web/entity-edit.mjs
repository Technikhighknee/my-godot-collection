/** A marker is not a building footprint; validate only the portable map contract. */
export function validateEntities(kind, entries, size, occupiedIds = []) {
  if (kind !== 'buildings' && kind !== 'objects' || !Array.isArray(entries) || !Array.isArray(size) || size.length !== 2 ||
      size.some(n => !Number.isFinite(n) || n <= 0)) throw new Error('Invalid entity collection');
  const ids = new Set(occupiedIds);
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        Object.keys(entry).sort().join() !== 'definition,id,position,rotation' ||
        typeof entry.id !== 'string' || !entry.id.trim() || ids.has(entry.id) ||
        typeof entry.definition !== 'string' || !entry.definition.trim() ||
        !Array.isArray(entry.position) || entry.position.length !== 2 ||
        entry.position.some((n, i) => !Number.isFinite(n) || n < 0 || n > size[i]) ||
        !Number.isFinite(entry.rotation)) throw new Error(`Invalid ${kind} entry or duplicate ID`);
    ids.add(entry.id);
  }
  return entries;
}

export function newEntityId(kind, ids) {
  if (kind !== 'buildings' && kind !== 'objects') throw new Error('Invalid entity kind');
  const prefix = kind === 'buildings' ? 'building' : 'object';
  const used = new Set(ids);
  let index = 1;
  while (used.has(`${prefix}_${String(index).padStart(3, '0')}`)) index++;
  return `${prefix}_${String(index).padStart(3, '0')}`;
}
