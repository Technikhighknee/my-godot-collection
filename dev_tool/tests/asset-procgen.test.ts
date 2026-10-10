import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_STEM, generateStem, validateStem, type StemMesh } from '../tools/asset-procgen/web/trunk.mjs';
import { loadMap } from '../tools/map-editor/src/io/map-io.ts';
import { createEditorServer } from '../tools/map-editor/src/server.ts';

function verifyTopology({positions,indices}:StemMesh) {
  const remap:number[] = [],vertices=new Map<string,number>();
  for(let i=0;i<positions.length/3;i++){
    const key=Array.from(positions.subarray(i*3,i*3+3),v=>v.toFixed(5)).join(',');
    if(!vertices.has(key))vertices.set(key,vertices.size);
    remap[i]=vertices.get(key)!;
  }
  const edges=new Map<string,[number,number]>();
  for(let i=0;i<indices.length;i+=3){
    const [a,b,c]=[remap[indices[i]],remap[indices[i+1]],remap[indices[i+2]]];
    for(const [x,y] of [[a,b],[b,c],[c,a]]){
      const key=Math.min(x,y)+':'+Math.max(x,y);
      const pair=edges.get(key)??[0,0];
      pair[0]++;pair[1]+=x<y?1:-1;edges.set(key,pair);
    }
  }
  for(const [count,direction] of edges.values()){
    assert.equal(count,2,'A welded edge should be shared by exactly two faces');
    assert.equal(direction,0,'Adjacent faces should orient shared edges oppositely');
  }
}

test('trunk settings are bounded and no other generators leak into this phase',()=>{
  assert.deepEqual(validateStem(DEFAULT_STEM),DEFAULT_STEM);
  assert.throws(()=>validateStem({...DEFAULT_STEM,seed:-1}));
  assert.throws(()=>validateStem({...DEFAULT_STEM,height:Infinity}));
  assert.throws(()=>validateStem({...DEFAULT_STEM,radius:2}));
  assert.deepEqual(Object.keys(generateStem()).sort(),
    ['positions','normals','indices','rings','sides','settings'].sort());
});

test('seeded trunk is finite, repeatable, watertight and has outward normals',()=>{
  const mesh=generateStem();
  assert.deepEqual(mesh.positions,generateStem().positions);
  assert.deepEqual(mesh.indices,generateStem().indices);
  assert.ok(mesh.positions.every(Number.isFinite));
  assert.ok(mesh.normals.every(Number.isFinite));
  assert.ok(mesh.indices.every(i=>i<mesh.positions.length/3));
  verifyTopology(mesh);
  const {positions:p,normals:n,indices:i}=mesh;
  for(let t=0;t<i.length;t+=3){
    const a=i[t]*3,b=i[t+1]*3,c=i[t+2]*3;
    const u=[p[b]-p[a],p[b+1]-p[a+1],p[b+2]-p[a+2]];
    const v=[p[c]-p[a],p[c+1]-p[a+1],p[c+2]-p[a+2]];
    const cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    assert.ok(Math.hypot(...cross)>1e-9);
    const outward=cross.reduce((sum,norm,k)=>sum+norm*(n[a+k]+n[b+k]+n[c+k]),0);
    assert.ok(outward>=-1e-7);
  }
});

test('trunk has an uninterrupted radial seam and no manufactured needle tip',()=>{
  const m=generateStem(),p=m.positions,stride=m.sides+1;
  for(let row=0;row<m.rings;row++)for(let axis=0;axis<3;axis++)
    assert.equal(p[(row*stride)*3+axis],p[(row*stride+m.sides)*3+axis]);
  const base=m.rings*stride*3,top=(m.rings*stride+1)*3;
  const r=(row:number,center:number)=>{
    const k=row*stride*3;
    return Math.hypot(p[k]-p[center],p[k+1]-p[center+1],p[k+2]-p[center+2]);
  };
  assert.ok(r(m.rings-1,top)>.25*r(0,base),'Upper stem must stay open for future growth');
  assert.ok(r(0,base)>m.settings.radius,'Root flare should not be a straight cylinder');
});

test('extreme settings remain closed and finite',()=>{
  for(const input of [
    {...DEFAULT_STEM,seed:0,height:5,radius:.28,character:0,buttress:0},
    {...DEFAULT_STEM,seed:4294967295,height:16,radius:1,character:1.5,buttress:1.5}
  ]){
    const m=generateStem(input);
    assert.ok(m.positions.every(Number.isFinite));
    verifyTopology(m);
  }
});

test('Asset ProcGen serves a real viewport without export or texture controls',async()=>{
  const html=readFileSync(new URL('../tools/asset-procgen/web/index.html',import.meta.url),'utf8');
  assert.match(html,/The trunk/);
  assert.match(html,/id="viewport"/);
  assert.doesNotMatch(html,/Export GLB|Save recipe|Load recipe/);
  const doc=await loadMap('../map_system/coastal_relief.map.json');
  const server=createEditorServer(doc);
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const address=server.address();
    assert.ok(address&&typeof address!=='string');
    const base='http://127.0.0.1:'+address.port;
    for(const path of ['/tools/asset-procgen/','/tools/asset-procgen',
      '/tools/asset-procgen/app.js','/tools/asset-procgen/style.css','/tools/asset-procgen/trunk.mjs']){
      const response=await fetch(base+path);
      assert.equal(response.status,200,path);
      assert.ok((await response.text()).length>100);
    }
    assert.equal((await fetch(base+'/tools/map-editor/')).status,200);
    assert.equal((await fetch(base+'/api/map')).status,200);
  }finally{
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
});
