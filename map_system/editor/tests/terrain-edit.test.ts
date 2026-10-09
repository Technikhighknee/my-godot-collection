import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, cp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMap } from '../src/io/map-io.ts';
import { RoadStore, RoadConflict } from '../src/editing/road-store.ts';
import { createEditorServer } from '../src/server.ts';
import { decodeExr } from '../src/formats/exr.ts';
import { decodeSurfacePng } from '../src/formats/png.ts';
import { MapEdits } from '../web/terrain-edit.mjs';

const sampleDoc = () => ({
  map: { terrain: { size: [4, 4], min_height: -10, max_height: 10, surface_palette: ['terrain.grass', 'terrain.rock'] }, roads: [{ id: 'a', definition: 'road.path', width: 2, points: [[0,0],[4,4]] }] },
  height: { width: 5, height: 5, data: new Float32Array(25).fill(0.5) },
  surface: { width: 4, height: 4, data: new Uint8Array(16) },
});

test('terrain brushes use normalized sample grid, categorical cell centers and single-stroke undo', () => {
  const doc = sampleDoc();
  const edit = new MapEdits(doc);
  assert.ok(edit.beginStroke('raise', { radius: 1.25, strength: 2 }, [2, 2]));
  edit.strokeTo([2.9, 2]);
  assert.equal(edit.endStroke(), true);
  assert.ok(doc.height.data[12] > 0.5 && doc.height.data[12] < 1);
  assert.equal(doc.height.data[0], 0.5);
  assert.equal(edit.heightDirty, true);
  const sculpt = doc.height.data.slice();
  const roads = edit.roads;
  roads[0].width = 3;
  edit.commit(roads);
  assert.equal(edit.undo(), 'roads');
  assert.equal(edit.roads[0].width, 2);
  assert.equal(edit.undo(), 'height');
  assert.equal(doc.height.data[12], 0.5);
  assert.equal(edit.isDirty, false);
  assert.equal(edit.redo(), 'height');
  assert.deepEqual(doc.height.data, sculpt);
  assert.equal(edit.redo(), 'roads');
  edit.markSaved();
  assert.equal(edit.isDirty, false);
  assert.equal(edit.undo(), 'roads');
  assert.equal(edit.isDirty, true);
  assert.equal(edit.redo(), 'roads');
  assert.equal(edit.isDirty, false);
  edit.beginStroke('paint', { radius: 0.6, strength: 2, surfaceIndex: 1 }, [0.5, 0.5]);
  assert.equal(edit.endStroke(), true);
  assert.equal(doc.surface.data[0], 1);
  assert.equal(doc.surface.data[1], 0);
  assert.equal(edit.surfaceDirty, true);
  assert.equal(edit.undo(), 'surface');
  assert.equal(doc.surface.data[0], 0);
  assert.equal(edit.surfaceDirty, false);
  edit.beginStroke('lower', { radius: 1.1, strength: 2 }, [2, 2]);
  edit.cancelStroke();
  assert.deepEqual(doc.height.data, sculpt);
  assert.equal(edit.canRedo, true); // cancelling does not destroy redo history
  assert.throws(() => edit.beginStroke('paint', { radius: 1, strength: 2, surfaceIndex: 25 }, [0,0]), /Invalid surface index/);
});

test('flatten uses initial brush elevation and smoothing is order-independent per dab', () => {
  const doc = sampleDoc();
  doc.height.data[12] = 0.9;
  const edit = new MapEdits(doc);
  edit.beginStroke('flatten', { radius: 2, strength: 5 }, [2, 2]);
  edit.strokeTo([3, 2]);
  edit.endStroke();
  assert.ok(doc.height.data[13] > 0.5);
  const raised = doc.height.data[13];
  edit.beginStroke('smooth', { radius: 2, strength: 5 }, [2, 2]);
  edit.endStroke();
  assert.ok(doc.height.data[12] < 0.9);
  assert.ok(doc.height.data[13] <= raised);
  for (const value of doc.height.data) assert.ok(value >= 0 && value <= 1);
});

test('multi-file save publishes new immutable assets, updates manifest, retains original maps', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'map-terrain-assets-'));
  try {
    const src = '../godot/coastal_relief.map.json';
    const doc = await loadMap(src);
    const mapFile = join(temp, 'coastal_relief.map.json');
    await cp('../godot/assets', join(temp, 'assets'), { recursive: true });
    await cp(src, mapFile);
    const originalMap = await readFile(mapFile);
    const oldHeight = await readFile(join(temp, doc.map.terrain.heightmap));
    const oldSurface = await readFile(join(temp, doc.map.terrain.surface_map));
    const manifest = { files: ['coastal_relief.map.json', doc.map.terrain.heightmap, doc.map.terrain.surface_map] };
    await writeFile(join(temp, 'manifest.json'), JSON.stringify(manifest));
    const store = await RoadStore.open(mapFile, doc);
    const oldRevision = store.getRevision();
    const heights = new Float32Array(doc.heights.data);
    const surfaces = new Uint8Array(doc.surfaces.data);
    heights[100] = heights[100] > 0.5 ? 0.2 : 0.8;
    surfaces[100] = (surfaces[100] + 1) % doc.map.terrain.surface_palette.length;
    const next = await store.saveDocument({ roads: doc.map.roads, heights, surfaces }, oldRevision);
    assert.notEqual(next, oldRevision);
    assert.deepEqual(await readFile(join(temp, manifest.files[1])), oldHeight);
    assert.deepEqual(await readFile(join(temp, manifest.files[2])), oldSurface);
    const written = JSON.parse(await readFile(mapFile, 'utf8'));
    assert.match(written.terrain.heightmap, /\.edit-[a-f0-9]{64}\.exr$/);
    assert.match(written.terrain.surface_map, /\.edit-[a-f0-9]{64}\.png$/);
    assert.notEqual(await readFile(mapFile, 'utf8'), originalMap.toString());
    const edited = await loadMap(mapFile);
    assert.equal(edited.heights.data[100], heights[100]);
    assert.equal(edited.surfaces.data[100], surfaces[100]);
    assert.deepEqual(decodeExr(await readFile(join(temp, written.terrain.heightmap))).data, heights);
    assert.deepEqual(decodeSurfacePng(await readFile(join(temp, written.terrain.surface_map))).data, surfaces);
    const manifestNow = JSON.parse(await readFile(join(temp, 'manifest.json'), 'utf8'));
    assert.ok(manifestNow.files.includes(written.terrain.heightmap) && manifestNow.files.includes(written.terrain.surface_map));
    assert.ok(manifestNow.files.includes(manifest.files[1]) && manifestNow.files.includes(manifest.files[2]));
    assert.ok((await readdir(join(temp, 'assets'))).length >= 4);
    await assert.rejects(() => store.save(doc.map.roads, oldRevision), RoadConflict);
    // Editing again must not produce filenames that grow on each save.
    const secondHeights = heights.slice();
    secondHeights[102] = secondHeights[102] > 0.5 ? 0.1 : 0.9;
    const secondRevision = await store.saveDocument({ roads: doc.map.roads, heights: secondHeights }, next);
    const secondMap = JSON.parse(await readFile(mapFile, 'utf8'));
    assert.match(secondMap.terrain.heightmap, /^assets\/coastal_relief\.height\.edit-[a-f0-9]{64}\.exr$/);
    assert.equal(secondMap.terrain.surface_map, written.terrain.surface_map);
    assert.notEqual(secondRevision, next);
    assert.equal((await loadMap(mapFile)).heights.data[102], secondHeights[102]);
    const latestRevision = secondRevision;
    const invalid = heights.slice(); invalid[0] = NaN;
    await assert.rejects(() => store.saveDocument({ roads: doc.map.roads, heights: invalid }, latestRevision), /Invalid height/);
    assert.equal((await readFile(mapFile, 'utf8')), JSON.stringify(secondMap, null, 2) + '\n');
    // External change in active source asset must veto the save, even if JSON is unchanged.
    await writeFile(join(temp, secondMap.terrain.heightmap), Buffer.from('external data'));
    await assert.rejects(() => store.save(doc.map.roads, latestRevision), RoadConflict);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('document HTTP API rejects invalid binary writes and cross-origin requests; serves saved data', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'map-terrain-http-'));
  const src = '../godot/coastal_relief.map.json';
  await cp('../godot/assets', join(temp, 'assets'), { recursive: true });
  const path = join(temp, 'map.json');
  await cp(src, path);
  const doc = await loadMap(path);
  const store = await RoadStore.open(path, doc);
  const server = createEditorServer(doc, store);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const revision = store.getRevision();
    const put = (body: unknown, origin = base) => fetch(base + '/api/document', { method: 'PUT', headers: { 'Content-Type':'application/json', Origin: origin }, body: JSON.stringify(body) });
    const body = { revision, roads: doc.map.roads, surfaces: Buffer.from(doc.surfaces.data).toString('base64') };
    assert.equal((await put(body, 'https://evil.example')).status, 403);
    assert.equal((await put({ ...body, surfaces: '!!!!' })).status, 400);
    assert.equal((await put({ ...body, heights: 'AA==' })).status, 400);
    assert.equal((await put({ ...body, extras: 'no' })).status, 400);
    const edited = new Uint8Array(doc.surfaces.data);
    edited[50] = (edited[50] + 1) % doc.map.terrain.surface_palette.length;
    const saved = await put({ revision, roads: doc.map.roads, surfaces: Buffer.from(edited).toString('base64') });
    assert.equal(saved.status, 200, await saved.text().catch(()=>'failed to read response'));
    assert.equal((await put(body)).status, 409);
    const served = await (await fetch(base + '/api/surfaces')).arrayBuffer();
    assert.deepEqual(new Uint8Array(served), edited);
    assert.equal((await fetch(base + '/api/map').then(r => r.json())).map.terrain.surface_map.includes('.edit-'), true);
  } finally {
    await new Promise<void>((resolve,reject) => server.close(e => e ? reject(e) : resolve()));
    await rm(temp, { recursive:true, force:true });
  }
});
