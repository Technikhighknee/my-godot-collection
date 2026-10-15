import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectLibrary} from '../src/projects/library.ts';
import {findGenerator} from '../tools/asset-procgen/web/generators.mjs';

function glbMetadata(bytes:Buffer){
  assert.equal(bytes.toString('ascii',0,4),'glTF');
  assert.equal(bytes.readUInt32LE(4),2);
  assert.equal(bytes.readUInt32LE(8),bytes.length);
  const jsonLen=bytes.readUInt32LE(12);
  assert.equal(bytes.readUInt32LE(16),0x4e4f534a);
  return JSON.parse(bytes.toString('utf8',20,20+jsonLen));
}
test('offline map production outputs complete importable terrain, road and water meshes',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'offline-map-'));
  try{
    const lib=await ProjectLibrary.open(dir,undefined,findGenerator);
    await lib.create('world','World');
    const file=join(dir,'world','maps','world.map.json');
    const map=JSON.parse(await readFile(file,'utf8'));
    map.roads=[{id:'gravel',definition:'road.gravel',width:4,
      points:[[8,12],[70,12],[90,40]]}];
    map.water=[{id:'sea',definition:'water.sea',height:1}];
    await writeFile(file,JSON.stringify(map,null,2)+'\n');

    const portable=await lib.buildScene('world');
    assert.deepEqual(portable.manifest.geometry,{
      terrain:'geometry/terrain.glb',
      roads:'geometry/roads.glb',water:'geometry/water.glb',
    });
    for(const [name,meshName] of [['terrain','Terrain-col'],['roads','Roads'],['water','Water']] as const){
      const filePath=join(portable.directory,'geometry',name+'.glb');
      const glb=glbMetadata(await readFile(filePath));
      assert.equal(glb.nodes[0].name,meshName);
      assert.ok(glb.accessors[0].count>=3);
      const index=glb.meshes[0].primitives[0].indices;
      assert.ok(glb.accessors[index].count>=3,'A baked mesh must include triangle indices');
    }
    const terrain=glbMetadata(await readFile(join(portable.directory,'geometry','terrain.glb')));
    assert.equal(terrain.accessors[0].count,65*65);
    assert.equal(terrain.images[0].mimeType,'image/png');
    assert.equal(terrain.materials[0].pbrMetallicRoughness.baseColorTexture.index,0);
    assert.equal(terrain.samplers[0].minFilter,9728);
    const second=await lib.buildScene('world');
    assert.equal(second.published,false);
    assert.equal(second.manifest.key,portable.manifest.key);

    const exported=await lib.exportGodotScene('world');
    assert.equal(exported.published,true);
    const tscn=await readFile(join(exported.directory,'world.tscn'),'utf8');
    for(const name of ['terrain','roads','water']){
      assert.ok(tscn.includes('geometry/'+name+'.glb'));
      assert.deepEqual(await readFile(join(exported.directory,'geometry',name+'.glb')),
        await readFile(join(portable.directory,'geometry',name+'.glb')));
    }
    assert.match(tscn,/name="Geometry"/);
    assert.doesNotMatch(tscn,/GameMapBuilder|GameMapLoader|TerrainHeightField/);
    assert.equal((await lib.exportGodotScene('world')).published,false);

    map.roads[0].width=6;
    await writeFile(file,JSON.stringify(map,null,2)+'\n');
    const changed=await lib.exportGodotScene('world');
    assert.equal(changed.published,true);
    assert.notEqual(changed.manifest.sourceKey,exported.manifest.sourceKey);
  }finally{await rm(dir,{recursive:true,force:true});}
});


// Surface bindings are project references, not a second map-only generator.
// Their baked PBR maps are embedded in the same portable geometry that Godot imports.
test('offline terrain uses shared project material PBR outputs and invalidates scene keys',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'material-map-'));
  try{
    const lib=await ProjectLibrary.open(dir,undefined,findGenerator);
    await lib.create('world','World');
    const recipe={name:'Clay',generator:'roof-clay',masterSeed:17,
      components:{pattern:17,color:23}};
    const saved=await lib.createAsset('clay',recipe);
    const file=join(dir,'world','maps','world.map.json');
    const map=JSON.parse(await readFile(file,'utf8'));
    const surface=map.terrain.surface_palette[0];
    map.terrain.surface_materials={
      [surface]:{asset:'asset:clay',tile_size:4},
    };
    await writeFile(file,JSON.stringify(map,null,2)+'\n');
    const first=await lib.buildScene('world');
    assert.deepEqual(first.manifest.resources.map(r=>r.id),['clay']);
    const glb=glbMetadata(await readFile(join(first.directory,'geometry','terrain.glb')));
    assert.ok(glb.extensionsUsed.includes('KHR_texture_transform'));
    const textured=glb.materials.find((m:any)=>m.extras?.assetResourceId==='clay');
    assert.ok(textured,'Terrain must use actual saved project material');
    assert.equal(textured.extras.surfaceDefinition,surface);
    assert.equal(textured.extras.tileSize,4);
    assert.ok(textured.pbrMetallicRoughness.baseColorTexture);
    assert.ok(textured.pbrMetallicRoughness.metallicRoughnessTexture);
    assert.ok(textured.normalTexture);
    assert.equal(textured.pbrMetallicRoughness.baseColorTexture.extensions
      .KHR_texture_transform.scale[0],map.terrain.size[0]/4);
    assert.equal(glb.images.length,3,'Baked albedo, normal and roughness are all embedded');
    assert.equal(glb.meshes[0].primitives.length,
      new Set((await lib.mapWorkspace()!.getDocument().surfaces.data)).size);
    const cached=await lib.buildScene('world');
    assert.equal(cached.published,false);
    const exported=await lib.exportGodotScene('world');
    assert.deepEqual(await readFile(join(exported.directory,'geometry','terrain.glb')),
      await readFile(join(first.directory,'geometry','terrain.glb')));
    const updated=await lib.updateAsset('clay',{...recipe,components:{
      pattern:17,color:24,
    }},saved.revision);
    assert.ok(updated.revision!==saved.revision);
    const changed=await lib.buildScene('world');
    assert.notEqual(changed.manifest.key,first.manifest.key,
      'Only the changed shared material invalidates this scene');
    const unrelated=await lib.createAsset('other',{...recipe,name:'Other'});
    assert.ok(unrelated.revision);
    assert.equal((await lib.buildScene('world')).published,false);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('map surface material references and profiles fail explicitly',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'invalid-material-map-'));
  try{
    const lib=await ProjectLibrary.open(dir,undefined,findGenerator);
    await lib.create('world','World');
    const file=join(dir,'world','maps','world.map.json');
    const map=JSON.parse(await readFile(file,'utf8'));
    const key=map.terrain.surface_palette[0];
    map.terrain.surface_materials={[key]:{asset:'asset:missing',tile_size:2}};
    await writeFile(file,JSON.stringify(map,null,2)+'\n');
    await assert.rejects(lib.buildScene('world'),/Missing map material dependency/);
    map.terrain.surface_materials={[key]:{asset:'asset:missing',tile_size:0}};
    await writeFile(file,JSON.stringify(map,null,2)+'\n');
    await assert.rejects(lib.buildScene('world'),/tile_size/);
    map.terrain.surface_materials={[key]:{asset:'asset:missing',tile_size:2,
      profile:'nonexistent'}};
    await writeFile(file,JSON.stringify(map,null,2)+'\n');
    await assert.rejects(lib.buildScene('world'),/Missing map material dependency/);
    await lib.createAsset('oak',{name:'Oak',generator:'timber-oak',masterSeed:10,
      components:{grain:10,color:12}});
    map.terrain.surface_materials={[key]:{asset:'asset:oak',tile_size:2}};
    await writeFile(file,JSON.stringify(map,null,2)+'\n');
    await assert.rejects(lib.buildScene('world'),/valid explicit profile/);
    map.terrain.surface_materials={[key]:{asset:'asset:oak',tile_size:2,profile:'beam'}};
    await writeFile(file,JSON.stringify(map,null,2)+'\n');
    const built=await lib.buildScene('world');
    assert.equal(built.manifest.resources[0]?.id,'oak');
  }finally{await rm(dir,{recursive:true,force:true});}
});
