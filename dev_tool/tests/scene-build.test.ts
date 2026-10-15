import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectLibrary} from '../src/projects/library.ts';
import {findGenerator} from '../tools/asset-procgen/web/generators.mjs';
import {encodeRgbaPng} from '../src/projects/build-image.ts';
import {createProjectRouter} from '../src/projects/router.ts';
import {createDevToolServer} from '../src/server.ts';

function glb():Buffer{
  const json=Buffer.from('{"asset":{"version":"2.0"}}');
  const aligned=Math.ceil(json.length/4)*4;
  const result=Buffer.alloc(20+aligned,32);
  result.write('glTF',0,'ascii');result.writeUInt32LE(2,4);
  result.writeUInt32LE(result.length,8);result.writeUInt32LE(aligned,12);
  result.writeUInt32LE(0x4e4f534a,16);json.copy(result,20);
  return result;
}
async function project(fn:(lib:ProjectLibrary,root:string)=>Promise<void>){
  const root=await mkdtemp(join(tmpdir(),'map-scene-'));
  try{
    const lib=await ProjectLibrary.open(root,undefined,findGenerator);
    await lib.create('world','World');
    await fn(lib,root);
  }finally{await rm(root,{recursive:true,force:true});}
}
async function changeMap(root:string,edit:(map:any)=>void){
  const path=join(root,'world','maps','world.map.json');
  const map=JSON.parse(await readFile(path,'utf8'));
  edit(map);await writeFile(path,JSON.stringify(map,null,2)+'\n');
}

test('map scene exports one model resource for repeated placements and retains semantic definitions',async()=>{
  await project(async(lib,root)=>{
    const input=glb();
    await lib.importAsset('tree','Imported tree','glb',input);
    await changeMap(root,map=>{
      map.objects=[
        {id:'oak_b',definition:'asset:tree',position:[12,24],rotation:90},
        {id:'oak_a',definition:'asset:tree',position:[20,30],rotation:-45},
        {id:'well',definition:'object.well',position:[40,60],rotation:0},
      ];
      map.buildings=[
        {id:'house',definition:'building.house',position:[50,50],rotation:30},
      ];
    });
    const first=await lib.buildScene('world');
    assert.equal(first.published,true);
    assert.equal(first.built,1);
    assert.equal(first.reused,0);
    assert.deepEqual(first.manifest.resources.map(x=>x.id),['tree']);
    assert.deepEqual(first.manifest.placements.map(x=>x.id),
      ['house','oak_a','oak_b','well']);
    const a=first.manifest.placements.find(x=>x.id==='oak_a')!;
    assert.equal(a.assetId,'tree');
    assert.equal(a.kind,'object');
    assert.equal(a.source,'project-asset');
    assert.equal(a.rotationDegrees,-45);
    assert.deepEqual(a.position,[20,0,30],
      'Terrain height is resolved with the existing Map System sampler');
    assert.equal(a.modelFile,'assets/tree/tree.glb');
    const well=first.manifest.placements.find(x=>x.id==='well')!;
    assert.equal(well.source,'game-definition');
    assert.equal(well.modelFile,undefined);
    assert.deepEqual(await readFile(join(first.directory,'assets','tree','tree.glb')),input);
    const savedMap=JSON.parse(await readFile(join(first.directory,'maps','world.map.json'),'utf8'));
    assert.equal(savedMap.objects[0].definition,'asset:tree');
    assert.ok(first.manifest.files.some(x=>x.path==='maps/assets/world.height.exr'));
    assert.ok(first.manifest.files.some(x=>x.path==='maps/assets/world.surface.png'));

    const second=await lib.buildScene('world');
    assert.equal(second.published,false);
    assert.equal(second.manifest.key,first.manifest.key);
    assert.equal(second.built,0);
    assert.equal(second.reused,1);
    // An unrelated texture is not in the scene DAG.
    await lib.importAsset('icon','Icon','png',
      encodeRgbaPng(1,1,Uint8Array.from([2,17,44,255])));
    const third=await lib.buildScene('world');
    assert.equal(third.published,false);
    assert.equal(third.manifest.key,first.manifest.key);
    assert.deepEqual(third.manifest.resources.map(x=>x.id),['tree']);
    await changeMap(root,map=>{map.objects[0].position=[14,24];});
    const edited=await lib.buildScene('world');
    assert.equal(edited.published,true);
    assert.notEqual(edited.manifest.key,first.manifest.key);
    assert.equal(edited.built,0);
    assert.equal(edited.reused,1);
  });
});

test('missing, incompatible scene resources and modified cached files fail closed',async()=>{
  await project(async(lib,root)=>{
    const path=join(root,'world','maps','world.map.json');
    await changeMap(root,map=>{
      map.objects=[{id:'bad',definition:'asset:missing',position:[12,14],rotation:0}];
    });
    await assert.rejects(lib.buildScene('world'),/Missing scene asset dependency/);
    await changeMap(root,map=>{
      map.objects=[{id:'bad',definition:'asset:Bad ID',position:[12,14],rotation:0}];
    });
    await assert.rejects(lib.buildScene('world'),/Invalid scene asset reference/);
    const texture=encodeRgbaPng(1,1,Uint8Array.from([2,17,44,255]));
    await lib.importAsset('icon','Icon','png',texture);
    await changeMap(root,map=>{
      map.objects=[{id:'bad',definition:'asset:icon',position:[12,14],rotation:0}];
    });
    await assert.rejects(lib.buildScene('world'),/requires a model asset/);
    await changeMap(root,map=>{map.objects=[];});
    const clean=await lib.buildScene('world');
    assert.equal(clean.published,true);
    assert.equal(clean.built,0);
    assert.equal(clean.manifest.resources.length,0);
    await writeFile(join(clean.directory,'maps','world.map.json'),'corrupted');
    await assert.rejects(lib.buildScene('world'),/Scene bundle content was modified/);
    // A corrupt cache does not get silently overwritten.
    assert.equal(await readFile(join(clean.directory,'maps','world.map.json'),'utf8'),
      'corrupted');
    assert.ok((await readdir(join(root,'world','build','scenes','world')))
      .every(x=>!x.startsWith('.pending-')));
    assert.ok((await readFile(path,'utf8')).includes('"objects": []'));
  });
});

test('map-scene HTTP builds require same-origin project-bound POST',async()=>{
  await project(async(lib,_root)=>{
    const server=createDevToolServer(createProjectRouter(lib,{buildings:[]}));
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
      const addr=server.address();
      assert.ok(addr&&typeof addr!=='string');
      const url='http://127.0.0.1:'+addr.port;
      const endpoint=url+'/api/projects/active/scenes/world/build';
      const get=await fetch(endpoint);
      assert.equal(get.status,405);
      assert.equal(get.headers.get('allow'),'POST');
      const bad=await fetch(endpoint,{method:'POST',headers:{
        Origin:url,'X-Project-Id':'other'}});
      assert.equal(bad.status,409);
      const foreign=await fetch(endpoint,{method:'POST',headers:{
        Origin:'http://evil.test','X-Project-Id':'world'}});
      assert.equal(foreign.status,400);
      const good=await fetch(endpoint,{method:'POST',headers:{
        Origin:url,'X-Project-Id':'world'}});
      assert.equal(good.status,200);
      const result=await good.json();
      assert.equal(result.published,true);
      assert.equal(result.manifest.mapId,'world');
      const second=await fetch(endpoint,{method:'POST',headers:{
        Origin:url,'X-Project-Id':'world'}});
      assert.equal((await second.json()).published,false);
    }finally{
      await new Promise<void>((resolve,reject)=>
        server.close(e=>e?reject(e):resolve()));
    }
  });
});

test('Studio and CLI expose scene production without duplicating the map renderer',async()=>{
  const studio=await readFile(new URL('../web/studio.js',import.meta.url),'utf8');
  const packageData=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  assert.match(studio,/buildSceneFromStudio/);
  assert.match(studio,/api\/projects\/active\/scenes\//);
  assert.equal(packageData.scripts['build:scene'],
    'node --experimental-strip-types src/projects/scene-cli.ts');
});
