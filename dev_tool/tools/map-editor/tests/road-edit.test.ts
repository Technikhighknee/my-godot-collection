import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMap } from '../src/io/map-io.ts';
import { createEditorServer } from '../src/server.ts';
import { RoadStore, RoadConflict } from '../src/editing/road-store.ts';
import { RoadEdits, nearestSegment } from '../web/road-edit.mjs';

const fixture = '../map_system/coastal_relief.map.json';

test('road editing is isolated, transactional, bounded and undoable', () => {
  const roads = [{ id: 'path', definition: 'road.path', width: 3, points: [[1, 1], [6, 6]] as [number,number][] }];
  const session = new RoadEdits(roads, [10, 10]);
  roads[0].points[0][0] = 999;
  assert.deepEqual(session.roads[0].points[0], [1, 1]);
  const attempt = session.roads;
  attempt[0].points[0] = [2, 3];
  assert.equal(session.commit(attempt), true);
  assert.equal(session.isDirty, true);
  assert.deepEqual(session.roads[0].points[0], [2, 3]);
  assert.equal(session.undo(), true);
  assert.deepEqual(session.roads[0].points[0], [1, 1]);
  assert.equal(session.isDirty, false);
  assert.equal(session.redo(), true);
  session.markSaved(session.roads);
  assert.equal(session.isDirty, false);
  assert.equal(session.undo(), true);
  assert.equal(session.isDirty, true);
  assert.equal(session.redo(), true);
  assert.equal(session.isDirty, false);
  assert.equal(session.commit(session.roads), false);
  assert.equal(session.canRedo, false);
  const invalid = session.roads;
  invalid[0].points[0] = invalid[0].points[1];
  assert.throws(() => session.commit(invalid), /coincide/);
  assert.deepEqual(session.roads[0].points[0], [2, 3]);
  assert.deepEqual(nearestSegment([[0, 0], [10, 0], [10, 10]], [8, 3]), { index: 1, distance: 2 });
  for (let i = 0; i < 125; i++) {
    const next = session.roads;
    next[0].width = 3 + i;
    session.commit(next);
  }
  let undoCount = 0;
  while (session.undo()) undoCount++;
  assert.equal(undoCount, 100);
});

test('JSON-only road save checks revisions and preserves other fields and source assets', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'map-road-edit-'));
  try {
    const original = await loadMap(fixture);
    const mapFile = join(folder, 'map.json');
    await writeFile(mapFile, JSON.stringify(original.map, null, 2));
    const store = await RoadStore.open(mapFile, original);
    const revision = store.getRevision();
    const roads = structuredClone(original.map.roads);
    roads[0].points[0] = [30, 30];
    const saved = await store.save(roads, revision);
    assert.notEqual(saved, revision);
    const file = JSON.parse(await readFile(mapFile, 'utf8'));
    assert.deepEqual(file.roads, roads);
    assert.deepEqual(file.terrain, original.map.terrain);
    assert.equal(file.water.length, original.map.water.length);
    assert.equal(original.heights.data.length > 0, true);
    await assert.rejects(() => store.save(roads, revision), RoadConflict);
    await writeFile(mapFile, JSON.stringify({ ...file, name: 'External edit' }));
    await assert.rejects(() => store.save(roads, saved), RoadConflict);
    assert.equal(JSON.parse(await readFile(mapFile, 'utf8')).name, 'External edit');
    const broken = structuredClone(roads);
    broken[0].points[1] = broken[0].points[0];
    await assert.rejects(() => store.save(broken, saved), /duplicate/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('HTTP write accepts only local same-origin JSON, validates input and rejects stale saves', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'map-road-http-'));
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
    const meta = await (await fetch(base + '/api/map')).json();
    assert.equal(meta.readOnly, false);
    const save = (body: unknown, origin = base) => fetch(base + '/api/roads', {
      method: 'PUT', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const roads = structuredClone(doc.map.roads);
    roads[0].points[0] = [20, 21];
    assert.equal((await save({ revision: meta.revision, roads }, 'https://evil.example')).status, 403);
    assert.equal((await save({ revision: meta.revision, roads: [{ id: 'invalid' }] })).status, 400);
    assert.equal((await save({ revision: meta.revision, roads, unexpected: true })).status, 400);
    const saved = await save({ revision: meta.revision, roads });
    assert.equal(saved.status, 200);
    const revision = (await saved.json()).revision;
    assert.match(revision, /^[0-9a-f]{64}$/);
    assert.equal((await save({ revision: meta.revision, roads })).status, 409);
    assert.equal((await (await fetch(base + '/api/map')).json()).revision, revision);
    assert.deepEqual(JSON.parse(await readFile(mapFile, 'utf8')).roads, roads);
    assert.equal((await fetch(base + '/api/roads', { method: 'GET' })).status, 404);
    assert.equal((await fetch(base + '/src/editing/road-store.ts')).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(folder, { recursive: true, force: true });
  }
});
