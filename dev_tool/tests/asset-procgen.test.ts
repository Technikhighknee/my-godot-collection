import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadMap } from '../tools/map-editor/src/io/map-io.ts';
import { createEditorServer } from '../tools/map-editor/src/server.ts';
import { DEFAULT_RECIPE, generateTree, generateSkeleton, validateRecipe, variantSeeds } from '../tools/asset-procgen/web/tree.mjs';
import { exportGlb, inspectGlb } from '../tools/asset-procgen/web/glb.mjs';

const fresh = () => structuredClone(DEFAULT_RECIPE);
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

test('oak recipe contract is strict, bounded and canonical', () => {
  const recipe = validateRecipe(fresh());
  assert.equal(recipe.schema, '1400.asset.recipe');
  assert.equal(recipe.generator, 'oak');
  assert.equal(recipe.revision, 1);
  assert.equal(recipe.name, 'Oak 01');
  assert.deepEqual(validateRecipe(JSON.parse(JSON.stringify(recipe))), recipe);
  for (const bad of [
    { ...recipe, revision: 9 }, { ...recipe, generator: 'birch' },
    { ...recipe, name: '' }, { ...recipe, name: 'x'.repeat(61) },
    { ...recipe, seed: -1 }, { ...recipe, seed: 0x100000000 },
    { ...recipe, seed: 0.1 }, { ...recipe, unknown: 'surprise' },
    { ...recipe, parameters: { ...recipe.parameters, height: NaN } },
    { ...recipe, parameters: { ...recipe.parameters, height: 10000 } },
    { ...recipe, parameters: { ...recipe.parameters, crownRadius: Infinity } },
    { ...recipe, parameters: { ...recipe.parameters, missing: 1 } },
    { ...recipe, parameters: { ...recipe.parameters, trunkRadius: 1.1, crownRadius: 1 } },
  ]) assert.throws(() => validateRecipe(bad));
  assert.equal(validateRecipe({ ...recipe, name: '  Tree  ' }).name, 'Tree');
});

test('oak develops a hierarchical branch skeleton before meshing', () => {
  const recipe = fresh();
  const structure = generateSkeleton(recipe);
  const branches = new Map(structure.branches.map(b => [b.id, b]));
  assert.equal(branches.size, structure.branches.length);
  assert.equal(branches.get(1)?.generation, 0);
  const generations = new Set(structure.branches.map(b => b.generation));
  assert.deepEqual([...generations].sort(), [0, 1, 2, 3, 4]);
  for (const branch of structure.branches) {
    if (branch.parentId !== null) {
      const parent = branches.get(branch.parentId);
      assert.ok(parent, 'Missing parent');
      assert.equal(parent.generation + 1, branch.generation);
    }
    assert.ok(branch.points.length >= 4);
    assert.equal(branch.points.length, branch.radii.length);
    assert.ok(branch.vigor > 0 && branch.vigor <= 1);
    for (const point of branch.points)
      assert.ok(point.length === 3 && point.every(Number.isFinite));
    assert.ok(branch.radii.every(radius => radius > 0 && Number.isFinite(radius)));
  }
  for (const anchor of structure.leafAnchors) {
    const twig = branches.get(anchor.branchId);
    assert.equal(twig?.generation, 4, 'Leaf is attached to a terminal shoot');
    assert.ok(anchor.position.every(Number.isFinite));
    assert.ok(anchor.size > 0);
    assert.ok(Math.abs(Math.hypot(...anchor.direction) - 1) < 1e-6);
  }
  assert.ok(structure.leafAnchors.length > 150);
  assert.deepEqual(generateSkeleton(recipe), structure, 'Meshing must not control structural randomness');
});

test('growth and foliage parameters change the intended parts of the tree', () => {
  const base = fresh(), quiet = generateTree({
    ...base, parameters: { ...base.parameters, branchDensity: .2 }
  }), dense = generateTree({
    ...base, parameters: { ...base.parameters, branchDensity: 1 }
  });
  assert.ok(dense.stats.branches > quiet.stats.branches, 'Branch density controls structural complexity');
  const sparseLeaves = generateTree({
    ...base, parameters: { ...base.parameters, leafDensity: .15 }
  });
  assert.ok(sparseLeaves.stats.leaves < generateTree(base).stats.leaves);
  assert.deepEqual(sparseLeaves.model.wood.positions, generateTree(base).model.wood.positions,
    'Leaf density must not regenerate a different woody structure');
  const tall = generateSkeleton({
    ...base, parameters: { ...base.parameters, height: 22 }
  });
  assert.ok(tall.branches[0].points.at(-1)![1] > generateSkeleton(base).branches[0].points.at(-1)![1]);
});

test('wood inspection controls exist without changing the exported asset', () => {
  const html = readFileSync(new URL('../tools/asset-procgen/web/index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../tools/asset-procgen/web/app.js', import.meta.url), 'utf8');
  assert.match(html, /id="woodOnly"/);
  assert.match(html, /id="skeletonView"/);
  assert.match(html, /LEAF ANCHORS/);
  assert.match(app, /structure\.visible=viewMode==='skeleton'/);
  assert.match(app, /exportGlb\(generated\)/);
});

test('generator produces finite indexed geometry and never mutates the input recipe', () => {
  const recipe = fresh(), before = JSON.stringify(recipe);
  const result = generateTree(recipe);
  assert.equal(JSON.stringify(recipe), before);
  assert.deepEqual(result.recipe, recipe);
  assert.ok(result.stats.branches > 40);
  assert.ok(result.stats.leaves > 800);
  assert.ok(result.stats.clusters > 150, 'Foliage has anchors on terminal shoots');
  assert.equal(result.skeleton.leafAnchors.length, result.stats.clusters);
  assert.ok(result.stats.triangles > 3000 && result.stats.triangles < 200000);
  let triangles = 0;
  for (const mesh of Object.values(result.model)) {
    assert.ok(mesh.positions instanceof Float32Array);
    assert.ok(mesh.normals instanceof Float32Array);
    assert.ok(mesh.colors instanceof Float32Array);
    assert.ok(mesh.indices instanceof Uint32Array);
    const count = mesh.positions.length / 3;
    assert.ok(Number.isInteger(count) && count > 100);
    assert.equal(mesh.normals.length, mesh.positions.length);
    assert.equal(mesh.colors.length, mesh.positions.length);
    assert.equal(mesh.indices.length % 3, 0);
    assert.ok(mesh.positions.every(Number.isFinite));
    assert.ok(mesh.normals.every(Number.isFinite));
    assert.ok(mesh.colors.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
    assert.ok(mesh.indices.every(index => index < count));
    triangles += mesh.indices.length / 3;
  }
  assert.equal(triangles, result.stats.triangles);
  assert.ok(Math.max(...result.model.wood.positions.filter((_, i) => i % 3 === 1)) > recipe.parameters.height*.7);
});


test('bark and foliage triangle winding agrees with outward vertex normals', () => {
  const { model } = generateTree(fresh());
  for (const [part, mesh] of Object.entries(model)) {
    const { positions: P, normals: N, indices: I } = mesh;
    let inverted = 0, degenerate = 0;
    for (let i = 0; i < I.length; i += 3) {
      const a = I[i], b = I[i + 1], c = I[i + 2];
      const ux = P[b*3]-P[a*3], uy = P[b*3+1]-P[a*3+1], uz = P[b*3+2]-P[a*3+2];
      const vx = P[c*3]-P[a*3], vy = P[c*3+1]-P[a*3+1], vz = P[c*3+2]-P[a*3+2];
      const nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx;
      const area2 = Math.hypot(nx, ny, nz);
      if (area2 < 1e-10) { degenerate++; continue; }
      const facing = nx*(N[a*3]+N[b*3]+N[c*3]) +
        ny*(N[a*3+1]+N[b*3+1]+N[c*3+1]) +
        nz*(N[a*3+2]+N[b*3+2]+N[c*3+2]);
      if (facing < -1e-9) inverted++;
    }
    assert.equal(degenerate, 0, part + ' contains degenerate triangles');
    assert.equal(inverted, 0, part + ' has inward-facing triangles');
  }
});

test('identical seeds reproduce geometry and variants really change it', () => {
  const a = fresh(), one = generateTree(a), same = generateTree(a);
  for (const key of ['wood', 'foliage'] as const) {
    assert.equal(digest(new Uint8Array(one.model[key].positions.buffer)), digest(new Uint8Array(same.model[key].positions.buffer)));
    assert.equal(digest(new Uint8Array(one.model[key].indices.buffer)), digest(new Uint8Array(same.model[key].indices.buffer)));
  }
  const seeds = variantSeeds(a.seed);
  assert.equal(seeds.length, 4);
  assert.equal(new Set(seeds).size, 4);
  assert.deepEqual(seeds, variantSeeds(a.seed));
  const other = generateTree({ ...a, seed: seeds[0] });
  assert.notEqual(digest(new Uint8Array(one.model.wood.positions.buffer)),
                  digest(new Uint8Array(other.model.wood.positions.buffer)));
});

test('extreme but valid parameters stay bounded and exportable', () => {
  const base = fresh();
  for (const recipe of [
    { ...base, seed: 0, parameters: { ...base.parameters, height: 3, crownRadius: 1, trunkRadius: .12, branchDensity: .2, leafDensity: .15, asymmetry: 0 } },
    { ...base, seed: 0xffffffff, parameters: { ...base.parameters, height: 24, crownRadius: 11, trunkRadius: 1.1, branchDensity: 1, leafDensity: 1, asymmetry: 1 } }
  ]) {
    const model = generateTree(recipe);
    assert.ok(model.stats.triangles < 200000);
    const bytes = exportGlb(model);
    assert.equal(inspectGlb(bytes).meshes[0].primitives.length, 2);
  }
});

test('GLB export is deterministic, self-contained and binary attributes round-trip exactly', () => {
  const generated = generateTree(fresh());
  const bytes = exportGlb(generated);
  assert.equal(digest(bytes), digest(exportGlb(generateTree(fresh()))));
  const gltf = inspectGlb(bytes);
  assert.equal(gltf.asset.version, '2.0');
  assert.deepEqual(gltf.extras.recipe, generated.recipe);
  assert.deepEqual(gltf.materials.map(m => m.name), ['Bark', 'Leaves']);
  assert.equal(gltf.materials[1].doubleSided, true);
  assert.equal(gltf.meshes.length, 1);
  assert.equal(gltf.meshes[0].primitives.length, 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const binaryStart = 20 + jsonLength + 8;
  for (const [index, key] of ['wood', 'foliage'].entries()) {
    const primitive = gltf.meshes[0].primitives[index];
    assert.equal(primitive.material, index);
    for (const [semantic, data] of Object.entries({
      POSITION: generated.model[key as 'wood' | 'foliage'].positions,
      NORMAL: generated.model[key as 'wood' | 'foliage'].normals,
      COLOR_0: generated.model[key as 'wood' | 'foliage'].colors,
      INDICES: generated.model[key as 'wood' | 'foliage'].indices,
    })) {
      const accessor = gltf.accessors[semantic === 'INDICES' ? primitive.indices : primitive.attributes[semantic]];
      const slice = gltf.bufferViews[accessor.bufferView];
      assert.equal(slice.byteLength, data.byteLength);
      const actual = bytes.subarray(binaryStart + slice.byteOffset, binaryStart + slice.byteOffset + slice.byteLength);
      const expected = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      assert.deepEqual(actual, expected);
    }
  }
  const corrupted = new Uint8Array(bytes);
  corrupted[0] = 0;
  assert.throws(() => inspectGlb(corrupted), /Invalid GLB header/);
  assert.throws(() => inspectGlb(bytes.subarray(0, 21)));
});

test('Asset ProcGen web modules pass node syntax checking', () => {
  for (const moduleName of ['app.js', 'tree.mjs', 'math.mjs', 'oak.mjs', 'growth.mjs', 'meshing.mjs', 'glb.mjs']) {
    const path = new URL('../tools/asset-procgen/web/' + moduleName, import.meta.url);
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', fileURLToPath(path)], { stdio: 'pipe' }));
  }
});

test('local HTTP serves ProcGen without exposing source files or changing Map Editor endpoints', async () => {
  const doc = await loadMap('../map_system/coastal_relief.map.json');
  const server = createEditorServer(doc);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();assert.ok(address && typeof address !== 'string');
    const base = 'http://127.0.0.1:' + address.port;
    for (const path of ['/tools/asset-procgen/', '/tools/asset-procgen']) {
      const page = await fetch(base + path);
      assert.equal(page.status, 200);
      assert.match(page.headers.get('content-type') ?? '', /text\/html/);
      assert.match(await page.text(), /1400 · Asset ProcGen/);
    }
    for (const suffix of ['app.js', 'tree.mjs', 'math.mjs', 'oak.mjs', 'growth.mjs', 'meshing.mjs', 'glb.mjs', 'style.css']) {
      const path = '/tools/asset-procgen/' + suffix;
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get('content-type') ?? '', suffix.endsWith('.css') ? /css/ : /javascript/);
      assert.ok((await response.text()).length > 100);
    }
    assert.equal((await fetch(base + '/api/map')).status, 200);
    assert.equal((await fetch(base + '/tools/map-editor/')).status, 200);
    assert.equal((await fetch(base + '/tools/asset-procgen/../src/server.ts')).status, 404);
    assert.equal((await fetch(base + '/tools/asset-procgen/', { method:'POST' })).status, 405);
    const home = await fetch(base + '/');
    assert.match(await home.text(), /href="\/tools\/asset-procgen\/"/);
  } finally {
    await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
