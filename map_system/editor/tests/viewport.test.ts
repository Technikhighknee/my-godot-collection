import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMap } from '../src/io/map-io.ts';
import { createEditorServer } from '../src/server.ts';
import { buildTerrainGeometry, sampleHeight, surfaceAt, makeVertexColors } from '../web/mesh-data.mjs';
import { heightAt } from '../src/core/map.ts';

const fixture = '../godot/coastal_relief.map.json';

test('browser mesh has exactly the Godot terrain vertex positions and triangle split', async () => {
  const doc = await loadMap(fixture);
  const { positions, indices } = buildTerrainGeometry(doc.map.terrain, doc.heights);
  assert.equal(positions.length, doc.heights.data.length * 3);
  assert.equal(indices.length, (doc.heights.width - 1) * (doc.heights.height - 1) * 6);
  assert.deepEqual(Array.from(indices.slice(0, 6)), [0, doc.heights.width, 1, 1, doc.heights.width, doc.heights.width + 1]);
  for (const [x, z] of [[0, 0], [3, 12], [220.4, 94.2], [240, 330], [480, 360], [140.8, 120.3]]) {
    const fromBrowser = sampleHeight(doc.map.terrain, doc.heights, x, z);
    assert.ok(Math.abs(fromBrowser - heightAt(doc, x, z)) < 1e-8, `Height mismatch at (${x}, ${z})`);
  }
  const colors = makeVertexColors(doc.map.terrain, doc.heights, doc.surfaces, doc.map.terrain.surface_palette);
  assert.equal(colors.length, positions.length);
  assert.equal(surfaceAt(doc.map.terrain, doc.surfaces, 480, 360), doc.surfaces.data.at(-1));
});

test('read-only HTTP API serves exact normalized height samples and categorical pixels', async () => {
  const doc = await loadMap(fixture);
  const server = createEditorServer(doc);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}`;
    const info = await fetch(`${url}/api/map`);
    assert.equal(info.status, 200);
    const metadata = await info.json();
    assert.equal(metadata.readOnly, true);
    assert.deepEqual(metadata.map, doc.map);
    const heightResponse = await fetch(`${url}/api/heights`);
    assert.equal(heightResponse.status, 200);
    const array = new DataView(await heightResponse.arrayBuffer());
    assert.equal(array.byteLength, doc.heights.data.length * 4);
    for (let i = 0; i < doc.heights.data.length; i += 177) assert.equal(array.getFloat32(i * 4, true), doc.heights.data[i]);
    const surfaceResponse = await fetch(`${url}/api/surfaces`);
    assert.deepEqual(new Uint8Array(await surfaceResponse.arrayBuffer()), doc.surfaces.data);
    const html = await fetch(url);
    assert.match(await html.text(), /1400 · Map Editor/);
    assert.match(html.headers.get('content-security-policy') ?? '', /default-src 'none'/);
    assert.equal((await fetch(`${url}/app.js`)).status, 200);
    assert.equal((await fetch(`${url}/mesh-data.mjs`)).status, 200);
    assert.equal((await fetch(`${url}/style.css`)).status, 200);
    assert.equal((await fetch(`${url}/api/map`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${url}/api/map`, { method: 'PUT' })).status, 405);
    assert.equal((await fetch(`${url}/src/server.ts`)).status, 404);
    assert.equal((await fetch(`${url}/.git/config`)).status, 404);
    assert.equal((await fetch(`${url}/vendor/three/../../src/server.ts`)).status, 404);
    const head = await fetch(`${url}/api/heights`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), String(doc.heights.data.byteLength));
    assert.equal((await head.arrayBuffer()).byteLength, 0);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
