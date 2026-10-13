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
test('building sources persist configurable three-level families without altering legacy recipes',async()=>{
  await temporary(async root=>{
    const lib=await ProjectLibrary.open(root,undefined,findGenerator);
    await lib.create('buildings','Buildings');
    const building={
      name:'Tavern',generator:'timber-building',masterSeed:19043,
      components:{structure:19043,material:62191},
      options:{width:10,depth:14,stories:1,roofPitch:43,interior:'shell'},
    };
    const original=await lib.createAsset('tavern',building);
    assert.deepEqual(original.source.options,building.options);
    const reopened=await ProjectLibrary.open(root,undefined,findGenerator);
    const restored=await reopened.asset('tavern');
    assert.deepEqual(restored.source.options,building.options);
    const revised=await reopened.updateAsset('tavern',{
      ...building,options:{...building.options,interior:'none'},
    },restored.revision);
    assert.equal((revised.source.options as {interior:string}).interior,'none');
    await assert.rejects(reopened.createAsset('invalid',{
      ...building,options:{...building.options,width:100},
    }),/width/);
    await assert.rejects(reopened.createAsset('invalid',{
      ...building,options:{...building.options,furniture:'no'},
    }),/options/);
    await assert.rejects(reopened.createAsset('invalid',{
      ...building,generator:'fir',components:{geometry:101},
    }),/options/);
    const tree=await reopened.createAsset('fir',fir());
    assert.equal(tree.source.options,undefined);
  });
});

test('project roof textures are shared validated dependencies across buildings',async()=>{
  await temporary(async root=>{
    const lib=await ProjectLibrary.open(root,undefined,findGenerator);
    await lib.create('material-links','Material Links');
    const thatch=await lib.createAsset('thatch-a',{
      name:'Village thatch',generator:'roof-thatch',masterSeed:11,
      components:{pattern:11,color:13},
    });
    const clay=await lib.createAsset('tiles-a',{
      name:'Town clay tiles',generator:'roof-clay',masterSeed:19,
      components:{pattern:19,color:23},
    });
    assert.equal(thatch.kind,'image');
    assert.equal(clay.kind,'image');
    const recipe=(name:string)=>({
      name,generator:'timber-building',masterSeed:19043,
      components:{structure:19043,material:62191},
      options:{width:9,depth:11,stories:1,roofPitch:43,interior:'shell'},
      materials:{roofThatch:'asset:thatch-a',roofClay:'asset:tiles-a'},
    });
    const one=await lib.createAsset('tavern',recipe('Tavern'));
    const two=await lib.createAsset('bakery',recipe('Bakery'));
    assert.deepEqual(one.source.materials,recipe('Tavern').materials);
    assert.deepEqual(one.source.dependencies,['asset:thatch-a','asset:tiles-a']);
    assert.deepEqual((await lib.graph()).edges.filter(x=>x.to==='asset:tiles-a')
      .map(x=>x.from).sort(),['asset:bakery','asset:tavern']);
    const modified=await lib.updateAsset('tiles-a',{
      name:'Town clay tiles',generator:'roof-clay',masterSeed:31,
      components:{pattern:31,color:37},
    },clay.revision);
    assert.notEqual(modified.revision,clay.revision);
    assert.equal((await lib.asset('tavern')).source.materials!.roofClay,'asset:tiles-a');
    assert.equal((await lib.asset('bakery')).source.materials!.roofClay,'asset:tiles-a');
    await assert.rejects(lib.createAsset('broken',{
      ...recipe('Broken'),materials:{roofClay:'asset:missing'},
    }),/Material/);
    await assert.rejects(lib.createAsset('broken',{
      ...recipe('Broken'),materials:{roofClay:'asset:thatch-a'},
    }),/Material/);
    await assert.rejects(lib.createAsset('broken',{
      ...recipe('Broken'),materials:{roofThatch:'asset:tiles-a'},
    }),/Material/);
    await assert.rejects(lib.createAsset('broken',{
      ...recipe('Broken'),materials:{chimney:'asset:tiles-a'},
    }),/Invalid material reference/);
    const unlinked=await lib.updateAsset('tavern',{
      ...recipe('Tavern'),materials:{roofClay:'asset:tiles-a'},
    },one.revision);
    assert.deepEqual(unlinked.source.dependencies,['asset:tiles-a']);
    assert.deepEqual(unlinked.source.materials,{roofClay:'asset:tiles-a'});
    assert.equal((await lib.graph()).edges.filter(x=>x.from==='asset:tavern').length,1);
    const disk=JSON.parse(await readFile(join(root,'material-links','assets',
      'tavern.asset.json'),'utf8'));
    assert.deepEqual(disk.materials,{roofClay:'asset:tiles-a'});
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
      const stale=await request('/api/projects/active/assets','POST',{id:'stale',...oak()});
      assert.equal(stale.status,409,'Stale editor cannot create an asset in another project');
      const asset=await fetch(url+'/api/projects/active/assets',{
        method:'POST',headers:{Origin:url,'Content-Type':'application/json',
          'X-Project-Id':'world'},
        body:JSON.stringify({id:'oak-a',...oak()}),
      });
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


test('timber material assets can be reused and reseeded across buildings',async()=>{
  await temporary(async root=>{
    const lib=await ProjectLibrary.open(root,undefined,findGenerator);
    await lib.create('wood-work','Wood Work');
    const wood=await lib.createAsset('oak-timber',{
      name:'Old oak framework',generator:'timber-oak',masterSeed:37821,
      components:{grain:37821,color:19257},
    });
    const recipe=(name:string)=>({
      name,generator:'timber-building',masterSeed:19043,
      components:{structure:19043,material:62191},
      options:{width:9,depth:11,stories:1,roofPitch:43,interior:'shell'},
      materials:{timberWood:'asset:oak-timber'},
    });
    const a=await lib.createAsset('tavern',recipe('Tavern'));
    await lib.createAsset('bakery',recipe('Bakery'));
    assert.deepEqual(a.source.dependencies,['asset:oak-timber']);
    assert.deepEqual((await lib.graph()).edges.filter(e=>e.to==='asset:oak-timber')
      .map(e=>e.from).sort(),['asset:bakery','asset:tavern']);
    const updated=await lib.updateAsset('oak-timber',{
      name:'Old oak framework',generator:'timber-oak',masterSeed:101,
      components:{grain:101,color:19257},
    },wood.revision);
    assert.notEqual(updated.revision,wood.revision);
    assert.equal((await lib.asset('tavern')).source.materials!.timberWood,'asset:oak-timber');
    await assert.rejects(lib.createAsset('wrong-wood',{
      ...recipe('Wrong'),materials:{timberWood:'asset:missing'},
    }),/Material/);
  });
});


test('one lime plaster material is reusable across building facade variants',async()=>{
  await temporary(async root=>{
    const lib=await ProjectLibrary.open(root,undefined,findGenerator);
    await lib.create('lime-work','Lime Work');
    const plaster=await lib.createAsset('warm-lime',{
      name:'Warm lime plaster',generator:'plaster-lime',masterSeed:47519,
      components:{structure:47519,pigment:20468,wear:90571},
    });
    const house=(name:string)=>({
      name,generator:'timber-building',masterSeed:19043,
      components:{structure:19043,material:62191},
      options:{width:9,depth:11,stories:1,roofPitch:43,interior:'shell'},
      materials:{facadePlaster:'asset:warm-lime'},
    });
    const tavern=await lib.createAsset('tavern',house('Tavern'));
    await lib.createAsset('bakery',house('Bakery'));
    assert.deepEqual(tavern.source.dependencies,['asset:warm-lime']);
    assert.deepEqual((await lib.graph()).edges.filter(e=>e.to==='asset:warm-lime')
      .map(e=>e.from).sort(),['asset:bakery','asset:tavern']);
    const updated=await lib.updateAsset('warm-lime',{
      name:'Warm lime plaster',generator:'plaster-lime',masterSeed:47520,
      components:{structure:47520,pigment:20468,wear:90571},
    },plaster.revision);
    assert.notEqual(updated.revision,plaster.revision);
    assert.equal((await lib.asset('tavern')).source.materials!.facadePlaster,
      'asset:warm-lime');
    await assert.rejects(lib.createAsset('missing-lime',{
      ...house('Wrong'),materials:{facadePlaster:'asset:missing'},
    }),/Material/);
    await assert.rejects(lib.createAsset('wrong-type',{
      ...house('Wrong'),materials:{timberWood:'asset:warm-lime'},
    }),/Material/);
  });
});


test('rubble stone is a reusable validated foundation texture dependency',async()=>{
  await temporary(async root=>{
    const lib=await ProjectLibrary.open(root,undefined,findGenerator);
    await lib.create('stone-work','Stone Work');
    const stone=await lib.createAsset('stone-masonry',{
      name:'Foundation rubble',generator:'stone-rubble',masterSeed:71803,
      components:{layout:71803,mineral:30192,weather:58212},
    });
    const house=(name:string)=>({
      name,generator:'timber-building',masterSeed:19043,
      components:{structure:19043,material:62191},
      options:{width:9,depth:11,stories:1,roofPitch:43,interior:'shell'},
      materials:{foundationStone:'asset:stone-masonry'},
    });
    const tavern=await lib.createAsset('tavern',house('Tavern'));
    await lib.createAsset('bakery',house('Bakery'));
    assert.deepEqual(tavern.source.dependencies,['asset:stone-masonry']);
    assert.deepEqual((await lib.graph()).edges.filter(e=>e.to==='asset:stone-masonry')
      .map(e=>e.from).sort(),['asset:bakery','asset:tavern']);
    const updated=await lib.updateAsset('stone-masonry',{
      name:'Foundation rubble',generator:'stone-rubble',masterSeed:71804,
      components:{layout:71804,mineral:30192,weather:58212},
    },stone.revision);
    assert.notEqual(updated.revision,stone.revision);
    assert.equal((await lib.asset('bakery')).source.materials!.foundationStone,
      'asset:stone-masonry');
    await assert.rejects(lib.createAsset('missing-stone',{
      ...house('Wrong'),materials:{foundationStone:'asset:missing'},
    }),/Material/);
    await assert.rejects(lib.createAsset('wrong-stone',{
      ...house('Wrong'),materials:{timberWood:'asset:stone-masonry'},
    }),/Material/);
  });
});
