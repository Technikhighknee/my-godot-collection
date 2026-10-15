import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,symlink,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectLibrary} from '../src/projects/library.ts';
import {findGenerator} from '../tools/asset-procgen/web/generators.mjs';
import {serializeGodotScene} from '../src/projects/godot-scene-format.ts';
import type {SceneBundleManifest} from '../src/projects/scene-bundle.ts';
import {encodeRgbaPng} from '../src/projects/build-image.ts';
import {createProjectRouter} from '../src/projects/router.ts';
import {createDevToolServer} from '../src/server.ts';

function glb():Buffer{
  const json=Buffer.from('{"asset":{"version":"2.0"}}');
  const aligned=Math.ceil(json.length/4)*4;
  const data=Buffer.alloc(20+aligned,32);
  data.write('glTF',0,'ascii');data.writeUInt32LE(2,4);
  data.writeUInt32LE(data.length,8);data.writeUInt32LE(aligned,12);
  data.writeUInt32LE(0x4e4f534a,16);json.copy(data,20);
  return data;
}
async function temporary(run:(lib:ProjectLibrary,root:string)=>Promise<void>){
  const root=await mkdtemp(join(tmpdir(),'godot-scene-'));
  try{
    const lib=await ProjectLibrary.open(root,undefined,findGenerator);
    await lib.create('world','World');
    await run(lib,root);
  }finally{await rm(root,{recursive:true,force:true});}
}
async function editMap(root:string,edit:(map:any)=>void){
  const file=join(root,'world','maps','world.map.json');
  const map=JSON.parse(await readFile(file,'utf8'));
  edit(map);
  await writeFile(file,JSON.stringify(map,null,2)+'\n');
}
test('Godot scene instantiates reused GLBs with stable relative paths and map transforms',async()=>{
  await temporary(async(lib,root)=>{
    const model=glb();
    await lib.importAsset('oak','Imported oak','glb',model);
    await editMap(root,map=>{
      map.objects=[
        {id:'oak_b',definition:'asset:oak',position:[12,24],rotation:90},
        {id:'oak_a',definition:'asset:oak',position:[20,30],rotation:-45},
        {id:'market_well',definition:'object.well',position:[40,60],rotation:0},
      ];
    });
    const first=await lib.exportGodotScene('world');
    assert.equal(first.published,true);
    assert.equal(first.built,1);
    assert.equal(first.manifest.mapId,'world');
    assert.equal(first.sceneFile,'world.tscn');
    assert.ok(first.directory.endsWith(join('exports','godot-scenes','world')));
    const tscn=await readFile(join(first.directory,'world.tscn'),'utf8');
    assert.doesNotMatch(tscn,/^#/m,'Godot text scenes do not accept hash comments');
    assert.match(tscn,/\[gd_scene load_steps=3 format=3\]/);
    assert.equal(tscn.match(/\[ext_resource type="PackedScene"/g)?.length,2);
    assert.equal(tscn.match(/instance=ExtResource\("model_1"\)/g)?.length,2);
    assert.match(tscn,/path="assets\/oak\/oak.glb"/);
    assert.match(tscn,/position = Vector3\(20, 0, 30\)/);
    assert.match(tscn,/rotation = Vector3\(0, -0\.7853981633974483, 0\)/);
    assert.match(tscn,/metadata\/placement_id = "oak_a"/);
    assert.match(tscn,/metadata\/definition_id = "object.well"/);
    assert.match(tscn,/type="Marker3D"/);
    assert.match(tscn,/metadata\/unresolved_game_definition = true/);
    assert.match(tscn,/metadata\/map_source = "maps\/world.map.json"/);
    assert.deepEqual(await readFile(join(first.directory,'assets','oak','oak.glb')),model);
    assert.ok(first.manifest.files.some(file=>file.path==='maps/assets/world.height.exr'));
    assert.ok(first.manifest.files.some(file=>file.path==='maps/assets/world.surface.png'));
    const second=await lib.exportGodotScene('world');
    assert.equal(second.published,false);
    assert.equal(second.built,0);
    assert.equal(second.reused,1);
    assert.deepEqual(second.manifest,first.manifest);
    // Unused project assets never alter the exported map scene.
    await lib.importAsset('unused','Unused PNG','png',
      encodeRgbaPng(1,1,Uint8Array.from([12,22,32,255])));
    assert.equal((await lib.exportGodotScene('world')).published,false);
    await editMap(root,map=>{map.objects[0].rotation=110;});
    const revised=await lib.exportGodotScene('world');
    assert.equal(revised.published,true);
    assert.equal(revised.built,0);
    assert.equal(revised.reused,1);
    assert.notEqual(revised.manifest.sourceKey,first.manifest.sourceKey);
    assert.match(await readFile(join(revised.directory,'world.tscn'),'utf8'),
      /metadata\/placement_id = "oak_b"/);
    assert.deepEqual((await readdir(join(root,'world','exports','godot-scenes'))),
      ['world'],'Updating one map does not accumulate export directories');
  });
});

test('existing managed Godot scene exports reject edits, extras and symlinks',async()=>{
  await temporary(async(lib,root)=>{
    await lib.importAsset('tree','Tree','glb',glb());
    await editMap(root,map=>{map.objects=[
      {id:'tree',definition:'asset:tree',position:[12,10],rotation:0},
    ];});
    const first=await lib.exportGodotScene('world');
    const scene=join(first.directory,'world.tscn');
    const original=await readFile(scene);
    await writeFile(scene,'manually edited');
    await assert.rejects(lib.exportGodotScene('world'),
      /Godot scene export was modified/);
    assert.equal(await readFile(scene,'utf8'),'manually edited');
    await writeFile(scene,original);
    const extra=join(first.directory,'notes.txt');
    await writeFile(extra,'private notes');
    await assert.rejects(lib.exportGodotScene('world'),/Unmanaged files/);
    await rm(extra);
    const imported=join(first.directory,'assets','tree','tree.glb');
    await rm(imported);
    await symlink(join(root,'world','assets','imports','tree.glb'),imported);
    await assert.rejects(lib.exportGodotScene('world'),
      /redirected|symlink/i);
    await rm(imported);
    assert.equal((await readdir(join(root,'world','exports','godot-scenes')))
      .filter(name=>name.startsWith('.pending-')).length,0);
  });
});

test('serializer escapes arbitrary semantic names and rejects unverified model paths',()=>{
  const base:SceneBundleManifest={
    format:'devtool-scene-bundle',version:1,mapId:'world',key:'a'.repeat(64),
    assetPlanKey:null,mapFile:'maps/world.map.json',
    terrain:{heightmap:'maps/assets/world.height.exr',
      surfaceMap:'maps/assets/world.surface.png'},
    geometry:{terrain:'geometry/terrain.glb'},
    resources:[],files:[{path:'geometry/terrain.glb',bytes:100,sha256:'b'.repeat(64)}],placements:[{
      id:'strange"\nnode',kind:'object',definition:'object."sample"',
      source:'game-definition',position:[1,2,3],rotationDegrees:360,
    }],
  };
  const output=serializeGodotScene(base).toString('utf8');
  assert.match(output,/metadata\/placement_id = "strange\\\"\\nnode"/);
  assert.match(output,/metadata\/definition_id = "object\.\\\"sample\\\""/);
  assert.match(output,/\[ext_resource type="PackedScene" path="geometry\/terrain\.glb"/);
  assert.doesNotMatch(output,/id="model_/);
  assert.match(output,/type="Marker3D"/);
  assert.throws(()=>serializeGodotScene({...base,placements:[{
    ...base.placements[0]!,source:'project-asset',assetId:'missing',
    modelFile:'assets/missing/missing.glb',
  }]}),/Unresolved Godot scene model/);
  assert.throws(()=>serializeGodotScene({...base,placements:[{
    ...base.placements[0]!,position:[Number.NaN,2,3],
  }]}),/Invalid Godot scene placement/);
});

test('Godot scene export API rejects GET, forged origin and wrong project',async()=>{
  await temporary(async(lib,_root)=>{
    const server=createDevToolServer(createProjectRouter(lib,{buildings:[]}));
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
      const address=server.address();
      assert.ok(address&&typeof address!=='string');
      const host='http://127.0.0.1:'+address.port;
      const endpoint=host+'/api/projects/active/exports/godot-scene/world';
      const get=await fetch(endpoint);
      assert.equal(get.status,405);
      assert.equal(get.headers.get('allow'),'POST');
      const spoof=await fetch(endpoint,{method:'POST',headers:{
        Origin:'http://example.org','X-Project-Id':'world'}});
      assert.equal(spoof.status,400);
      const stale=await fetch(endpoint,{method:'POST',headers:{
        Origin:host,'X-Project-Id':'wrong'}});
      assert.equal(stale.status,409);
      const exportResponse=await fetch(endpoint,{method:'POST',headers:{
        Origin:host,'X-Project-Id':'world'}});
      assert.equal(exportResponse.status,200);
      assert.equal((await exportResponse.json()).sceneFile,'world.tscn');
      const next=await fetch(endpoint,{method:'POST',headers:{
        Origin:host,'X-Project-Id':'world'}});
      assert.equal((await next.json()).published,false);
    }finally{
      await new Promise<void>((resolve,reject)=>
        server.close(error=>error?reject(error):resolve()));
    }
  });
});

test('Godot scene feature is discoverable through Studio and headless CLI',async()=>{
  const studio=await readFile(new URL('../web/studio.js',import.meta.url),'utf8');
  const scripts=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  assert.match(studio,/Export Godot/);
  assert.match(studio,/exports\/godot-scene/);
  assert.equal(scripts.scripts['export:godot-scene'],
    'node --experimental-strip-types src/projects/godot-scene-cli.ts');
});
