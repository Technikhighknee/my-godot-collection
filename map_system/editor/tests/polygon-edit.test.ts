import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMap } from '../src/io/map-io.ts';
import { validateMap } from '../src/core/map.ts';
import { RoadStore, RoadConflict } from '../src/editing/road-store.ts';
import { createEditorServer } from '../src/server.ts';
import { MapEdits } from '../web/terrain-edit.mjs';
import { nearestPolygonEdge, newPolygonId, validatePolygon, validatePolygons } from '../web/polygon-edit.mjs';

const fixture = '../godot/coastal_relief.map.json';
const size: [number, number] = [480, 360];
const rect: [number, number][] = [[10, 10], [40, 10], [40, 30], [10, 30]];
const water = { id: 'pond_1', definition: 'water.pond', height: 5.25, polygon: rect };
const settlement = { id: 'village_1', name: 'Village', build_areas: [rect] };

test('polygons have strict topology, bounds and ID contracts', () => {
  assert.deepEqual(validatePolygon(rect, size), rect);
  assert.deepEqual(validatePolygon([...rect].reverse(), size), [...rect].reverse());
  assert.deepEqual(nearestPolygonEdge(rect, [25, 12]), { index: 0, distance: 2 });
  assert.equal(newPolygonId('water', ['water_001', 'water_003']), 'water_002');
  assert.equal(newPolygonId('settlements', ['settlement_001']), 'settlement_002');
  for (const invalid of [
    rect.slice(0, 2),
    [[10, 10], [40, 30], [10, 30], [40, 10]],
    [[10, 10], [20, 20], [30, 30]],
    [[10, 10], [10, 10], [40, 10], [40, 30]],
    [[10, 10], [40, 10], [40, 30], [10, 10]],
    [[10, 10], [40, 10], [40, -1]],
    [[10, 10], [40, 10], [Infinity, 20]],
    [[10, 10], [40, 10], [null, 20]],
    [[0, 0], [5, 0], [5, 5], [0, 5], [5, 0], [7, 4]],
  ]) assert.throws(() => validatePolygon(invalid as [number,number][], size), /Invalid polygon/);
  assert.throws(() => validatePolygons('water', [{...water, height: NaN}], size), /Invalid water/);
  assert.throws(() => validatePolygons('water', [{...water, foo: 1} as typeof water], size), /Invalid water/);
  assert.throws(() => validatePolygons('water', [water], size, ['pond_1']), /duplicate/);
  assert.throws(() => validatePolygons('settlements', [{...settlement, build_areas: []}], size), /Invalid settlement/);
  assert.throws(() => validatePolygons('settlements', [{...settlement, name: '  '}], size), /Invalid settlement/);
  assert.throws(() => validatePolygons('settlements', [settlement, {...settlement}], size), /duplicate/);
});

test('polygons, roads and terrain share undo, redo and clean/dirty transitions', async () => {
  const loaded = await loadMap(fixture);
  const doc = {map: structuredClone(loaded.map), height: { ...loaded.heights, data: new Float32Array(loaded.heights.data) }, surface: { ...loaded.surfaces, data: new Uint8Array(loaded.surfaces.data) }};
  const edits = new MapEdits(doc);
  const originalWater = edits.water;
  assert.equal(edits.commitPolygons('water', [...edits.water, water]), true);
  assert.equal(edits.polygonDirty, true);
  assert.equal(edits.commitPolygons('settlements', [settlement]), true);
  const copy = edits.settlements;
  copy[0].build_areas[0][0][0] = -100;
  assert.deepEqual(edits.settlements, [settlement]);
  assert.throws(() => edits.commitEntities('objects', [{ id: 'village_1', definition: 'object.tree', position: [1, 1], rotation: 0 }]), /duplicate/);
  assert.throws(() => edits.commitPolygons('settlements', [{...settlement, id: 'pond_1'}]), /duplicate/);
  const roads = edits.roads;
  roads[0].width += 1;
  assert.equal(edits.commit(roads), true);
  assert.equal(edits.undo(), 'roads');
  assert.equal(edits.undo(), 'settlements');
  assert.equal(edits.undo(), 'water');
  assert.equal(edits.polygonDirty, false);
  assert.deepEqual(edits.water, originalWater);
  assert.equal(edits.isDirty, false);
  assert.equal(edits.redo(), 'water');
  assert.equal(edits.redo(), 'settlements');
  assert.equal(edits.redo(), 'roads');
  edits.markSaved();
  assert.equal(edits.isDirty, false);
  assert.equal(edits.undo(), 'roads');
  assert.equal(edits.isDirty, true);
  assert.equal(edits.redo(), 'roads');
  assert.equal(edits.isDirty, false);
  assert.equal(edits.commitPolygons('water', edits.water), false);
});

test('polygon saves preserve other fields and reject invalid/stale/disk-modified maps', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'map-polygons-'));
  try {
    const doc = await loadMap(fixture);
    const mapFile = join(folder, 'map.json');
    await writeFile(mapFile, JSON.stringify(doc.map));
    const store = await RoadStore.open(mapFile, doc);
    const first = store.getRevision();
    await assert.rejects(() => store.saveDocument({roads:doc.map.roads,water:[{...water, polygon: [[1,1],[2,2],[3,3]]}]}, first), /zero area/);
    await assert.rejects(() => store.saveDocument({roads:doc.map.roads,settlements:[{...settlement, id: doc.map.roads[0].id}]}, first), /duplicates/);
    assert.equal(store.getRevision(), first);
    const second = await store.saveDocument({roads:doc.map.roads,settlements:[settlement], water:[water]}, first);
    assert.notEqual(second, first);
    const disk = validateMap(JSON.parse(await readFile(mapFile, 'utf8')));
    assert.deepEqual(disk.settlements, [settlement]);
    assert.deepEqual(disk.water, [water]);
    assert.deepEqual(disk.roads, doc.map.roads);
    assert.deepEqual(disk.terrain, doc.map.terrain);
    await assert.rejects(() => store.saveDocument({roads: doc.map.roads, water: []}, first), RoadConflict);
    const third = await store.save(doc.map.roads, second);
    assert.ok(third);
    assert.deepEqual(JSON.parse(await readFile(mapFile, 'utf8')).water, [water]);
    await writeFile(mapFile, JSON.stringify({...disk, name:'Externally edited'}));
    await assert.rejects(() => store.saveDocument({ roads: doc.map.roads, settlements: [] }, third), RoadConflict);
  } finally { await rm(folder, {recursive:true,force:true}); }
});

test('HTTP polygon edits require valid schema, origin and revision', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'map-polygons-http-'));
  try {
    const doc = await loadMap(fixture);
    const path = join(folder, 'map.json');
    await writeFile(path, JSON.stringify(doc.map));
    const store = await RoadStore.open(path, doc);
    const server = createEditorServer(doc, store);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address(); assert.ok(address && typeof address !== 'string');
      const base = `http://127.0.0.1:${address.port}`;
      const revision = (await (await fetch(`${base}/api/map`)).json()).revision;
      const body = { revision, roads: doc.map.roads, water: [water], settlements: [settlement] };
      const put = (b: unknown, origin = base) => fetch(`${base}/api/document`, {method:'PUT',headers:{Origin:origin,'Content-Type':'application/json'}, body: JSON.stringify(b)});
      assert.equal((await put(body, 'http://evil.invalid')).status, 403);
      assert.equal((await put({...body, water:[{...water, height:'low'}]})).status, 400);
      assert.equal((await put({...body, settlements: [ {...settlement, build_areas: []} ]})).status, 400);
      assert.equal((await put({...body, water: null})).status, 400);
      assert.equal((await put({...body, ignored: true})).status, 400);
      assert.equal((await put(body)).status, 200);
      assert.equal((await put(body)).status, 409);
      const map = (await (await fetch(`${base}/api/map`)).json()).map;
      assert.deepEqual(map.water, [water]); assert.deepEqual(map.settlements, [settlement]);
      assert.equal((await fetch(`${base}/polygon-edit.mjs`)).status, 200);
    } finally { await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())); }
  } finally {await rm(folder,{recursive:true,force:true});}
});
