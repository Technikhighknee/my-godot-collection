import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectLibrary} from '../src/projects/library.ts';
import {encodeModelGlb} from '../src/projects/build-glb.ts';
import {encodeRgbaPng} from '../src/projects/build-image.ts';
import {canonicalBuildingModel,canonicalTreeModel,canonicalOakWoodModel}
  from '../tools/asset-procgen/web/canonical-model.mjs';
import {findGenerator,generateAsset} from
  '../tools/asset-procgen/web/generators.mjs';
import {DEFAULT_BUILDING_OPTIONS,generateBuildingFamily} from
  '../tools/asset-procgen/web/building.mjs';

function glbDocument(glb:Uint8Array){
  const data=new DataView(glb.buffer,glb.byteOffset,glb.byteLength);
  assert.equal(data.getUint32(0,true),0x46546c67);
  assert.equal(data.getUint32(4,true),2);
  assert.equal(data.getUint32(8,true),glb.length);
  const jsonLength=data.getUint32(12,true);
  assert.equal(data.getUint32(16,true),0x4e4f534a);
  assert.equal(jsonLength%4,0);
  const json=JSON.parse(new TextDecoder().decode(
    glb.subarray(20,20+jsonLength)).trimEnd());
  const offset=20+jsonLength;
  const binarySize=data.getUint32(offset,true);
  assert.equal(data.getUint32(offset+4,true),0x004e4942);
  assert.equal(offset+8+binarySize,glb.length);
  const binary=glb.subarray(offset+8);
  assert.equal(json.buffers[0].byteLength,binary.length);
  for(const view of json.bufferViews){
    assert.equal(view.byteOffset%4,0);
    assert.ok(view.byteOffset+view.byteLength<=binary.length);
  }
  return {json,binary};
}
function getFloat32(doc:ReturnType<typeof glbDocument>,id:number){
  const accessor=doc.json.accessors[id],view=doc.json.bufferViews[accessor.bufferView];
  const components:Record<string,number>={SCALAR:1,VEC2:2,VEC3:3};
  assert.ok(Object.hasOwn(components,accessor.type),'Unsupported glTF accessor type');
  const length=accessor.count*components[accessor.type];
  const bytes=new DataView(doc.binary.buffer,
    doc.binary.byteOffset+view.byteOffset,view.byteLength);
  return Array.from({length},(_,index)=>bytes.getFloat32(index*4,true));
}
const seed={structure:19043,material:62191};

test('canonical buildings retain original mesh buffers and explicit material meaning',()=>{
  const building=generateBuildingFamily(seed,DEFAULT_BUILDING_OPTIONS,2);
  const converted=canonicalBuildingModel(building,'exterior')!;
  const original=building.building.exterior.parts;
  assert.equal(converted.meshes.length,original.length);
  for(let i=0;i<original.length;i++){
    const from=original[i]!,to=converted.meshes[i]!;
    assert.strictEqual(to.positions,from.positions);
    assert.strictEqual(to.normals,from.normals);
    assert.strictEqual(to.indices,from.indices);
    assert.strictEqual(to.uvs,from.uvs);
    assert.equal(to.material.baseColor,from.surface.baseColor);
    assert.equal(to.material.slot,from.surface.slot);
    assert.equal(to.material.profile,from.surface.profile);
  }
  const encoded=encodeModelGlb(converted);
  const doc=glbDocument(encoded);
  assert.equal(doc.json.meshes.length,original.length);
  const first=original[0]!;
  const attributes=doc.json.meshes[0].primitives[0].attributes;
  assert.deepEqual(getFloat32(doc,attributes.POSITION).slice(0,12),
    [...first.positions.slice(0,12)]);
  assert.ok(doc.json.materials.some((m:{extras?:{resourceSlot?:string}})=>
    m.extras?.resourceSlot==='timberWood'));
  assert.ok(doc.json.materials.some((m:{extras?:{profile?:string}})=>
    m.extras?.profile==='end'));
  const uvOriginal=original.find(p=>p.uvs.length>0)!;
  const ix=original.indexOf(uvOriginal);
  const uvId=doc.json.meshes[ix].primitives[0].attributes.TEXCOORD_0;
  assert.ok(uvId!==undefined);
  const uv=getFloat32(doc,uvId);
  assert.ok(Math.abs(uv[0]-uvOriginal.uvs[0]!)<1e-6);
  assert.ok(Math.abs(uv[1]-(1-uvOriginal.uvs[1]!))<1e-6);
  assert.deepEqual(encodeModelGlb(converted),encoded);
});

test('fir model exports exactly the generated wood and rejects geometry changes',()=>{
  const def=findGenerator('fir')!;
  const generated=generateAsset(def,{geometry:101});
  const canonical=canonicalTreeModel(generated);
  const doc=glbDocument(encodeModelGlb(canonical));
  assert.equal(doc.json.meshes.length,1);
  const accessor=doc.json.accessors[
    doc.json.meshes[0].primitives[0].attributes.POSITION];
  assert.equal(accessor.count,generated.wood.positions.length/3);
  const bad={...generated,wood:{...generated.wood,
    positions:new Float32Array(generated.wood.positions)}};
  bad.wood.positions[0]=Number.NaN;
  assert.throws(()=>canonicalTreeModel(bad),/Nonfinite canonical vertex/);
});

test('oak bark export retains the accepted wood triangles and all native profiles',()=>{
  const def=findGenerator('oak')!;
  const oak=generateAsset(def,{
    geometry:101,foliage:101,leaves:21749,
    barkStructure:19641,barkSurface:48507,barkColor:21749,
  });
  assert.ok(oak.barkWood&&oak.foliage);
  const canonical=canonicalOakWoodModel(oak);
  const mesh=canonical.meshes[0]!;
  assert.strictEqual(mesh.positions,oak.barkWood.positions);
  assert.strictEqual(mesh.normals,oak.barkWood.normals);
  assert.strictEqual(mesh.indices,oak.barkWood.indices);
  assert.strictEqual(mesh.uvs,oak.barkWood.uvs);
  assert.equal(mesh.indices.length,oak.wood.indices.length,
    'Export must not change the woody triangle count');
  assert.deepEqual([...new Set(mesh.groups?.map(g=>g.material.profile))].sort(),
    ['limb','trunk','young']);
  assert.ok(mesh.groups!.length>3);
  assert.equal(mesh.groups!.reduce((n,g)=>n+g.count,0),mesh.indices.length);
  assert.equal(def.modelBake?.variants[0]?.name,'wood');
  assert.ok(def.modelBake?.materialMaps);
  // Tiny valid PNGs test material binding and grouped GLB serialization
  // without incurring nine 1024px material renders in this unit test.
  const pixels=encodeRgbaPng(1,1,Uint8Array.from([110,116,85,255]));
  const maps={oakBark:Object.fromEntries(['trunk','limb','young'].map(profile=>[
    profile,{albedo:pixels,normal:pixels,roughness:pixels},
  ]))};
  const data=encodeModelGlb(canonical,maps);
  const glb=glbDocument(data);
  assert.equal(glb.json.meshes.length,1);
  const primitives=glb.json.meshes[0].primitives;
  assert.equal(primitives.length,3,
    'Bark should export as three draw calls, not one per wood axis');
  assert.equal(primitives.reduce((sum:number,p:{indices:number})=>
    sum+glb.json.accessors[p.indices].count,0),oak.barkWood.indices.length);
  assert.equal(glb.json.images.length,9);
  assert.ok(glb.json.materials.every((m:{
    extras?:{resourceSlot?:string};
    normalTexture?:{scale:number};
    pbrMetallicRoughness:{baseColorTexture?:object};
  })=>m.extras?.resourceSlot==='oakBark'&&
    m.normalTexture?.scale===.78&&m.pbrMetallicRoughness.baseColorTexture));
  assert.deepEqual(encodeModelGlb(canonical,maps),data);
});

test('building GLB artifacts include three level variants and optional interiors',async()=>{
  const root=await mkdtemp(join(tmpdir(),'canonical-glb-'));
  try{
    const lib=await ProjectLibrary.open(root,undefined,findGenerator);
    await lib.create('world','World');
    const recipe={name:'Market building',generator:'timber-building',
      masterSeed:19043,components:seed,
      options:{...DEFAULT_BUILDING_OPTIONS}};
    await lib.createAsset('tiles',{
      name:'Shared clay tiles',generator:'roof-clay',masterSeed:101,
      components:{pattern:101,color:203},
    });
    await lib.createAsset('market',{...recipe,
      materials:{roofClay:'asset:tiles'}});
    const result=await lib.buildAsset('market');
    assert.equal(result.built,2);
    assert.deepEqual(result.artifacts.map(a=>a.id),['tiles','market']);
    const artifact=result.artifacts.find(a=>a.id==='market')!;
    assert.equal(artifact.kind,'model');
    assert.equal(artifact.files.length,6);
    for(const file of artifact.files){
      assert.ok(/^level-[123]-(exterior|interior)\.glb$/.test(file.file));
      const glb=await readFile(join(root,'world','build','assets','market',
        artifact.key,file.file));
      const doc=glbDocument(glb);
      assert.ok(doc.json.meshes.length>3);
      assert.equal(doc.json.asset.version,'2.0');
      if(file.file.includes('exterior')&&!file.file.startsWith('level-1')){
        assert.ok(doc.json.images?.length>=3,
          'Linked roof PBR maps must be embedded inside the GLB');
        assert.ok(doc.json.materials.some((m:{
          extras?:{resourceSlot?:string};
          pbrMetallicRoughness:{baseColorTexture?:object};
          normalTexture?:object;
        })=>m.extras?.resourceSlot==='roofClay'&&
          m.pbrMetallicRoughness.baseColorTexture&&m.normalTexture));
        for(const image of doc.json.images){
          const view=doc.json.bufferViews[image.bufferView];
          assert.ok(!('target' in view),
            'Image bufferViews may not claim a GPU vertex/index target');
          assert.deepEqual([...doc.binary.subarray(view.byteOffset,
            view.byteOffset+8)],[137,80,78,71,13,10,26,10]);
        }
      }
    }
    // Produced GLB is also accepted by the project's own glTF 2.0 import
    // validator: no exporter-specific or browser-dependent wrapper.
    const roundTrip=await readFile(join(root,'world','build','assets','market',
      artifact.key,'level-3-exterior.glb'));
    const imported=await lib.importAsset('built-hall','Built Hall','glb',roundTrip);
    assert.equal(imported.kind,'model');
    assert.deepEqual((await lib.importedBytes('built-hall')).bytes,roundTrip);
    const repeat=await lib.buildAsset('market');
    assert.equal(repeat.reused,2);
    const planBefore=await lib.buildPlan(['market']);
    const tiles=await lib.asset('tiles');
    await lib.updateAsset('tiles',{
      name:'Shared clay tiles',generator:'roof-clay',masterSeed:101,
      components:{pattern:101,color:204},
    },tiles.revision);
    const planAfter=await lib.buildPlan(['market']);
    assert.notEqual(planBefore.key,planAfter.key,
      'A changed shared material invalidates the dependent model build');
    const saved=await lib.asset('market');
    await lib.updateAsset('market',{...recipe,
      materials:{roofClay:'asset:tiles'},
      options:{...DEFAULT_BUILDING_OPTIONS,interior:'none'}},saved.revision);
    const exteriorPlan=await lib.buildPlan(['market']);
    assert.notEqual(exteriorPlan.key,planAfter.key);
    const withoutInterior=generateBuildingFamily(seed,{
      ...DEFAULT_BUILDING_OPTIONS,interior:'none'},2);
    assert.equal(canonicalBuildingModel(withoutInterior,'interior'),null,
      'Absent interior must not produce an invented GLB mesh');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('oak wood build embeds all three native bark profiles and reuses the artifact',async()=>{
  const root=await mkdtemp(join(tmpdir(),'oak-wood-build-'));
  try{
    const lib=await ProjectLibrary.open(root,undefined,findGenerator);
    await lib.create('world','World');
    const recipe={name:'Oak wood',generator:'oak',masterSeed:101,
      components:{geometry:101,foliage:101,leaves:21749,
        barkStructure:19641,barkSurface:48507,barkColor:21749}};
    const saved=await lib.createAsset('oak',recipe);
    const result=await lib.buildAsset('oak');
    assert.equal(result.built,1);
    const artifact=result.artifacts[0]!;
    assert.deepEqual(artifact.files.map(f=>f.file),['wood.glb']);
    const data=await readFile(join(root,'world','build','assets','oak',
      artifact.key,'wood.glb'));
    const doc=glbDocument(data);
    assert.equal(doc.json.meshes.length,1);
    assert.equal(doc.json.meshes[0].primitives.length,3);
    assert.equal(doc.json.images.length,9);
    assert.deepEqual([...new Set(doc.json.materials.map(
      (m:{extras:{profile:string}})=>m.extras.profile))].sort(),
      ['limb','trunk','young']);
    for(const image of doc.json.images){
      const view=doc.json.bufferViews[image.bufferView];
      assert.deepEqual([...doc.binary.subarray(view.byteOffset,
        view.byteOffset+8)],[137,80,78,71,13,10,26,10]);
    }
    assert.equal((await lib.buildAsset('oak')).reused,1);
    const renamed=await lib.updateAsset('oak',{...recipe,name:'Oak renamed'},
      saved.revision);
    assert.ok(renamed.revision!==saved.revision);
    assert.equal((await lib.buildAsset('oak')).reused,1);
    await lib.updateAsset('oak',{...recipe,
      components:{...recipe.components,barkColor:21750}},renamed.revision);
    const changed=await lib.buildPlan(['oak']);
    assert.notEqual(changed.nodes[0]?.key,artifact.key);
  }finally{await rm(root,{recursive:true,force:true});}
});
