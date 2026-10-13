import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SEED,createSeedState,deriveSeed,parseSeed,
  updateComponentSeed,updateMasterSeed,validateSeed,
} from '../tools/asset-procgen/web/seed-model.mjs';
import {GENERATORS,findGenerator,generateAsset}
  from '../tools/asset-procgen/web/generators.mjs';
import {DEFAULT_TREE,generateTree} from '../tools/asset-procgen/web/tree.mjs';
import {generateOakFoliage}
  from '../tools/asset-procgen/web/oak-foliage.mjs';

const oak=findGenerator('oak')!;
const fir=findGenerator('fir')!;
const atlas=findGenerator('oak-atlas')!;
const sprig=findGenerator('oak-sprig')!;
const bark=findGenerator('oak-bark')!;
test('catalog exposes current models as independent generator definitions',()=>{
  assert.deepEqual(GENERATORS.map(x=>x.id),['roof-thatch','roof-clay','timber-oak','plaster-lime','timber-building','oak','fir','oak-atlas','oak-sprig','oak-bark']);
  assert.deepEqual(oak.components.map(x=>x.id),['geometry','foliage','leaves','barkStructure','barkSurface','barkColor']);
  assert.deepEqual(fir.components.map(x=>x.id),['geometry']);
  assert.deepEqual(GENERATORS.map(x=>x.kind),['image','image','image','image','model','model','model','image','image','image']);
  assert.deepEqual(atlas.components.map(x=>x.id),['leaves']);
  assert.deepEqual(createSeedState(atlas).components,{leaves:21749});
  assert.deepEqual(sprig.components.map(x=>x.id),['structure','leaves']);
  assert.deepEqual(createSeedState(sprig).components,{structure:19461,leaves:21749});
  assert.deepEqual(bark.components.map(c=>c.id),['structure','surface','color']);
  assert.deepEqual(createSeedState(bark).components,
    {structure:19641,surface:48507,color:21749});
  assert.equal(findGenerator('nonexistent'),null);
  assert.equal(createSeedState(oak).masterSeed,DEFAULT_TREE.seed);
  assert.deepEqual(createSeedState(oak).components,{
    geometry:DEFAULT_TREE.seed,
    foliage:DEFAULT_TREE.seed,
    leaves:21749,
    barkStructure:19641,barkSurface:48507,barkColor:21749,
  });
});
test('unsigned seeds use exact bounds and reject ambiguous input',()=>{
  for(const s of [0,1,19641,MAX_SEED]){
    assert.equal(validateSeed(s),s);
    assert.equal(parseSeed(String(s)),s);
  }
  for(const invalid of [-1,MAX_SEED+1,NaN,Infinity,1.1]){
    assert.throws(()=>validateSeed(invalid));
  }
  for(const invalid of ['', '  ','-1','01','1e2','0x10','4.5',
    '4294967296','Infinity','0; alert(1)']){
    assert.throws(()=>parseSeed(invalid));
  }
  assert.equal(parseSeed(' 19641 '),19641);
});
test('master seed derives components by stable name, not display order',()=>{
  const original=createSeedState(oak);
  const seed=194003;
  const a=updateMasterSeed(oak,original,seed);
  const b=updateMasterSeed(oak,original,seed);
  assert.deepEqual(a,b);
  assert.equal(a.masterSeed,seed);
  assert.equal(a.components.geometry,seed);
  assert.equal(a.components.foliage,deriveSeed(seed,'foliage'));
  assert.equal(a.components.leaves,deriveSeed(seed,'leaves'));
  assert.notEqual(a.components.foliage,a.components.leaves);
  assert.deepEqual(original,createSeedState(oak),'No mutation');
  const reordered={...oak,components:[...oak.components].reverse()};
  assert.deepEqual(updateMasterSeed(reordered,original,seed),a);
  const extended={...oak,components:[...oak.components,{
    id:'bark',label:'Bark texture',initialSeed:10}]};
  const ext=updateMasterSeed(extended,original,seed);
  for(const k of Object.keys(a.components))
    assert.equal(ext.components[k],a.components[k]);
});
test('component overrides remain independent, and seed states are per generator',()=>{
  const state=createSeedState(oak);
  const changed=updateComponentSeed(oak,state,'foliage',1234);
  assert.equal(changed.components.foliage,1234);
  assert.equal(changed.components.geometry,state.components.geometry);
  assert.equal(changed.components.leaves,state.components.leaves);
  assert.equal(changed.masterSeed,state.masterSeed);
  assert.deepEqual(state,createSeedState(oak));
  const pine=updateMasterSeed(fir,createSeedState(fir),987);
  assert.equal(pine.components.geometry,987);
  assert.deepEqual(createSeedState(oak),state);
  assert.throws(()=>updateComponentSeed(oak,state,'missingBark',1),/Unknown/);
  assert.throws(()=>updateComponentSeed(fir,createSeedState(fir),'leaves',1),/Unknown/);
});
test('generated oak composes unmodified wood, independent foliage and leaf atlas',()=>{
  const s=createSeedState(oak);
  const baseline=generateAsset(oak,s.components);
  assert.deepEqual(baseline.wood,generateTree({seed:DEFAULT_TREE.seed}));
  assert.deepEqual(baseline.foliage,generateOakFoliage(baseline.wood));
  assert.equal(baseline.atlasSeed,21749);
  assert.deepEqual(baseline.barkSeeds,
    {structureSeed:19641,surfaceSeed:48507,colorSeed:21749});
  assert.ok(baseline.barkWood);
  assert.equal(baseline.barkWood!.uvs.length,
    baseline.barkWood!.positions.length/3*2);

  const variedLeaves=generateAsset(oak,{
    ...s.components,leaves:123456,
  });
  assert.deepEqual(variedLeaves.wood,baseline.wood);
  assert.deepEqual(variedLeaves.foliage,baseline.foliage);
  assert.equal(variedLeaves.atlasSeed,123456);

  const variedBark=generateAsset(oak,{
    ...s.components,barkStructure:91933,
  });
  assert.deepEqual(variedBark.wood,baseline.wood);
  assert.deepEqual(variedBark.foliage,baseline.foliage);
  assert.deepEqual(variedBark.barkWood,baseline.barkWood);
  assert.notDeepEqual(variedBark.barkSeeds,baseline.barkSeeds);
  assert.equal(variedBark.atlasSeed,baseline.atlasSeed);

  const variedFoliage=generateAsset(oak,{
    ...s.components,foliage:98765,
  });
  assert.deepEqual(variedFoliage.wood,baseline.wood);
  assert.notDeepEqual(variedFoliage.foliage!.positions,baseline.foliage!.positions);
  assert.equal(variedFoliage.foliage!.seed,98765);
  assert.equal(variedFoliage.atlasSeed,21749);

  const variedGeometry=generateAsset(oak,{
    ...s.components,geometry:42,
  });
  assert.notDeepEqual(variedGeometry.wood.positions,baseline.wood.positions);
  assert.ok(variedGeometry.foliage!.positions.every(Number.isFinite));
  assert.equal(variedGeometry.foliage!.seed,s.components.foliage);
  assert.deepEqual(
    generateAsset(oak,{...s.components,geometry:42}),
    variedGeometry,'Repeat must generate byte-identical assets');
});
test('fir remains wood only, and component seeds are validated',()=>{
  const s=createSeedState(fir);
  const model=generateAsset(fir,s.components);
  assert.equal(model.foliage,null);
  assert.equal(model.atlasSeed,null);
  assert.equal(model.wood.seed,s.components.geometry);
  assert.deepEqual(generateAsset(fir,s.components),model);
  assert.throws(()=>generateAsset(oak,{...createSeedState(oak).components,leaves:-1}));
  assert.throws(()=>generateAsset(fir,{geometry:Infinity}));
  assert.throws(()=>generateAsset({...fir},s.components),/Unknown generator/);
});

test('2D atlas generator is independent of tree wood and yields a paintable asset',()=>{
  const state=createSeedState(atlas);
  const image=generateAsset(atlas,state.components);
  assert.equal(image.kind,'image');
  if(image.kind!=='image')throw Error('Expected image asset');
  assert.deepEqual([image.width,image.height,image.tiles,image.channels],
    [1024,1024,16,'RGBA']);
  assert.deepEqual(image.atlas,{columns:4,rows:4});
  const different=generateAsset(atlas,{leaves:500});
  assert.equal(different.kind,'image');
  assert.equal(createSeedState(oak).components.leaves,21749);
  const events:string[]=[];
  const ctx=new Proxy({},{
    get(_target,key){
      if(key==='fill'||key==='stroke')return ()=>{events.push(String(key));};
      if(key==='createLinearGradient')return ()=>({addColorStop(){}});
      return ()=>{};
    },
    set(){return true;},
  });
  const canvas={width:0,height:0,getContext:(kind:string)=>{
    assert.equal(kind,'2d');return ctx;
  }};
  const meta=image.paint(canvas as never);
  assert.equal(canvas.width,1024);
  assert.equal(canvas.height,1024);
  assert.equal((meta as {tiles:number}).tiles,16);
  assert.ok(events.length>500,'The image must paint actual atlas content');
  assert.throws(()=>generateAsset(atlas,{leaves:-5}));
});

test('standalone 3D-grown oak spray bakes independently of tree and atlas',()=>{
  const definition=findGenerator('oak-sprig')!;
  const state=createSeedState(definition);
  const painted=generateAsset(definition,state.components);
  assert.equal(painted.kind,'image');
  if(painted.kind!=='image')throw Error('Expected leaf-spray image');
  assert.equal(painted.id,'oak-sprig');
  assert.deepEqual([painted.width,painted.height,painted.channels],
    [768,768,'RGBA']);
  assert.equal(painted.tiles,undefined);
  assert.equal(painted.atlas,undefined,'An isolated spray is not a tile atlas');
  assert.deepEqual(createSeedState(oak).components,
    {geometry:DEFAULT_TREE.seed,foliage:DEFAULT_TREE.seed,leaves:21749,
      barkStructure:19641,barkSurface:48507,barkColor:21749});
  const updated=updateComponentSeed(definition,state,'leaves',43);
  assert.equal(updated.components.structure,state.components.structure);
  assert.equal(updated.components.leaves,43);
  assert.equal(state.components.leaves,21749);
  assert.throws(()=>generateAsset(definition,{structure:-1,leaves:10}));
});


test('oak bark is a standalone seedable opaque image, not a tree component',()=>{
  const state=createSeedState(bark);
  const asset=generateAsset(bark,state.components);
  assert.equal(asset.kind,'image');
  if(asset.kind!=='image')throw Error('Expected bark albedo');
  assert.deepEqual([asset.id,asset.width,asset.height,asset.channels],
    ['oak-bark',1024,1024,'RGBA']);
  assert.equal(asset.tiles,undefined);
  assert.equal(asset.atlas,undefined);
  const changed=updateComponentSeed(bark,state,'surface',888);
  assert.equal(changed.components.surface,888);
  assert.equal(changed.components.structure,19641);
  assert.equal(changed.components.color,21749);
  assert.deepEqual(createSeedState(oak).components,
    {geometry:DEFAULT_TREE.seed,foliage:DEFAULT_TREE.seed,leaves:21749,
      barkStructure:19641,barkSurface:48507,barkColor:21749});
  assert.throws(()=>generateAsset(bark,{structure:1,surface:-1,color:1}));
});

test('roof, plaster and timber generators publish reusable 2D texture recipes',()=>{
  const thatch=findGenerator('roof-thatch')!;
  const clay=findGenerator('roof-clay')!;
  const timber=findGenerator('timber-oak')!;
  const plaster=findGenerator('plaster-lime')!;
  assert.equal(thatch.kind,'image');
  assert.equal(clay.kind,'image');
  assert.equal(timber.kind,'image');
  assert.equal(plaster.kind,'image');
  assert.deepEqual(createSeedState(plaster).components,
    {structure:47519,pigment:20468,wear:90571});
  assert.deepEqual(createSeedState(timber).components,{grain:37821,color:19257});
  assert.deepEqual(createSeedState(clay).components,{pattern:90317,color:43091});
  assert.deepEqual(createSeedState(thatch).components,{pattern:18174,color:23512});
  const clayAsset=generateAsset(clay,createSeedState(clay).components);
  const thatchAsset=generateAsset(thatch,createSeedState(thatch).components);
  const timberAsset=generateAsset(timber,createSeedState(timber).components);
  const plasterAsset=generateAsset(plaster,createSeedState(plaster).components);
  assert.equal(clayAsset.width,512);
  assert.equal(thatchAsset.height,512);
  assert.equal(timberAsset.width,512);
  assert.equal(plasterAsset.height,512);
  assert.deepEqual(plasterAsset.views,['albedo','normal','roughness']);
  assert.deepEqual(timberAsset.views,['albedo','normal','roughness']);
  assert.deepEqual(clayAsset.views,['albedo','normal','roughness']);
  assert.deepEqual(thatchAsset.views,['albedo','normal','roughness']);
  const building=findGenerator('timber-building')!;
  assert.deepEqual(building.materialSlots.map(x=>[x.id,...x.generators]),[
    ['facadePlaster','plaster-lime'],['timberWood','timber-oak'],
    ['roofThatch','roof-thatch'],['roofClay','roof-clay'],
  ]);
});
