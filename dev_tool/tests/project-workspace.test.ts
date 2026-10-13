import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectLibrary,validateSource} from '../src/projects/library.ts';
import {findGenerator} from '../tools/asset-procgen/web/generators.mjs';
import {createProjectRouter} from '../src/projects/router.ts';
import {createDevToolServer} from '../src/server.ts';

async function temporary(run:(path:string)=>Promise<void>){
  const root=await mkdtemp(join(tmpdir(),'dev-tool-projects-'));
  try{await run(root);}finally{await rm(root,{recursive:true,force:true});}
}
const fir=(name='Sample fir')=>({name,generator:'fir',
  masterSeed:101,components:{geometry:101}});
const oak=(name='An oak')=>({name,generator:'oak',masterSeed:101,
  components:{geometry:101,foliage:101,leaves:21749,
    barkStructure:19641,barkSurface:48507,barkColor:21749}});

test('projects own persistent maps, recipes, and stable cross-tool references',async()=>{
  await temporary(async root=>{
    const lib=await ProjectLibrary.open(root,undefined,findGenerator);
    assert.deepEqual(await lib.list(),[]);
    const project=await lib.create('guild-world','Guild World');
    assert.equal(project.format,'devtool-project');
    assert.equal(lib.active()?.id,'guild-world');
    const files=await readdir(join(root,'guild-world','maps'));
    assert.ok(files.includes('world.map.json'));
    assert.deepEqual((await lib.mapWorkspace()!.list()).map(x=>x.file),['world.map.json']);
    const map=lib.mapWorkspace()!;
    const asset=await lib.createAsset('fir-one',fir());
    assert.equal(asset.source.id,'fir-one');
    assert.equal(asset.kind,'model');
    assert.equal(asset.source.generator.version,1);
    assert.ok(asset.revision.length===64);
    await map.saveDocument({
      roads:[],objects:[{id:'tree1',definition:'asset:fir-one',
        position:[16,24],rotation:0}],
    },map.getRevision(),map.getFile());
    assert.deepEqual(await lib.graph(),{
      edges:[{from:'map:world',to:'asset:fir-one'}],missing:[],
    });
    await lib.create('new-game','New Game');
    assert.deepEqual(await lib.assets(),[]);
    await lib.select('guild-world');
    assert.equal((await lib.asset('fir-one')).source.name,'Sample fir');
    assert.equal((await lib.graph()).edges.length,1);
    const reopened=await ProjectLibrary.open(root,undefined,findGenerator);
    assert.equal(reopened.active()?.id,'guild-world');
    assert.equal((await reopened.mapWorkspace()!.list()).length,1);
    assert.equal((await reopened.assets()).length,1);
    const disk=JSON.parse(await readFile(join(root,'guild-world','assets','fir-one.asset.json'),'utf8'));
    assert.equal(disk.format,'devtool-asset');
  });
});
test('recipes validate known generators, seeds and revision conflicts',async()=>{
  await temporary(async root=>{
    const lib=await ProjectLibrary.open(root,undefined,findGenerator);
    await lib.create('test-world','Test');
    for(const bad of [
      {...fir(),components:{}},
      {...fir(),components:{geometry:-1}},
      {...fir(),components:{geometry:101,unexpected:100}},
      {...fir(),generator:'unknown'},
    ])await assert.rejects(lib.createAsset('bad',bad));
    await assert.rejects(lib.createAsset('../escape',fir()));
    const first=await lib.createAsset('fir-one',fir());
    await assert.rejects(lib.createAsset('fir-one',fir()));
    await assert.rejects(lib.updateAsset('fir-one',fir('Revised'),'outdated'));
    const second=await lib.updateAsset('fir-one',fir('Revised'),first.revision);
    assert.equal(second.source.name,'Revised');
    assert.notEqual(second.revision,first.revision);
    await assert.rejects(lib.updateAsset('fir-one',oak(),second.revision),
      /Cannot change generator/);
    await assert.rejects(lib.updateAsset('fir-one',fir('Other'),first.revision),
      /modified/);
    assert.equal((await lib.asset('fir-one')).source.generator.id,'fir');
    const material=await lib.createAsset('leaf',fir('Leaf'));
    const reference=await lib.createAsset('linked',fir('Linked'));
    const path=join(root,'test-world','assets','linked.asset.json');
    await writeFile(path,JSON.stringify({...reference.source,dependencies:['asset:leaf']})+'\n');
    const preserved=await lib.asset('linked');
    const edited=await lib.updateAsset('linked',fir('Renamed'),preserved.revision);
    assert.deepEqual(edited.source.dependencies,['asset:leaf']);
    const leafPath=join(root,'test-world','assets','leaf.asset.json');
    await writeFile(leafPath,JSON.stringify({...material.source,
      dependencies:['asset:linked']})+'\n');
    await assert.rejects(lib.updateAsset('linked',fir('Cycle'),edited.revision),
      /dependency cycle/i);
    assert.throws(()=>validateSource({...first.source,dependencies:['asset:fir-one']},undefined,findGenerator),
      /Invalid asset dependencies/);
  });
});
test('project API is isolated and rejects cross-origin modifications',async()=>{
  await temporary(async root=>{
    const lib=await ProjectLibrary.open(root,undefined,findGenerator);
    const definitions={buildings:[]};
    const server=createDevToolServer(createProjectRouter(lib,definitions));
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
      const address=server.address();
      assert.ok(address&&typeof address!=='string');
      const url='http://127.0.0.1:'+address.port;
      async function request(path:string,method='GET',payload?:unknown,origin=url){
        return fetch(url+path,{method,headers:payload?{
          'Content-Type':'application/json',Origin:origin,
        }:undefined,body:payload?JSON.stringify(payload):undefined});
      }
      const bad=await request('/api/projects','POST',{id:'bad',name:'Bad'},'http://evil.example');
      assert.equal(bad.status,400);
      const project=await request('/api/projects','POST',{id:'world',name:'World'});
      assert.equal(project.status,201);
      const asset=await request('/api/projects/active/assets','POST',{id:'oak-a',...oak()});
      assert.equal(asset.status,201);
      const entry=await asset.json();
      assert.equal(entry.source.generator.id,'oak');
      const saved=await request('/api/projects/active/assets/oak-a');
      assert.equal((await saved.json()).kind,'model');
      assert.equal((await request('/api/projects/active/graph')).status,200);
      assert.equal((await request('/api/projects')).status,200);
      const map=await request('/api/map');
      assert.equal(map.status,200);
      assert.equal((await map.json()).map.name,'World');
      const blocked=await request('/api/document','PUT',{
        revision:'invalid',mapFile:'world.map.json',roads:[],
      });
      assert.equal(blocked.status,409,'Map writes require active project identity');
      const permitted=await fetch(url+'/api/document',{
        method:'PUT',headers:{Origin:url,'Content-Type':'application/json',
          'X-Project-Id':'world'},
        body:JSON.stringify({revision:'invalid',mapFile:'world.map.json',roads:[]}),
      });
      assert.equal(permitted.status,409,'A matching project still enforces revision protection');
    }finally{
      await new Promise<void>((resolve,reject)=>
        server.close(e=>e?reject(e):resolve()));
    }
  });
});
