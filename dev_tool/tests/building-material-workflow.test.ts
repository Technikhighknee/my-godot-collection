import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {findGenerator} from '../tools/asset-procgen/web/generators.mjs';
import {planBuildingMaterialSet}
  from '../tools/asset-procgen/web/building-material-set.mjs';
import {ProjectLibrary} from '../src/projects/library.ts';
import {createProjectRouter} from '../src/projects/router.ts';
import {createDevToolServer} from '../src/server.ts';
import {DEFAULT_BUILDING_OPTIONS}
  from '../tools/asset-procgen/web/building.mjs';

const naturalistic = {id: 'naturalistic', version: 1};
const handPainted = {id: 'hand-painted', version: 1};
const watercolor = {id: 'watercolor', version: 1};
const building = findGenerator('timber-building');
assert.ok(building?.kind === 'model' && building.materialSlots);

function plan(
  style: typeof naturalistic,
  assignments: Record<string, string> = {},
  available: Map<string, any> = new Map(),
  nonce = 'ab1234'
) {
  return planBuildingMaterialSet(building!, style, assignments, available, nonce);
}

async function temporary(fn: (lib: ProjectLibrary, root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'styled-building-workflow-'));
  try {
    const lib = await ProjectLibrary.open(root, undefined, findGenerator);
    await lib.create('world', 'World');
    await fn(lib, root);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
}

function metadata(glb: Buffer) {
  assert.equal(glb.readUInt32LE(0), 0x46546c67);
  return JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
}

function meshPositions(glb: Buffer): number[][] {
  const document = metadata(glb);
  const binaryOffset = 20 + glb.readUInt32LE(12) + 8;
  return document.meshes.flatMap((mesh: any) =>
    mesh.primitives.map((primitive: any) => {
      const accessor = document.accessors[primitive.attributes.POSITION];
      const view = document.bufferViews[accessor.bufferView];
      assert.equal(accessor.componentType, 5126);
      assert.equal(accessor.type, 'VEC3');
      const offset = binaryOffset + view.byteOffset + (accessor.byteOffset ?? 0);
      return Array.from({length: accessor.count * 3}, (_, index) =>
        glb.readFloatLE(offset + index * 4));
    }));
}

test('a building creates five reusable materials with independent style and stable seeds', () => {
  const first = plan(naturalistic);
  assert.equal(first.assets.length, 5);
  assert.deepEqual(Object.keys(first.materials), [
    'foundationStone', 'facadePlaster', 'timberWood', 'roofThatch', 'roofClay'
  ]);
  assert.equal(new Set(first.assets.map(asset => asset.id)).size, 5);
  assert.ok(first.assets.every(asset =>
    asset.artstyle.id === 'naturalistic' && asset.artstyle.version === 1
  ));
  const available = new Map(first.assets.map(asset => [asset.id, {
    source: {
      generator: {
        id: asset.generator,
        masterSeed: asset.masterSeed,
        components: asset.components,
      },
    },
  }]));
  const before = structuredClone(first.assets);
  const second = plan(handPainted, first.materials, available, 'cd5678');
  assert.deepEqual(
    second.assets.map(({generator, masterSeed, components}) =>
      ({generator, masterSeed, components})),
    first.assets.map(({generator, masterSeed, components}) =>
      ({generator, masterSeed, components})),
    'Switching style must preserve all individual pattern and pigment seeds'
  );
  assert.notDeepEqual(second.materials, first.materials);
  assert.deepEqual(first.assets, before, 'Planner cannot change saved resources');
  assert.throws(() => plan({id: 'original', version: 1}), /artstyle/i);
  assert.throws(() => plan(watercolor), /artstyle/i,
    'Disabled Watercolor cannot be used for new building material sets');
  assert.throws(() => plan(handPainted, first.materials), /Missing project material/);
  assert.throws(() => plan(handPainted, {}, new Map(), 'bad!'), /identifier/);
});

test('material set creation validates the whole request and rolls back on conflicts', async () => {
  await temporary(async lib => {
    const first = plan(naturalistic);
    const entries = await lib.createMaterialAssets(first.assets);
    assert.equal(entries.length, 5);
    assert.deepEqual((await lib.assets()).map(asset => asset.source.id).sort(),
      first.assets.map(asset => asset.id).sort());
    for (const entry of entries) {
      assert.equal('origin' in entry.source, false);
      if ('origin' in entry.source) throw Error('Expected procedural source');
      assert.deepEqual(entry.source.artstyle, naturalistic);
    }
    const before = (await lib.assets()).length;
    const next = plan(handPainted, {}, new Map(), 'zz7654').assets;
    await assert.rejects(lib.createMaterialAssets([
      next[0], {...next[1], artstyle: {id: 'missing', version: 1}}
    ]), /artstyle/i);
    assert.equal((await lib.assets()).length, before);
    await assert.rejects(lib.createMaterialAssets([
      next[0], first.assets[0]
    ]), /EEXIST/);
    assert.equal((await lib.assets()).length, before);
    await assert.rejects(lib.createMaterialAssets([
      next[0], {...next[0]}
    ]), /Duplicate material resource ID/);
    assert.equal((await lib.assets()).length, before);
  });
});

test('material-set API saves one consistent project-owned batch', async () => {
  await temporary(async lib => {
    const server = createDevToolServer(
      createProjectRouter(lib, {buildings: []})
    );
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const addr = server.address();
      assert.ok(addr && typeof addr !== 'string');
      const base = 'http://127.0.0.1:' + addr.port;
      const url = base + '/api/projects/active/assets/batch';
      const payload = JSON.stringify({
        assets: plan(naturalistic).assets,
      });
      const request = (projectId: string) => fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-Id': projectId,
          Origin: base,
        },
        body: payload,
      });
      assert.equal((await request('another-project')).status, 409);
      assert.equal((await lib.assets()).length, 0);
      const created = await request('world');
      assert.equal(created.status, 201);
      const body = await created.json();
      assert.equal(body.assets.length, 5);
      assert.deepEqual(
        body.assets.map((item: any) => item.source.artstyle),
        Array(5).fill(naturalistic)
      );
      assert.equal((await lib.assets()).length, 5);
      assert.notEqual((await request('world')).status, 201,
        'A repeated request must not silently overwrite existing sources');
      assert.equal((await lib.assets()).length, 5);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close(error => error ? reject(error) : resolve()));
    }
  });
});

test('the same building geometry exports different saved PBR styles and retains source links', async () => {
  await temporary(async (lib, root) => {
    const first = plan(naturalistic);
    const selected = first.assets.filter(asset =>
      asset.generator === 'roof-clay' || asset.generator === 'plaster-lime');
    await lib.createMaterialAssets(selected);
    const slots = Object.fromEntries(Object.entries(first.materials)
      .filter(([slot]) => slot === 'roofClay' || slot === 'facadePlaster'));
    const seeds = Object.fromEntries(building!.components.map(component =>
      [component.id, component.initialSeed]));
    const source = {
      name: 'Production townhouse',
      generator: 'timber-building',
      masterSeed: building!.initialMasterSeed,
      components: seeds,
      options: {...DEFAULT_BUILDING_OPTIONS},
    };
    await lib.createAsset('natural-house', {...source, materials: slots});
    const built = await lib.buildAsset('natural-house');
    assert.deepEqual(built.artifacts.map(artifact => artifact.id).sort(),
      [...selected.map(asset => asset.id), 'natural-house'].sort());
    const model = built.artifacts.find(artifact => artifact.id === 'natural-house');
    assert.ok(model);
    const file = model.files.find(file => file.file === 'level-2-exterior.glb');
    assert.ok(file);
    const firstGlb = await readFile(join(root, 'world', 'build',
      'assets', 'natural-house', model.key, file.file));
    const artifact = metadata(firstGlb);
    for (const slot of ['roofClay', 'facadePlaster']) {
      assert.ok(artifact.materials.some((mat: any) =>
        mat.extras?.resourceSlot === slot &&
        mat.pbrMetallicRoughness?.baseColorTexture && mat.normalTexture
      ), 'Model must embed project PBR channels for ' + slot);
    }
    const packageFirst = await lib.exportGodot('natural-house');
    assert.equal(packageFirst.manifest.root, 'natural-house');
    for (const id of [...selected.map(asset => asset.id), 'natural-house']) {
      assert.ok(packageFirst.manifest.resources.some(resource => resource.id === id),
        'Godot package must include source dependency ' + id);
    }
    assert.deepEqual(
      await readFile(join(packageFirst.directory, 'assets',
        'natural-house', 'level-2-exterior.glb')),
      firstGlb,
      'Godot package must copy exact baked textured model bytes'
    );
    const sourceRecord = await lib.asset('natural-house');
    assert.deepEqual(
      'origin' in sourceRecord.source ? null : sourceRecord.source.materials,
      slots
    );
    const changed = plan(handPainted, first.materials,
      new Map(first.assets.map(asset => [asset.id, {
        source: {generator: {
          id: asset.generator,
          masterSeed: asset.masterSeed,
          components: asset.components,
        }},
      }])), 'uv9843');
    const next = changed.assets.filter(asset =>
      asset.generator === 'roof-clay' || asset.generator === 'plaster-lime');
    await lib.createMaterialAssets(next);
    const nextSlots = Object.fromEntries(Object.entries(changed.materials)
      .filter(([slot]) => slot === 'roofClay' || slot === 'facadePlaster'));
    await lib.createAsset('hand-painted-house', {...source, materials: nextSlots});
    const other = await lib.buildAsset('hand-painted-house');
    const otherModel = other.artifacts.find(value => value.id === 'hand-painted-house');
    assert.ok(otherModel);
    const secondGlb = await readFile(join(root, 'world', 'build',
      'assets', 'hand-painted-house', otherModel.key, 'level-2-exterior.glb'));
    assert.deepEqual(meshPositions(firstGlb), meshPositions(secondGlb),
      'The geometry must stay identical across material artstyles');
    assert.notDeepEqual(firstGlb, secondGlb,
      'The model exports must contain different PBR material bytes');

    const firstRoof = built.artifacts.find(a => a.id === selected[0]?.id);
    const secondRoof = other.artifacts.find(a => a.id === next[0]?.id);
    assert.ok(firstRoof && secondRoof);
    const firstAlbedo = firstRoof.files.find(f => f.view === 'albedo');
    const secondAlbedo = secondRoof.files.find(f => f.view === 'albedo');
    assert.ok(firstAlbedo && secondAlbedo);
    const png = (id: string, key: string, name: string) =>
      readFile(join(root, 'world', 'build', 'assets', id, key, name));
    assert.notDeepEqual(
      await png(firstRoof.id, firstRoof.key, firstAlbedo.file),
      await png(secondRoof.id, secondRoof.key, secondAlbedo.file),
      'Style must change actual saved pigment pixels, not only metadata'
    );
    const packageSecond = await lib.exportGodot('hand-painted-house');
    assert.deepEqual(
      await readFile(join(packageSecond.directory, 'assets',
        'hand-painted-house', 'level-2-exterior.glb')),
      secondGlb,
      'The alternate style must also arrive in the actual Godot package'
    );
    assert.equal((await lib.buildAsset('hand-painted-house')).built, 0);
  });
});

test('building editor exposes one style-set action and its WebGL cache includes style', async () => {
  const root = new URL('../tools/asset-procgen/web/', import.meta.url);
  const markup = await readFile(new URL('index.html', root), 'utf8');
  const editor = await readFile(new URL('app.js', root), 'utf8');
  const viewport = await readFile(new URL('viewport-3d.mjs', root), 'utf8');
  assert.match(markup, /id="buildingMaterialStyle"/);
  assert.match(markup, /id="createBuildingMaterialSet"/);
  assert.match(editor, /planBuildingMaterialSet\(/);
  assert.match(editor, /studio:project-assets-changed/);
  assert.match(editor, /materialAssignments\.set\(active\.id, plan\.materials\)/);
  assert.match(viewport, /artstyle: image\.sourceStyle/);
});
