import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectLibrary} from '../src/projects/library.ts';
import {findGenerator} from '../tools/asset-procgen/web/generators.mjs';
import {createProjectRouter} from '../src/projects/router.ts';
import {createDevToolServer} from '../src/server.ts';
import {encodeRgbaPng} from '../src/projects/build-image.ts';

const clay=(color:number)=>({name:'Clay roof',generator:'roof-clay',
  masterSeed:43,components:{pattern:43,color}});
const thatch=()=>({name:'Thatch',generator:'roof-thatch',
  masterSeed:72,components:{pattern:72,color:92}});
const original={id:'original',version:1};
const temporary=async(fn:(lib:ProjectLibrary,root:string)=>Promise<void>)=>{
  const root=await mkdtemp(join(tmpdir(),'full-project-build-'));
  try{
    const lib=await ProjectLibrary.open(root,undefined,findGenerator);
    await lib.create('world','World');
    await fn(lib,root);
  }finally{await rm(root,{recursive:true,force:true});}
};

test('project build is incremental, includes imports and uses project Art Direction',async()=>{
  await temporary(async(lib,root)=>{
    await lib.createAsset('roof',clay(18));
    await lib.createAsset('thatch',thatch());
    const png=encodeRgbaPng(1,1,Uint8Array.from([31,74,108,255]));
    await lib.importAsset('imported','Imported PNG','png',png);

    const plan=await lib.buildPlan();
    assert.deepEqual(plan.roots,['imported','roof','thatch']);
    assert.equal(plan.nodes.length,3);
    const first=await lib.buildProject();
    assert.equal(first.planKey,plan.key);
    assert.equal(first.built,3);
    assert.equal(first.reused,0);
    assert.deepEqual(first.artifacts.map(x=>x.id).sort(),plan.roots);
    const copied=first.artifacts.find(x=>x.id==='imported')!;
    assert.deepEqual(await readFile(join(root,'world','build','assets',
      copied.id,copied.key,'imported.png')),png);

    const second=await lib.buildProject();
    assert.equal(second.planKey,first.planKey);
    assert.equal(second.built,0);
    assert.equal(second.reused,3);

    const source=await lib.asset('roof');
    await lib.updateAsset('roof',clay(19),source.revision);
    const third=await lib.buildProject();
    assert.equal(third.built,1);
    assert.equal(third.reused,2);
    assert.notEqual(third.planKey,first.planKey);
    const thirdKey=new Map(third.artifacts.map(x=>[x.id,x.key]));
    const firstKey=new Map(first.artifacts.map(x=>[x.id,x.key]));
    assert.notEqual(thirdKey.get('roof'),firstKey.get('roof'));
    assert.equal(thirdKey.get('thatch'),firstKey.get('thatch'));
    assert.equal(thirdKey.get('imported'),firstKey.get('imported'));

    const current=await lib.artDirection();
    await lib.updateArtDirection({...current.source,
      generatorArtstyles:{'roof-clay':original}},current.revision);
    const withPolicy=await lib.buildProject();
    assert.equal(withPolicy.built,1);
    assert.equal(withPolicy.reused,2);
    assert.notEqual(withPolicy.planKey,third.planKey);
    assert.equal((await lib.asset('roof')).source.version,1);
    const single=await lib.buildAsset('roof');
    assert.equal(single.built,0);
    assert.equal(single.reused,1);
    assert.equal(single.artifacts[0]?.key,
      withPolicy.artifacts.find(x=>x.id==='roof')?.key);
  });
});

test('project build requires saved resources and does not report success for empty projects',async()=>{
  await temporary(async lib=>{
    await assert.rejects(lib.buildProject(),/No assets available to build/);
  });
});

test('project-wide build API is write-only and requires matching project origin',async()=>{
  await temporary(async lib=>{
    const png=encodeRgbaPng(1,1,Uint8Array.from([8,8,8,255]));
    await lib.importAsset('picture','Picture','png',png);
    const server=createDevToolServer(createProjectRouter(lib,{buildings:[]}));
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
      const addr=server.address();
      assert.ok(addr&&typeof addr!=='string');
      const origin='http://127.0.0.1:'+addr.port;
      const route=origin+'/api/projects/active/builds';
      const read=await fetch(route);
      assert.equal(read.status,405,'A GET request must not trigger production');
      assert.equal(read.headers.get('allow'),'POST');
      const forged=await fetch(route,{method:'POST',headers:{
        Origin:'http://evil.example','X-Project-Id':'world'}});
      assert.equal(forged.status,400);
      const stale=await fetch(route,{method:'POST',headers:{
        Origin:origin,'X-Project-Id':'wrong'}});
      assert.equal(stale.status,409);
      const allowed=()=>fetch(route,{method:'POST',headers:{
        Origin:origin,'X-Project-Id':'world'}});
      const first=await allowed();
      assert.equal(first.status,200);
      const result=await first.json();
      assert.equal(result.built,1);
      assert.equal(result.artifacts.length,1);
      const next=await (await allowed()).json();
      assert.equal(next.built,0);
      assert.equal(next.reused,1);
    }finally{
      await new Promise<void>((resolve,reject)=>
        server.close(err=>err?reject(err):resolve()));
    }
  });
});

test('Studio and package scripts expose the same all-project build operation',async()=>{
  const html=await readFile(new URL('../web/studio.html',import.meta.url),'utf8');
  const shell=await readFile(new URL('../web/studio.js',import.meta.url),'utf8');
  const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  assert.match(html,/id="buildProject"[^>]*disabled/);
  assert.match(shell,/function buildWholeProject\(/);
  assert.match(shell,/api\('\/api\/projects\/active\/builds'/);
  assert.match(shell,/buildingProject/);
  assert.match(shell,/result\.reused/);
  assert.equal(pkg.scripts['build:project'],
    'node --experimental-strip-types src/projects/build-cli.ts --all');
});
