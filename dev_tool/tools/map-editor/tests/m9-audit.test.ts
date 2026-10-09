import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { MapWorkspace } from '../src/editing/map-workspace.ts';
import { createEditorServer } from '../src/server.ts';
import { encodeExr } from '../src/formats/exr.ts';
import { encodeSurfacePng } from '../src/formats/png.ts';

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'map-editor-m9-'));
  await mkdir(join(dir, 'assets'));
  const map = {
    name: 'One', terrain: { size: [20, 10], heightmap: 'assets/one.exr', surface_map: 'assets/one.png', min_height: -5, max_height: 5, surface_palette: ['terrain.grass'] },
    roads: [], settlements: [], water: [], buildings: [], objects: [],
  };
  await writeFile(join(dir, 'one.map.json'), JSON.stringify(map));
  await writeFile(join(dir, 'assets/one.exr'), encodeExr({width: 4, height: 3, data: new Float32Array(12).fill(0.5)}));
  await writeFile(join(dir, 'assets/one.png'), encodeSurfacePng({width: 3, height: 2, data: new Uint8Array(6)}));
  const ws = await MapWorkspace.open(join(dir, 'one.map.json'));
  return { dir, ws };
}

test('map list does not label maps with missing or corrupt assets as valid', async () => {
  const { dir, ws } = await fixture();
  try {
    const original = JSON.parse(await readFile(join(dir, 'one.map.json'), 'utf8'));
    await writeFile(join(dir, 'missing.map.json'), JSON.stringify({ ...original, name: 'Missing', terrain: { ...original.terrain, heightmap: 'assets/absent.exr' } }));
    await writeFile(join(dir, 'corrupt.map.json'), JSON.stringify({ ...original, name: 'Corrupt', terrain: { ...original.terrain, surface_map: 'assets/corrupt.png' } }));
    await writeFile(join(dir, 'assets/corrupt.png'), Buffer.from('not a png'));
    const listed = await ws.list();
    assert.deepEqual(listed.map(x => [x.file, x.valid]), [
      ['corrupt.map.json', false], ['missing.map.json', false], ['one.map.json', true],
    ]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('map binary reads are bound to the metadata revision across workspace switches', async () => {
  const { dir, ws } = await fixture();
  const server = createEditorServer(ws.getDocument(), ws.getStore(), undefined, ws);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`;
    const previous = await (await fetch(origin + '/api/map')).json();
    const first = await fetch(origin + '/api/heights', { headers: { 'If-Match': `"${previous.revision}"` } });
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('etag'), `"${previous.revision}"`);
    await ws.create({ slug: 'two', name: 'Two', worldSize: [10, 10], heightSamples: [5, 5], minHeight: -1, maxHeight: 2, surfacePalette: ['terrain.grass'] }, ws.getFile(), ws.getRevision());
    assert.equal((await fetch(origin + '/api/heights', { headers: { 'If-Match': `"${previous.revision}"` } })).status, 409);
    assert.equal((await fetch(origin + '/api/surfaces', { headers: { 'If-Match': `"${previous.revision}"` } })).status, 409);
    const next = await (await fetch(origin + '/api/map')).json();
    const fresh = await fetch(origin + '/api/heights', { headers: { 'If-Match': `"${next.revision}"` } });
    assert.equal(fresh.status, 200);
    assert.equal((await fresh.arrayBuffer()).byteLength, 5 * 5 * 4);
    assert.equal((await fetch(origin + '/api/heights')).status, 200); // Legacy read clients.
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});


test('every shipped browser script passes the JavaScript syntax parser', async () => {
  const browserRoot = fileURLToPath(new URL('../web/', import.meta.url));
  const files = (await readdir(browserRoot)).filter(x => x.endsWith('.js') || x.endsWith('.mjs'));
  assert.ok(files.length >= 9);
  for (const file of files) {
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', join(browserRoot, file)], { stdio: 'pipe' }), file);
  }
});
