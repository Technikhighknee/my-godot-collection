import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {findGenerator, generateAsset, availableProductionArtstyles}
  from '../tools/asset-procgen/web/generators.mjs';
import {capturePaintedPixels, encodeRgbaPng}
  from '../src/projects/build-image.ts';
import {ProjectLibrary} from '../src/projects/library.ts';

const materialIds = [
  'roof-thatch', 'roof-clay', 'timber-oak', 'plaster-lime', 'stone-rubble'
] as const;
const styles = ['hand-painted', 'retro-3d', 'naturalistic', 'watercolor'] as const;
const styleRef = (id: string) => ({id, version: 1});

function seedsOf(id: typeof materialIds[number]): Record<string, number> {
  const generator = findGenerator(id);
  assert.ok(generator);
  return Object.fromEntries(
    generator.components.map(component => [component.id, component.initialSeed])
  );
}

function image(id: typeof materialIds[number], style: string, seeds = seedsOf(id)) {
  const generator = findGenerator(id);
  assert.ok(generator?.kind === 'image');
  const result = generateAsset(generator, seeds, undefined, 1, styleRef(style));
  assert.equal(result.kind, 'image');
  return result;
}

test('five material producers advertise all four saved native artstyles', () => {
  for (const id of materialIds) {
    const generator = findGenerator(id);
    assert.ok(generator?.kind === 'image');
    assert.deepEqual(
      availableProductionArtstyles(generator).map(style => style.id),
      ['original', ...styles]
    );
    assert.deepEqual(
      generator.productionStyleGeneration?.styles.map(style => style.id),
      styles
    );
  }
  const building = findGenerator('timber-building');
  assert.ok(building);
  assert.deepEqual(
    availableProductionArtstyles(building).map(style => style.id),
    ['original'],
    'Do not pretend that the model grammar itself has been art-directed'
  );
});

test('production and Study consume identical seeded surface grammars', () => {
  // Compare actual pixels, not names, declarations or preview screenshots.
  // Every studied interpretation must be reproducible as a project asset.
  for (const id of materialIds) {
    const generator = findGenerator(id);
    assert.ok(generator?.kind === 'image' && generator.studyGeneration);
    const seeds = seedsOf(id);
    const profile = id === 'timber-oak' ? 'panel' : undefined;
    for (const style of styles) {
      const production = image(id, style, seeds);
      const study = generator.studyGeneration.generate(seeds, style + '-study');
      const a = capturePaintedPixels(production, 'albedo', profile);
      const b = capturePaintedPixels(study, 'albedo', profile);
      assert.equal(a.width, b.width);
      assert.equal(a.height, b.height);
      assert.deepEqual(a.rgba, b.rgba, id + ' / ' + style);
    }
  }
});

test('a saved Naturalistic material is baked into the actual Godot terrain export', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-production-style-'));
  try {
    const library = await ProjectLibrary.open(root, undefined, findGenerator);
    await library.create('world', 'World');
    const seeds = seedsOf('roof-clay');
    const source = {
      name: 'Naturalistic clay roof',
      generator: 'roof-clay',
      masterSeed: seeds.pattern!,
      components: seeds,
      artstyle: styleRef('naturalistic'),
    };
    const saved = await library.createAsset('clay', source);
    const asset = (await library.asset('clay')).source;
    if ('origin' in asset) {
      throw Error('Expected an authored procedural material');
    }
    assert.deepEqual(asset.artstyle, styleRef('naturalistic'));
    const first = await library.buildAsset('clay');
    const artifact = first.artifacts.find(value => value.id === 'clay');
    assert.ok(artifact);
    const albedo = artifact.files.find(value => value.view === 'albedo');
    const normal = artifact.files.find(value => value.view === 'normal');
    const roughness = artifact.files.find(value => value.view === 'roughness');
    assert.ok(albedo && normal && roughness);
    const expectedAlbedo = encodeRgbaPng(
      ...(() => {
        const {width, height, rgba} = capturePaintedPixels(
          image('roof-clay', 'naturalistic', seeds), 'albedo'
        );
        return [width, height, rgba] as const;
      })()
    );
    const produced = await readFile(join(root, 'world', 'build', 'assets',
      'clay', artifact.key, albedo.file));
    assert.deepEqual(produced, expectedAlbedo);
    assert.equal((await library.buildAsset('clay')).reused, 1);

    const workspace = library.mapWorkspace()!;
    const map = workspace.getDocument().map;
    await workspace.saveSettings({
      name: map.name,
      min_height: map.terrain.min_height,
      max_height: map.terrain.max_height,
      surface_palette: map.terrain.surface_palette,
      surface_materials: {
        'terrain.grass': {asset: 'asset:clay', tile_size: 4},
      },
    }, workspace.getRevision(), workspace.getFile());

    const exported = await library.exportGodotScene('world');
    const terrain = await readFile(join(exported.directory, 'geometry', 'terrain.glb'));
    assert.ok(terrain.includes(produced),
      'Godot terrain GLB must embed the same native-produced image');
    assert.ok(exported.manifest.sourceKey);
    const updated = await library.updateAsset('clay', {
      ...source,
      artstyle: styleRef('watercolor'),
    }, saved.revision);
    assert.ok(updated.revision !== saved.revision);
    const next = await library.exportGodotScene('world');
    assert.notEqual(next.manifest.sourceKey, exported.manifest.sourceKey);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
