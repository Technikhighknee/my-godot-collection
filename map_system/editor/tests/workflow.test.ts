import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapPoint, toggleSelection, moveEntities, duplicateEntities, duplicateRoad } from '../web/workflow.mjs';
import { MapEdits } from '../web/terrain-edit.mjs';

const size = [100, 80];
const objects = [
  { id: 'object_001', definition: 'object.tree', position: [10, 12], rotation: 0 },
  { id: 'object_002', definition: 'object.barrel', position: [20, 25], rotation: 45 },
  { id: 'object_003', definition: 'object.tree', position: [40, 45], rotation: 0 },
];
const roads = [{ id: 'ridge', definition: 'road.path', width: 3, points: [[10, 10], [20, 20]] }];
function document() { return { map: { terrain: { size, min_height: 0, max_height: 10, surface_palette: ['grass'] }, roads, buildings: [], objects, water: [], settlements: [] }, height: { width: 2, height: 2, data: new Float32Array(4) }, surface: { width: 1, height: 1, data: new Uint8Array(1) } }; }

test('grid is opt-in, bounded, supports fractional steps, and never mutates source', () => {
  const input = [9.61, 79.82];
  assert.deepEqual(snapPoint(input, size, false, 1), input);
  assert.deepEqual(snapPoint(input, size, true, 0.5), [9.5, 80]);
  assert.deepEqual(snapPoint([99.9, 79.9], size, true, 3), [99, 80]);
  assert.deepEqual(input, [9.61, 79.82]);
  assert.throws(() => snapPoint(input, size, true, 0), /step/);
  assert.throws(() => snapPoint([NaN, 10], size, true, 1), /coordinates/);
});
test('additive selection toggles and ordinary selection replaces', () => {
  const a = toggleSelection(new Set(), 'object_001');
  const b = toggleSelection(a, 'object_002', true);
  assert.deepEqual([...b], ['object_001', 'object_002']);
  assert.deepEqual([...toggleSelection(b, 'object_002', true)], ['object_001']);
  assert.deepEqual([...toggleSelection(b, 'object_003')], ['object_003']);
  assert.deepEqual([...a], ['object_001']);
});
test('group translation preserves spacing, rejects map exit and missing IDs', () => {
  const moved = moveEntities(objects, ['object_001', 'object_002'], 'object_001', [15, 16], size);
  assert.deepEqual(moved.map(x => x.position), [[15, 16], [25, 29], [40, 45]]);
  assert.deepEqual(objects[0].position, [10, 12]);
  assert.throws(() => moveEntities(objects, ['object_001', 'object_003'], 'object_001', [85, 60], size), /outside/);
  assert.throws(() => moveEntities(objects, ['missing'], 'missing', [15, 16], size), /selection/);
});
test('group duplication allocates collision-free IDs and copies transformations', () => {
  const { entries, addedIds } = duplicateEntities('objects', objects, ['object_002', 'object_001'], size, [4, 5], ['object_004']);
  assert.deepEqual(addedIds, ['object_005', 'object_006']);
  assert.deepEqual(entries.slice(3).map(x => x.position), [[14, 17], [24, 30]]);
  assert.deepEqual(entries[4].rotation, 45);
  assert.deepEqual(objects[1].position, [20, 25]);
  assert.throws(() => duplicateEntities('objects', objects, ['object_003'], size, [70, 60]), /Invalid/);
  assert.throws(() => duplicateEntities('objects', objects, ['missing'], size), /duplication/);
});
test('road duplication uses the same validator and unique cross-layer IDs', () => {
  const result = duplicateRoad(roads, 'ridge', size, [5, 5], ['road_01']);
  assert.equal(result.addedId, 'road_02');
  assert.deepEqual(result.entries[1].points, [[15, 15], [25, 25]]);
  assert.throws(() => duplicateRoad(roads, 'ridge', size, [90, 0]), /terrain/);
});
test('group workflows enter one undo/redo entry and preserve unchanged marker data', () => {
  const doc = document();
  const edits = new MapEdits(doc);
  const first = moveEntities(edits.objects, ['object_001', 'object_002'], 'object_001', [15, 16], size);
  assert.equal(edits.commitEntities('objects', first), true);
  const duplicated = duplicateEntities('objects', edits.objects, ['object_001', 'object_002'], size);
  assert.equal(edits.commitEntities('objects', duplicated.entries), true);
  assert.equal(edits.objects.length, 5);
  assert.equal(edits.undo(), 'objects');
  assert.equal(edits.objects.length, 3);
  assert.equal(edits.undo(), 'objects');
  assert.deepEqual(edits.objects, objects);
  assert.equal(edits.redo(), 'objects');
  assert.deepEqual(edits.objects[0].position, [15, 16]);
});
