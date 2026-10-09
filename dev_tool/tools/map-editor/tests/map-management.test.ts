import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile, lstat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MapWorkspace } from '../src/editing/map-workspace.ts';
import { RoadConflict } from '../src/editing/road-store.ts';
import { loadMap } from '../src/io/map-io.ts';
import { createEditorServer } from '../src/server.ts';
import { encodeExr } from '../src/formats/exr.ts';
import { encodeSurfacePng } from '../src/formats/png.ts';
import { parsePalette, validateCreate } from '../web/map-management.mjs';

const settings = (name: string) => ({ name, min_height: -10, max_height: 50, surface_palette: ['terrain.grass', 'terrain.dirt'] });
const form = (slug: string) => ({
  slug, name: `New ${slug}`, worldSize: [100, 80], heightSamples: [9, 7],
  minHeight: -10, maxHeight: 50, surfacePalette: ['terrain.grass', 'terrain.dirt'],
});
async function tempWorkspace(manifest = false) {
  const dir = await mkdtemp(join(tmpdir(), 'm8-maps-'));
  await mkdir(join(dir, 'assets'));
  const map = {
    name: 'First map',
    terrain: { size: [100, 80], heightmap: 'assets/first.height.exr', surface_map: 'assets/first.surface.png', min_height: -10, max_height: 50, surface_palette: ['terrain.grass', 'terrain.dirt'] },
    roads: [], settlements: [], water: [], buildings: [], objects: [],
  };
  await writeFile(join(dir, 'first.map.json'), JSON.stringify(map));
  await writeFile(join(dir, 'assets/first.height.exr'), encodeExr({ width: 5, height: 4, data: new Float32Array(20).fill(0.5) }));
  await writeFile(join(dir, 'assets/first.surface.png'), encodeSurfacePng({ width: 4, height: 3, data: new Uint8Array(12) }));
  if (manifest) await writeFile(join(dir, 'manifest.json'), JSON.stringify({ files: ['first.map.json', 'assets/first.height.exr', 'assets/first.surface.png'] }));
  return { dir, map };
}

test('new map creation publishes EXR, PNG and JSON, updates manifest and opens the result', async () => {
  const { dir } = await tempWorkspace(true);
  try {
    const workspace = await MapWorkspace.open(join(dir, 'first.map.json'));
    const current = workspace.getRevision();
    await workspace.create(form('second'), 'first.map.json', current);
    assert.equal(workspace.getFile(), 'second.map.json');
    const loaded = await loadMap(join(dir, 'second.map.json'));
    assert.equal(loaded.map.name, 'New second');
    assert.deepEqual(loaded.map.terrain.size, [100, 80]);
    assert.equal(loaded.heights.width, 9);
    assert.equal(loaded.heights.height, 7);
    assert.equal(loaded.surfaces.width, 8);
    assert.equal(loaded.surfaces.height, 6);
    assert.ok(loaded.heights.data.every(n => Math.abs(n - 1/6) < 0.00001));
    assert.ok(loaded.surfaces.data.every(n => n === 0));
    const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
    for (const asset of ['second.map.json', 'assets/second.height.exr', 'assets/second.surface.png']) {
      assert.ok(manifest.files.includes(asset), asset);
    }
    assert.deepEqual((await workspace.list()).map(m => [m.file, m.active, m.valid]), [
      ['first.map.json', false, true], ['second.map.json', true, true],
    ]);
    assert.equal(JSON.parse(await readFile(join(dir, 'first.map.json'), 'utf8')).name, 'First map');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('workspace rejects bad names and stale revisions without touching existing files', async () => {
  const { dir } = await tempWorkspace();
  try {
    const workspace = await MapWorkspace.open(join(dir, 'first.map.json'));
    const revision = workspace.getRevision();
    await assert.rejects(() => workspace.create(form('../escape'), 'first.map.json', revision), /Invalid map slug/);
    await assert.rejects(() => workspace.create({ ...form('bad'), heightSamples: [9999, 6] }, 'first.map.json', revision), /Invalid height sample/);
    await assert.rejects(() => workspace.create(form('first'), 'first.map.json', revision), RoadConflict);
    await assert.rejects(() => workspace.activate('../../secrets', 'first.map.json', revision), /Invalid map filename/);
    await assert.rejects(() => workspace.activate('absent.map.json', 'first.map.json', revision));
    await workspace.create(form('second'), 'first.map.json', revision);
    await assert.rejects(() => workspace.create(form('third'), 'first.map.json', revision), RoadConflict);
    await assert.rejects(() => workspace.saveSettings(settings('Sneaky'), revision, 'first.map.json'), RoadConflict);
    await workspace.activate('first.map.json', 'second.map.json', workspace.getRevision());
    assert.equal(workspace.getFile(), 'first.map.json');
    assert.equal(workspace.getDocument().map.name, 'First map');
    assert.equal((await workspace.list()).length, 2);
    assert.equal((await lstat(join(dir, 'first.map.json'))).isFile(), true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('workspace applies only safe metadata, preserving existing terrain images', async () => {
  const { dir } = await tempWorkspace(true);
  try {
    const workspace = await MapWorkspace.open(join(dir, 'first.map.json'));
    const revision = workspace.getRevision();
    const heightBefore = await readFile(join(dir, 'assets/first.height.exr'));
    await workspace.saveSettings(settings('Renamed'), revision, 'first.map.json');
    assert.equal(workspace.getDocument().map.name, 'Renamed');
    assert.deepEqual(await readFile(join(dir, 'assets/first.height.exr')), heightBefore);
    await assert.rejects(() => workspace.saveSettings(settings('stale'), revision, 'first.map.json'), RoadConflict);
    await assert.rejects(() => workspace.saveSettings({ ...settings('invalid'), max_height: -10 }, workspace.getRevision(), 'first.map.json'), /max_height/);
    await assert.rejects(() => workspace.saveSettings({ ...settings('invalid'), surface_palette: [] }, workspace.getRevision(), 'first.map.json'), /surface_palette/);
    const body = JSON.parse(await readFile(join(dir, 'first.map.json'), 'utf8'));
    assert.equal(body.name, 'Renamed');
    assert.equal(body.terrain.heightmap, 'assets/first.height.exr');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('workspace rejects symlinked map files when file symlinks are supported', async t => {
  const { dir } = await tempWorkspace();
  try {
    const workspace = await MapWorkspace.open(join(dir, 'first.map.json'));
    const revision = workspace.getRevision();
    try {
      await symlink(join(dir, 'first.map.json'), join(dir, 'alias.map.json'), 'file');
    } catch (error) {
      if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        t.skip('Windows file symlinks require Developer Mode or symlink privilege');
        return;
      }
      throw error;
    }
    assert.deepEqual((await workspace.list()).map(x => x.file), ['first.map.json']);
    await assert.rejects(() => workspace.activate('alias.map.json', 'first.map.json', revision), RoadConflict);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('workspace refuses an externally modified active map', async () => {
  const { dir } = await tempWorkspace();
  try {
    const workspace = await MapWorkspace.open(join(dir, 'first.map.json'));
    const revision = workspace.getRevision();
    const original = JSON.parse(await readFile(join(dir, 'first.map.json'), 'utf8'));
    await writeFile(join(dir, 'first.map.json'), JSON.stringify({ ...original, name: 'Changed externally' }));
    await assert.rejects(() => workspace.saveSettings(settings('Wrong write'), revision, 'first.map.json'), RoadConflict);
    assert.equal(JSON.parse(await readFile(join(dir, 'first.map.json'), 'utf8')).name, 'Changed externally');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('HTTP workspace operations enforce origin, revision, and reject traversal, while retaining M7 saves', async () => {
  const { dir } = await tempWorkspace(true);
  const workspace = await MapWorkspace.open(join(dir, 'first.map.json'));
  const server = createEditorServer(workspace.getDocument(), workspace.getStore(), undefined, workspace);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const get = (path: string) => fetch(base + path);
    const meta = await (await get('/api/map')).json();
    assert.equal(meta.workspace, true);
    assert.equal(meta.mapFile, 'first.map.json');
    assert.equal((await get('/map-management.mjs')).status, 200);
    const write = (path: string, method: 'PUT' | 'POST', body: unknown, origin = base) => fetch(base + path, {
      method, headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const context = { revision: meta.revision, mapFile: meta.mapFile };
    assert.equal((await write('/api/maps/create', 'POST', { ...context, form: form('second') }, 'http://evil.invalid')).status, 403);
    assert.equal((await write('/api/maps/create', 'POST', { ...context, form: form('../escape') })).status, 400);
    assert.equal((await write('/api/maps/active', 'PUT', { ...context, file: '../x.map.json' })).status, 400);
    assert.equal((await write('/api/maps/create', 'PUT', { ...context, form: form('second') })).status, 405);
    const created = await write('/api/maps/create', 'POST', { ...context, form: form('second') });
    assert.equal(created.status, 200);
    assert.equal((await (await get('/api/map')).json()).mapFile, 'second.map.json');
    assert.equal((await (await get('/api/maps')).json()).maps.length, 2);
    assert.equal((await write('/api/document', 'PUT', { ...context, roads: [] })).status, 409);
    assert.equal((await write('/api/maps/create', 'POST', { ...context, form: form('third') })).status, 409);
    const next = await (await get('/api/map')).json();
    const settingsSaved = await write('/api/maps/settings', 'PUT', { revision: next.revision, mapFile: next.mapFile, settings: settings('New label') });
    assert.equal(settingsSaved.status, 200);
    assert.equal((await (await get('/api/map')).json()).map.name, 'New label');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test('map manager input validation refuses duplicates, empty palette and invalid bounds', () => {
  assert.deepEqual(parsePalette('terrain.grass\n\nterrain.dirt\n'), ['terrain.grass', 'terrain.dirt']);
  assert.throws(() => parsePalette('grass\ngrass'), /unique/);
  assert.throws(() => parsePalette(''), /unique/);
  assert.throws(() => validateCreate({ ...form('hello'), worldSize: [-2, 10] }), /dimensions/);
  assert.throws(() => validateCreate({ ...form('hello'), slug: '../../bad' }), /Filename/);
  assert.deepEqual(validateCreate(form('valid')).surfacePalette, ['terrain.grass', 'terrain.dirt']);
});
