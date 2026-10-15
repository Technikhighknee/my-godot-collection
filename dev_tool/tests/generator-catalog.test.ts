import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {GENERATORS,findGenerator,generateAsset}
  from '../tools/asset-procgen/web/generators.mjs';
import {MATERIAL_GENERATORS}
  from '../tools/asset-procgen/web/generator-definitions/materials.mjs';
import {ARCHITECTURE_GENERATORS}
  from '../tools/asset-procgen/web/generator-definitions/architecture.mjs';
import {VEGETATION_GENERATORS}
  from '../tools/asset-procgen/web/generator-definitions/vegetation.mjs';

const ids=['roof-thatch','roof-clay','timber-oak','plaster-lime','stone-rubble',
  'timber-building','oak','fir','oak-atlas','oak-sprig','oak-bark'];

test('generator declarations stay owned by their capability families',()=>{
  assert.deepEqual(GENERATORS.map(def=>def.id),ids);
  assert.deepEqual(GENERATORS,[...MATERIAL_GENERATORS,
    ...ARCHITECTURE_GENERATORS,...VEGETATION_GENERATORS]);
  assert.ok(Object.isFrozen(GENERATORS));
  for(const definition of GENERATORS){
    assert.strictEqual(findGenerator(definition.id),definition);
    assert.ok(Object.isFrozen(definition));
    assert.ok(definition.recipeVersion>0);
    assert.ok(definition.components.length>0);
    assert.equal(new Set(definition.components.map(c=>c.id)).size,definition.components.length);
  }
  assert.equal(findGenerator('unregistered'),null);
});

test('material slots reference existing image capabilities',()=>{
  for(const definition of GENERATORS){
    for(const slot of definition.materialSlots??[]){
      assert.ok(slot.generators.length>0);
      for(const target of slot.generators)
        assert.equal(findGenerator(target)?.kind,'image',
          definition.id+' / '+slot.id+' references a non-image material');
    }
  }
});

test('registry validates seed values and descriptor identity',()=>{
  const definition=findGenerator('roof-thatch');
  assert.ok(definition);
  const seeds=Object.fromEntries(definition.components.map(c=>[c.id,c.initialSeed]));
  const generated=generateAsset(definition,seeds);
  assert.equal(generated.id,definition.id);
  assert.equal(generated.kind,'image');
  assert.throws(()=>generateAsset(definition,{...seeds,pattern:-1}),/seed/i);
  assert.throws(()=>generateAsset({...definition},seeds),/Unknown generator/);
});

test('registry has no specialized generator implementations',async()=>{
  const file=fileURLToPath(new URL('../tools/asset-procgen/web/generators.mjs',import.meta.url));
  const source=await readFile(file,'utf8');
  assert.doesNotMatch(source,/makeRoofAsset|generateBuildingFamily|generateOakFoliage/);
  assert.doesNotMatch(source,/\.\/building\.mjs|\.\/tree\.mjs/);
});
