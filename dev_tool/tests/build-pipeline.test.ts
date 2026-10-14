import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inflateSync} from 'node:zlib';
import {ProjectLibrary,type AssetEntry} from '../src/projects/library.ts';
import {planAssetBuild} from '../src/projects/build-plan.ts';
import {capturePaintedPixels,encodeRgbaPng} from '../src/projects/build-image.ts';
import {findGenerator} from '../tools/asset-procgen/web/generators.mjs';
import {createProjectRouter} from '../src/projects/router.ts';
import {createDevToolServer} from '../src/server.ts';

const material=(id:string,color:number,dependencies:string[]=[]):AssetEntry=>({
  source:{format:'devtool-asset',version:1,id,name:id,
    generator:{id:'roof-clay',version:1,masterSeed:7,
      components:{pattern:5,color}},
    dependencies},
  revision:'source-'+id,kind:'image',
});
async function project(fn:(root:string,lib:ProjectLibrary)=>Promise<void>){
  const root=await mkdtemp(join(tmpdir(),'asset-build-'));
  try{
    const lib=await ProjectLibrary.open(root,undefined,findGenerator);
    await lib.create('world','World');
    await fn(root,lib);
  }finally{await rm(root,{recursive:true,force:true});}
}
test('build plans order dependencies and invalidate only semantic changes',()=>{
  const clay=material('clay',3);
  const house=material('house',7,['asset:clay']);
  const plan=planAssetBuild([house,clay],['house']);
  assert.deepEqual(plan.nodes.map(n=>n.id),['clay','house']);
  assert.deepEqual(plan.roots,['house']);
  const renamed={...clay,source:{...clay.source,name:'Decorative rename'}};
  assert.equal(planAssetBuild([house,renamed],['house']).key,plan.key);
  const originalGenerator=clay.source.generator!;
  const masterOnly={...clay,source:{...clay.source,generator:{
    ...originalGenerator,masterSeed:999,
  }}} as AssetEntry;
  assert.equal(planAssetBuild([house,masterOnly],['house']).key,plan.key,
    'Resolved component seeds, not the master seed label, determine output');
  const recolored=material('clay',8);
  const changed=planAssetBuild([house,recolored],['house']);
  assert.notEqual(changed.key,plan.key);
  assert.notEqual(changed.nodes[1]?.key,plan.nodes[1]?.key);
  assert.equal(changed.nodes[1]?.dependencies[0],'clay');
  assert.throws(()=>planAssetBuild([material('house',7,['asset:missing'])]),
    /Missing asset dependency/);
  assert.throws(()=>planAssetBuild([material('a',1,['asset:b']),
    material('b',1,['asset:a'])]),/dependency cycle/);
});

test('canvas-free RGBA baking preserves source bytes and encodes PNG',()=>{
  const sample={
    paint(canvas:HTMLCanvasElement){
      canvas.width=2;canvas.height=1;
      const ctx=canvas.getContext('2d')!;
      const img=ctx.createImageData(2,1);
      img.data.set([250,3,8,255,14,68,191,127]);
      ctx.putImageData(img,0,0);
    },
  };
  const pixels=capturePaintedPixels(sample,'albedo');
  assert.deepEqual([...pixels.rgba],[250,3,8,255,14,68,191,127]);
  const png=encodeRgbaPng(pixels.width,pixels.height,pixels.rgba);
  assert.equal(png.toString('ascii',12,16),'IHDR');
  assert.equal(png.readUInt32BE(16),2);
  assert.equal(png.readUInt32BE(20),1);
  assert.equal(png[25],6,'PNG must use RGBA8, not indexed or grayscale');
  const dataLength=png.readUInt32BE(33);
  const decoded=inflateSync(png.subarray(41,41+dataLength));
  assert.deepEqual([...decoded],[0,...pixels.rgba]);
  assert.deepEqual(encodeRgbaPng(2,1,pixels.rgba),png);
});

test('imported files build without regeneration and verify cached artifacts',async()=>{
  await project(async(root,lib)=>{
    const png=encodeRgbaPng(1,1,Uint8Array.from([101,126,54,255]));
    await lib.importAsset('wall','Wall','png',png);
    const first=await lib.buildAsset('wall');
    assert.equal(first.built,1);
    assert.equal(first.reused,0);
    assert.equal(first.artifacts[0]?.origin,'imported');
    const a=first.artifacts[0]!;
    const file=join(root,'world','build','assets','wall',a.key,'wall.png');
    assert.deepEqual(await readFile(file),png);
    const second=await lib.buildAsset('wall');
    assert.equal(second.built,0);
    assert.equal(second.reused,1);
    assert.equal(second.planKey,first.planKey);
    const corrupt=Buffer.from(png);
    corrupt[20]^=1;
    await writeFile(file,corrupt);
    await assert.rejects(lib.buildAsset('wall'),/Built asset file changed/);
    await writeFile(file,png);
    await writeFile(join(root,'world','assets','imports','wall.png'),corrupt);
    await assert.rejects(lib.buildAsset('wall'),/corrupted/,
      'A valid cache must not mask damage to the imported source');
  });
});

test('saved material recipes bake original generator maps and reuse valid cache',async()=>{
  await project(async(root,lib)=>{
    const source={name:'Clay roof',generator:'roof-clay',
      masterSeed:11,components:{pattern:11,color:13}};
    const asset=await lib.createAsset('clay',source);
    const first=await lib.buildAsset('clay');
    assert.equal(first.built,1);
    const artifact=first.artifacts[0]!;
    assert.equal(artifact.origin,'procedural');
    assert.ok(artifact.files.some(f=>f.view==='normal'));
    assert.ok(artifact.files.some(f=>f.view==='albedo'));
    const baked=await readFile(join(root,'world','build','assets','clay',
      artifact.key,'albedo.png'));
    assert.equal(baked.toString('ascii',12,16),'IHDR');
    assert.ok(baked.length>1000);
    const cached=await lib.buildAsset('clay');
    assert.equal(cached.reused,1);
    const rename=await lib.updateAsset('clay',{...source,name:'Renamed'},
      asset.revision);
    assert.notEqual(rename.revision,asset.revision);
    assert.equal((await lib.buildAsset('clay')).reused,1,
      'Renaming a source should not rebake its pixels');
    await lib.updateAsset('clay',{...source,components:{pattern:11,color:14}},
      rename.revision);
    const rebuilt=await lib.buildAsset('clay');
    assert.equal(rebuilt.built,1);
    assert.notEqual(rebuilt.artifacts[0]?.key,artifact.key);
    await lib.createAsset('fir', {name:'Fir',generator:'fir',
      masterSeed:7,components:{geometry:7}});
    await assert.rejects(lib.buildAsset('fir'),/No headless bake capability/);
  });
});

test('build HTTP endpoints respect active project and never build on GET',async()=>{
  await project(async(_root,lib)=>{
    const server=createDevToolServer(createProjectRouter(lib,{buildings:[]}));
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
      const address=server.address();
      assert.ok(address&&typeof address!=='string');
      const url='http://127.0.0.1:'+address.port;
      const png=encodeRgbaPng(1,1,Uint8Array.from([2,3,4,255]));
      await lib.importAsset('image','Image','png',png);
      const planned=await fetch(url+'/api/projects/active/build-plan?asset=image');
      assert.equal(planned.status,200);
      assert.deepEqual((await planned.json()).roots,['image']);
      const endpoint=url+'/api/projects/active/builds/image';
      const blocked=await fetch(endpoint,{method:'POST',headers:{
        Origin:url,'X-Project-Id':'wrong',
      }});
      assert.equal(blocked.status,409);
      const allowed=await fetch(endpoint,{method:'POST',headers:{
        Origin:url,'X-Project-Id':'world',
      }});
      assert.equal(allowed.status,200);
      assert.equal((await allowed.json()).built,1);
    }finally{
      await new Promise<void>((resolve,reject)=>
        server.close(e=>e?reject(e):resolve()));
    }
  });
});
