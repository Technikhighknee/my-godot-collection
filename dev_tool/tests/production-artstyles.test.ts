import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  PRODUCTION_ARTSTYLES,validateProductionArtstyle,
  assertGeneratorArtstyleSupport,
} from '../tools/asset-procgen/web/artstyles/production-artstyles.mjs';
import {findGenerator,generateAsset,availableProductionArtstyles}
  from '../tools/asset-procgen/web/generators.mjs';
import {validateSource} from '../src/projects/asset-source.ts';
import {ProjectLibrary} from '../src/projects/library.ts';
import {planAssetBuild} from '../src/projects/build-plan.ts';
import {capturePaintedPixels,encodeRgbaPng} from '../src/projects/build-image.ts';
import type {AssetEntry,AssetSource} from '../src/projects/asset-source.ts';

const original={id:'original',version:1};
const styleOf=(entry:AssetEntry)=>'origin' in entry.source?undefined:entry.source.artstyle;
const recipe=()=>({name:'Village roof',generator:'roof-thatch',
  masterSeed:18174,components:{pattern:18174,color:23512}});

test('production artstyles reject experimental and incompatible versions',()=>{
  assert.deepEqual(PRODUCTION_ARTSTYLES.map(x=>x.id),['original']);
  assert.deepEqual(validateProductionArtstyle(original),original);
  const roof=findGenerator('roof-thatch');
  assert.ok(roof);
  assert.equal(availableProductionArtstyles(roof).length,1);
  assert.deepEqual(assertGeneratorArtstyleSupport(roof,original),original);
  for(const bad of [{id:'naturalistic-study',version:1},
    {id:'original',version:2},{id:'original',version:1,seed:123},
    {id:'unknown',version:1},null]){
    assert.throws(()=>validateProductionArtstyle(bad),/artstyle/i);
  }
  const def=findGenerator('roof-thatch')!;
  const base={format:'devtool-asset',version:1,id:'roof',dependencies:[],
    ...{name:'Roof',generator:{id:def.id,version:1,masterSeed:18174,
      components:{pattern:18174,color:23512}}}};
  assert.equal(validateSource(base,'roof',findGenerator).artstyle,undefined);
  assert.deepEqual(validateSource({...base,artstyle:original},
    'roof',findGenerator).artstyle,original);
  assert.throws(()=>validateSource({...base,artstyle:{id:'watercolor-study',version:1}},
    'roof',findGenerator),/artstyle/i);
});

test('an explicit original style preserves generator results and only affects pinned source keys',()=>{
  const def=findGenerator('roof-thatch');
  assert.ok(def&&def.kind==='image');
  const input=recipe();
  const source={format:'devtool-asset' as const,version:1 as const,
    id:'roof',name:input.name,
    generator:{id:input.generator,version:1,masterSeed:input.masterSeed,
      components:input.components},dependencies:[]};
  const legacy={source,kind:'image' as const,revision:'one'};
  const pinned={source:{...source,artstyle:original},kind:'image' as const,revision:'two'};
  const old=planAssetBuild([legacy],['roof']);
  const revised=planAssetBuild([pinned],['roof']);
  assert.notEqual(old.key,revised.key);
  assert.notEqual(old.nodes[0]?.key,revised.nodes[0]?.key);
  const legacyPixels=capturePaintedPixels(generateAsset(def,input.components),'albedo');
  const pinnedPixels=capturePaintedPixels(
    generateAsset(def,input.components,undefined,1,original),'albedo');
  assert.deepEqual(pinnedPixels.rgba,legacyPixels.rgba);
  assert.throws(()=>generateAsset(def,input.components,undefined,1,
    {id:'naturalistic-study',version:1}),/artstyle/i);
});

test('artstyle pin invalidates its own subgraph but not unrelated resources',()=>{
  const source={format:'devtool-asset' as const,version:1 as const,
    id:'roof',name:'Roof',
    generator:{id:'roof-thatch',version:1,masterSeed:1,
      components:{pattern:1,color:2}},dependencies:[]};
  const related={...source,id:'linked',name:'Linked',dependencies:['asset:roof']};
  const independent={...source,id:'unrelated',name:'Other'};
  const entry=(value:AssetSource):AssetEntry=>({source:value,revision:'source',kind:'image'});
  const originalPlan=planAssetBuild([entry(source),entry(related),entry(independent)],
    ['linked','unrelated']);
  const styledPlan=planAssetBuild([{
    ...entry(source),source:{...source,artstyle:original},
  },entry(related),entry(independent)],['linked','unrelated']);
  const keys=(plan:ReturnType<typeof planAssetBuild>)=>
    new Map(plan.nodes.map(node=>[node.id,node.key]));
  const before=keys(originalPlan),after=keys(styledPlan);
  assert.notEqual(before.get('roof'),after.get('roof'));
  assert.notEqual(before.get('linked'),after.get('linked'));
  assert.equal(before.get('unrelated'),after.get('unrelated'));
});

test('saved style pin survives reopening and preview PNG equals production PNG',async()=>{
  const root=await mkdtemp(join(tmpdir(),'production-style-'));
  try{
    const lib=await ProjectLibrary.open(root,undefined,findGenerator);
    await lib.create('world','World');
    const legacy=await lib.createAsset('legacy',recipe());
    const pinned=await lib.createAsset('pinned',{...recipe(),artstyle:original});
    assert.equal(styleOf(legacy),undefined);
    assert.deepEqual(styleOf(pinned),original);
    const reopened=await ProjectLibrary.open(root,undefined,findGenerator);
    assert.deepEqual(styleOf(await reopened.asset('pinned')),original);
    await assert.rejects(reopened.updateAsset('pinned',{
      ...recipe(),artstyle:{id:'hand-painted-study',version:1},
    },pinned.revision),/artstyle/i);
    assert.equal((await reopened.asset('pinned')).revision,pinned.revision,
      'Rejected style changes must never overwrite the source');
    const result=await reopened.buildAsset('pinned');
    const artifact=result.artifacts.at(-1)!;
    const albedo=artifact.files.find(f=>f.view==='albedo');
    assert.ok(albedo);
    const def=findGenerator('roof-thatch')!;
    assert.equal(def.kind,'image');
    const generated=generateAsset(def,recipe().components,undefined,1,original);
    const pixels=capturePaintedPixels(generated,'albedo');
    const previewPng=encodeRgbaPng(pixels.width,pixels.height,pixels.rgba);
    const producedPng=await readFile(join(root,'world','build','assets',
      'pinned',artifact.key,albedo.file));
    assert.deepEqual(producedPng,previewPng);
    const repeated=await reopened.buildAsset('pinned');
    assert.equal(repeated.built,0);
    assert.equal(repeated.reused,1);
    const unpinned=await reopened.updateAsset('pinned',recipe(),pinned.revision);
    assert.equal(styleOf(unpinned),undefined);
    assert.notEqual(unpinned.revision,pinned.revision);
  }finally{
    await rm(root,{recursive:true,force:true});
  }
});

test('editor retains saved style across resource edits and shared reseeding',async()=>{
  const editor=await readFile(new URL('../tools/asset-procgen/web/app.js',import.meta.url),'utf8');
  const markup=await readFile(new URL('../tools/asset-procgen/web/index.html',import.meta.url),'utf8');
  assert.match(editor,/const selectedArtstyle=/);
  assert.match(editor,/artstyleSelections\.set\(gen\.id,entry\.source\.artstyle\)/);
  assert.match(editor,/artstyle:selectedArtstyle\(\)/);
  assert.match(editor,/artstyle:entry\.source\.artstyle/);
  assert.match(markup,/id="artstyleRow" hidden/);
});
