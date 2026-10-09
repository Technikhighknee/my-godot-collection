import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMap } from '../src/io/map-io.ts';
import { createEditorServer } from '../src/server.ts';
import { RoadStore, RoadConflict } from '../src/editing/road-store.ts';
import { MapEdits } from '../web/terrain-edit.mjs';
import { validateEntities, newEntityId } from '../web/entity-edit.mjs';

const fixture = '../map_system/coastal_relief.map.json';

test('marker editing validates map-space positions, IDs and definitions', () => {
  const entries = [{ id: 'b_1', definition: 'building.house', position: [2, 9], rotation: -90 }];
  assert.equal(validateEntities('buildings', entries, [10, 10]).length, 1);
  assert.equal(newEntityId('objects', ['object_001', 'object_002', 'building_001']), 'object_003');
  for (const modified of [
    { ...entries[0], position: [-1, 9] }, { ...entries[0], position: [10.1, 0] },
    { ...entries[0], position: [NaN, 0] }, { ...entries[0], rotation: Infinity },
    { ...entries[0], definition: '' }, { ...entries[0], stray: 1 },
  ]) assert.throws(() => validateEntities('buildings', [modified], [10, 10]), /Invalid/);
  assert.throws(() => validateEntities('objects', entries, [10, 10], ['b_1']), /duplicate/);
  assert.throws(() => validateEntities('buildings', [...entries, structuredClone(entries[0])], [10, 10]), /duplicate/);
});

test('marker, road and terrain edits share bounded reversible history', async () => {
  const source = await loadMap(fixture);
  const doc = { map: structuredClone(source.map), height: { ...source.heights, data: new Float32Array(source.heights.data) }, surface: { ...source.surfaces, data: new Uint8Array(source.surfaces.data) } };
  const edits = new MapEdits(doc);
  const building = { id: 'new_home', definition: 'building.house', position: [125, 100], rotation: 27 };
  const newBuildings = [...edits.buildings, building];
  assert.equal(edits.commitEntities('buildings', newBuildings), true);
  newBuildings.at(-1)!.position[0] = 900; // Returned state must not alias edits.
  assert.deepEqual(edits.buildings.at(-1)!.position, [125, 100]);
  assert.equal(edits.entityDirty, true);
  assert.equal(edits.isDirty, true);
  const object = { id: 'new_tree', definition: 'object.tree', position: [78, 99], rotation: 0 };
  assert.equal(edits.commitEntities('objects', [...edits.objects, object]), true);
  assert.throws(() => edits.commitEntities('objects', [{ ...object, id: building.id }]), /duplicate/);
  const modifiedRoads = edits.roads;
  modifiedRoads[0].width += 1;
  assert.equal(edits.commit(modifiedRoads), true);
  assert.equal(edits.undo(), 'roads');
  assert.equal(edits.undo(), 'objects');
  assert.equal(edits.undo(), 'buildings');
  assert.equal(edits.entityDirty, false);
  assert.equal(edits.isDirty, false);
  assert.equal(edits.redo(), 'buildings');
  assert.equal(edits.redo(), 'objects');
  assert.equal(edits.redo(), 'roads');
  edits.markSaved();
  assert.equal(edits.isDirty, false);
  assert.equal(edits.undo(), 'roads');
  assert.equal(edits.isDirty, true);
  assert.equal(edits.redo(), 'roads');
  assert.equal(edits.isDirty, false);
  assert.equal(edits.commitEntities('objects', edits.objects), false);
});

test('marker saves preserve terrain and other map sections, reject invalid and stale state', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'map-markers-'));
  try {
    const doc = await loadMap(fixture);
    const mapFile = join(folder, 'map.json');
    await writeFile(mapFile, JSON.stringify(doc.map));
    const store = await RoadStore.open(mapFile, doc);
    const first = store.getRevision();
    const entries = [{ id: 'house_a', definition: 'building.house', position: [24, 31], rotation: 180 }];
    await assert.rejects(() => store.saveDocument({ roads: doc.map.roads, buildings: [{ ...entries[0], id: doc.map.roads[0].id }] }, first), /duplicates/);
    await assert.rejects(() => store.saveDocument({ roads: doc.map.roads, buildings: [{ ...entries[0], position: [9999, 0] }] }, first), /outside terrain/);
    assert.equal(store.getRevision(), first);
    const second = await store.saveDocument({ roads: doc.map.roads, buildings: entries, objects: [{ id: 'barrel_a', definition: 'object.barrel', position: [17, 23], rotation: 0 }] }, first);
    assert.notEqual(second, first);
    const onDisk = JSON.parse(await readFile(mapFile, 'utf8'));
    assert.deepEqual(onDisk.buildings, entries);
    assert.equal(onDisk.objects[0].id, 'barrel_a');
    assert.deepEqual(onDisk.terrain, doc.map.terrain);
    assert.deepEqual(onDisk.water, doc.map.water);
    assert.deepEqual(onDisk.roads, doc.map.roads);
    await assert.rejects(() => store.saveDocument({ roads: doc.map.roads }, first), RoadConflict);
    // Legacy road-only saves must preserve newly placed markers.
    await store.save(doc.map.roads, second);
    assert.deepEqual(JSON.parse(await readFile(mapFile, 'utf8')).buildings, entries);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('HTTP marker saves enforce request schema, origin, validation and revision', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'map-marker-http-'));
  const doc = await loadMap(fixture);
  const mapFile = join(folder, 'map.json');
  await writeFile(mapFile, JSON.stringify(doc.map));
  const store = await RoadStore.open(mapFile, doc);
  const server = createEditorServer(doc, store);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const revision = (await (await fetch(base + '/api/map')).json()).revision;
    const body = { revision, roads: doc.map.roads, buildings: [{ id: 'house1', definition: 'building.house', position: [24, 31], rotation: 90 }], objects: [{ id: 'tree1', definition: 'object.tree', position: [40, 20], rotation: 0 }] };
    const put = (payload: unknown, origin = base) => fetch(base + '/api/document', { method: 'PUT', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    assert.equal((await put(body, 'http://evil.invalid')).status, 403);
    assert.equal((await put({ ...body, buildings: [{ ...body.buildings[0], id: 'tree1' }] })).status, 400);
    assert.equal((await put({ ...body, buildings: null })).status, 400);
    assert.equal((await put({ ...body, objects: [{ ...body.objects[0], position: [null, 20] }] })).status, 400);
    assert.equal((await put({ ...body, ignored: true })).status, 400);
    assert.equal((await put(body)).status, 200);
    assert.equal((await put(body)).status, 409);
    const map = (await (await fetch(base + '/api/map')).json()).map;
    assert.deepEqual(map.buildings, body.buildings);
    assert.deepEqual(map.objects, body.objects);
    assert.equal((await fetch(base + '/entity-edit.mjs')).status, 200);
    assert.equal((await fetch(base + '/api/document', { method: 'GET' })).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    await rm(folder, { recursive: true, force: true });
  }
});
