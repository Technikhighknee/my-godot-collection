import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectLibrary} from '../src/projects/library.ts';
import {findGenerator} from '../tools/asset-procgen/web/generators.mjs';
import {encodeRgbaPng} from '../src/projects/build-image.ts';
import {publishGodotPackage} from '../src/projects/godot-package.ts';
import type {BuildArtifact,BuildResult} from '../src/projects/build.ts';
import {createProjectRouter} from '../src/projects/router.ts';
import {createDevToolServer} from '../src/server.ts';

const digest=(buffer:Buffer)=>createHash('sha256').update(buffer).digest('hex');
async function project(fn:(root:string,library:ProjectLibrary)=>Promise<void>){
  const root=await mkdtemp(join(tmpdir(),'godot-package-'));
  try{
    const lib=await ProjectLibrary.open(root,undefined,findGenerator);
    await lib.create('world','World');
    await fn(root,lib);
  }finally{await rm(root,{recursive:true,force:true});}
}
const png=(r:number)=>encodeRgbaPng(1,1,Uint8Array.from([r,55,93,255]));

test('published project assets have stable Godot paths and reuse verified builds',async()=>{
  await project(async(root,lib)=>{
    const original=png(41);
    await lib.importAsset('market-icon','Market icon','png',original);
    const first=await lib.exportGodot('market-icon');
    assert.equal(first.published,true);
    assert.equal(first.built,1);
    assert.equal(first.manifest.root,'market-icon');
    assert.equal(first.manifest.resources.length,1);
    assert.deepEqual(first.manifest.files.map(f=>f.path),
      ['assets/market-icon/market-icon.png']);
    const file=join(root,'world','exports','godot','market-icon',
      'assets','market-icon','market-icon.png');
    assert.deepEqual(await readFile(file),original);
    assert.deepEqual(JSON.parse(await readFile(join(first.directory,
      'manifest.json'),'utf8')),first.manifest);
    const second=await lib.exportGodot('market-icon');
    assert.equal(second.published,false);
    assert.equal(second.built,0);
    assert.equal(second.reused,1);
    assert.equal(second.directory,first.directory);
    assert.deepEqual(second.manifest,first.manifest);

    const other=png(98);
    await lib.importAsset('town-sign','Town sign','png',other);
    const third=await lib.exportGodot('town-sign');
    assert.equal(third.published,true);
    assert.deepEqual(await readFile(file),original,
      'Exporting another resource must not erase the first package');
    assert.deepEqual(await readFile(join(third.directory,'assets',
      'town-sign','town-sign.png')),other);
    assert.deepEqual((await readdir(join(root,'world','exports','godot')))
      .sort(),['market-icon','town-sign']);
  });
});

test('package replacement drops only stale variants of the selected root',async()=>{
  const base=await mkdtemp(join(tmpdir(),'godot-snapshot-'));
  try{
    const projectDir=join(base,'world');
    await mkdir(projectDir);
    const asset=(id:string,key:string,entries:[string,Buffer][],
      dependencies:{id:string;key:string}[]=[]):BuildArtifact=>({
      format:'devtool-baked-asset',version:1,id,key,kind:id==='house'?'model':'image',
      origin:'procedural',dependencies,
      files:entries.map(([file,bytes])=>({
        file,sha256:digest(bytes),bytes:bytes.length,
      })),
    });
    async function place(artifacts:BuildArtifact[],
      content:Record<string,Buffer>):Promise<BuildResult>{
      for(const artifact of artifacts){
        const folder=join(projectDir,'build','assets',artifact.id,artifact.key);
        await mkdir(folder,{recursive:true});
        for(const file of artifact.files)
          await writeFile(join(folder,file.file),content[artifact.id+'/'+file.file],
            {flag:'wx'});
      }
      return {planKey:artifacts.at(-1)!.key,artifacts,built:1,reused:0};
    }
    const roof=png(100),houseA=Buffer.from('glb-A'),houseB=Buffer.from('glb-B');
    const first=await place([
      asset('tiles','texture-rev',[['albedo.png',roof]]),
      asset('house','house-rev',[
        ['level-1-exterior.glb',houseA],
        ['level-1-interior.glb',houseB],
      ],[{id:'tiles',key:'texture-rev'}]),
    ],{'tiles/albedo.png':roof,
      'house/level-1-exterior.glb':houseA,
      'house/level-1-interior.glb':houseB});
    const sent=await publishGodotPackage(projectDir,'house',first);
    assert.equal(sent.published,true);
    assert.deepEqual(sent.manifest.files.map(f=>f.path),[
      'assets/tiles/albedo.png',
      'assets/house/level-1-exterior.glb',
      'assets/house/level-1-interior.glb',
    ]);
    assert.deepEqual(await readFile(join(sent.directory,'assets','house',
      'level-1-exterior.glb')),houseA);
    assert.equal((await publishGodotPackage(projectDir,'house',first)).published,
      false);

    const newBytes=Buffer.from('glb-changed');
    const second=await place([
      asset('tiles','texture-rev-2',[['albedo.png',roof]]),
      asset('house','house-rev-2',[
        ['level-1-exterior.glb',newBytes],
      ],[{id:'tiles',key:'texture-rev-2'}]),
    ],{'tiles/albedo.png':roof,
      'house/level-1-exterior.glb':newBytes});
    const updated=await publishGodotPackage(projectDir,'house',second);
    assert.equal(updated.published,true);
    assert.equal(updated.directory,sent.directory);
    assert.deepEqual(await readdir(join(updated.directory,'assets','house')),
      ['level-1-exterior.glb']);
    assert.deepEqual(await readFile(join(updated.directory,'assets','house',
      'level-1-exterior.glb')),newBytes);
    assert.equal(updated.manifest.files.length,2);
    assert.deepEqual(updated.manifest.resources[1]?.dependencies,
      [{id:'tiles',key:'texture-rev-2'}]);
    const files=await readdir(join(projectDir,'exports','godot'));
    assert.deepEqual(files,['house'],'No orphaned staging/backup directories');
  }finally{await rm(base,{recursive:true,force:true});}
});

test('edited or unmanaged Godot exports are never silently overwritten',async()=>{
  await project(async(_root,lib)=>{
    const image=png(38);
    await lib.importAsset('icon','Icon','png',image);
    const first=await lib.exportGodot('icon');
    const file=join(first.directory,'assets','icon','icon.png');
    const original=await readFile(file);
    await writeFile(file,Buffer.from('manual replacement'));
    await assert.rejects(lib.exportGodot('icon'),/Published Godot file was modified/);
    assert.deepEqual(await readFile(file),Buffer.from('manual replacement'));
    await writeFile(file,original);
    const extra=join(first.directory,'assets','icon','notes.txt');
    await writeFile(extra,'manual changes');
    await assert.rejects(lib.exportGodot('icon'),/Unmanaged files/);
    assert.equal(await readFile(extra,'utf8'),'manual changes');
  });
});

test('Godot export API requires active project and same-origin POST',async()=>{
  await project(async(_root,lib)=>{
    const server=createDevToolServer(createProjectRouter(lib,{buildings:[]}));
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
      const address=server.address();
      assert.ok(address&&typeof address!=='string');
      const url='http://127.0.0.1:'+address.port;
      await lib.importAsset('icon','Icon','png',png(25));
      const endpoint=url+'/api/projects/active/exports/godot/icon';
      const get=await fetch(endpoint);
      assert.equal(get.status,405);
      const blocked=await fetch(endpoint,{method:'POST',headers:{
        Origin:url,'X-Project-Id':'different-project',
      }});
      assert.equal(blocked.status,409);
      const allowed=await fetch(endpoint,{method:'POST',headers:{
        Origin:url,'X-Project-Id':'world',
      }});
      assert.equal(allowed.status,200);
      const result=await allowed.json();
      assert.equal(result.published,true);
      assert.equal(result.manifest.root,'icon');
      const wrongOrigin=await fetch(endpoint,{method:'POST',headers:{
        Origin:'http://example.com','X-Project-Id':'world',
      }});
      assert.equal(wrongOrigin.status,400);
    }finally{
      await new Promise<void>((resolve,reject)=>
        server.close(e=>e?reject(e):resolve()));
    }
  });
});
