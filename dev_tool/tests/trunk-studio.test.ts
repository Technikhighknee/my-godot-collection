import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_TRUNK, generateTrunk, validateTrunk } from '../tools/trunk-studio/web/trunk.mjs';
import { exportTrunkGlb } from '../tools/trunk-studio/web/export.mjs';
import { loadMap } from '../tools/map-editor/src/io/map-io.ts';
import { createEditorServer } from '../tools/map-editor/src/server.ts';

const recipe=()=>structuredClone(DEFAULT_TRUNK);
const hash=(a:Uint8Array)=>createHash('sha256').update(a).digest('hex');
const bounds=(p:Float32Array)=>({
  minY:Math.min(...p.filter((_,i)=>i%3===1)),
  maxY:Math.max(...p.filter((_,i)=>i%3===1))
});
const radialAt=(mesh:ReturnType<typeof generateTrunk>['mesh'],height:number,range:number)=>{
  let largest=0;
  for(let i=0;i<mesh.positions.length;i+=3){
    const x=mesh.positions[i],y=mesh.positions[i+1],z=mesh.positions[i+2];
    if(Math.abs(y-height)<range)largest=Math.max(largest,Math.hypot(x,z));
  }
  return largest;
};

test('trunk recipe has one strict finite deterministic schema',()=>{
  const r=recipe();
  assert.deepEqual(validateTrunk(r),r);
  for(const bad of [
    {...r,name:''},{...r,seed:-1},{...r,seed:2**32},{...r,seed:.5},
    {...r,height:Infinity},{...r,radius:.01},{...r,flare:5},
    {...r,extra:'other'},{...r,schema:'not-a-trunk'}
  ]) assert.throws(()=>validateTrunk(bad));
});

test('trunk is its own single continuous mesh without foliage or branch artifacts',()=>{
  const r=recipe(),before=JSON.stringify(r),generated=generateTrunk(r);
  assert.equal(JSON.stringify(r),before);
  assert.deepEqual(Object.keys(generated.mesh).sort(),['indices','normals','positions','uv']);
  const m=generated.mesh;
  assert.equal(m.positions.length/3,161*97+2);
  assert.equal(m.indices.length/3,160*96*2+96*2);
  assert.ok(m.positions.every(Number.isFinite));
  assert.ok(m.normals.every(Number.isFinite));
  assert.ok(m.uv.every(Number.isFinite));
  assert.ok(m.indices.every(i=>i<m.positions.length/3));
  assert.ok(bounds(m.positions).maxY>=r.height);
  assert.equal(Object.hasOwn(generated,'foliage'),false);
  assert.equal(Object.hasOwn(generated,'branches'),false);
  for(let row=0;row<161;row++){
    const a=row*97*3,b=(row*97+96)*3;
    assert.ok(Math.hypot(...[0,1,2].map(k=>m.positions[a+k]-m.positions[b+k]))<1e-6,
      'Adjacent UV seam vertices must have identical positions');
    assert.ok(Math.hypot(...[0,1,2].map(k=>m.normals[a+k]-m.normals[b+k]))<1e-5,
      'UV seam must not create a shading seam');
  }
});

test('trunk triangles have positive area and outward normals',()=>{
  const {mesh:{positions:P,normals:N,indices:I}}=generateTrunk(recipe());
  let bad=0,collapsed=0;
  for(let i=0;i<I.length;i+=3){
    const a=I[i]*3,b=I[i+1]*3,c=I[i+2]*3;
    const u=[P[b]-P[a],P[b+1]-P[a+1],P[b+2]-P[a+2]];
    const v=[P[c]-P[a],P[c+1]-P[a+1],P[c+2]-P[a+2]];
    const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    if(Math.hypot(...n)<1e-10){collapsed++;continue;}
    if(n.reduce((s,x,k)=>s+x*(N[a+k]+N[b+k]+N[c+k]),0)<-1e-8)bad++;
  }
  assert.equal(collapsed,0);assert.equal(bad,0);
});

test('trunk remains an oriented closed manifold after welding only the UV seam',()=>{
  const {mesh:{positions:P,indices:I}}=generateTrunk(recipe());
  const byPosition=new Map<string,number>(),indices=new Int32Array(P.length/3);
  for(let i=0;i<P.length/3;i++){
    const k=Array.from(P.slice(i*3,i*3+3),n=>n.toFixed(5)).join(',');
    if(!byPosition.has(k))byPosition.set(k,byPosition.size);
    indices[i]=byPosition.get(k)!;
  }
  const edges=new Map<string,{count:number;direction:number}>();
  for(let i=0;i<I.length;i+=3){
    const a=indices[I[i]],b=indices[I[i+1]],c=indices[I[i+2]];
    for(const [x,y] of [[a,b],[b,c],[c,a]]){
      const key=Math.min(x,y)+':'+Math.max(x,y),entry=edges.get(key)??{count:0,direction:0};
      entry.count++;entry.direction+=x<y?1:-1;edges.set(key,entry);
    }
  }
  for(const entry of edges.values()){
    assert.equal(entry.count,2);
    assert.equal(entry.direction,0);
  }
});

test('buttressed base spreads out, and upper trunk tapers without sudden jumps',()=>{
  const g=generateTrunk(recipe()),r=g.recipe;
  const ground=radialAt(g.mesh,0,.03);
  const middle=radialAt(g.mesh,2.7,.06);
  const upper=radialAt(g.mesh,r.height*.75,.08);
  assert.ok(ground>middle*1.3,{ground,middle} as any);
  assert.ok(upper<middle);
  for(let row=1;row<160;row++){
    const r0=Math.hypot(g.mesh.positions[(row*97)*3],g.mesh.positions[(row*97)*3+2]);
    const r1=Math.hypot(g.mesh.positions[((row+1)*97)*3],g.mesh.positions[((row+1)*97)*3+2]);
    assert.ok(Math.abs(r1-r0)<.20,'Unexpected silhouette spike between rings');
  }
});

test('bark textures are seeded, opaque, tiled and directionally structured',()=>{
  const r=recipe(),a=generateTrunk(r),b=generateTrunk(r);
  assert.equal(a.textures.size,512);
  assert.equal(a.textures.albedo.length,512*512*4);
  assert.deepEqual(a.textures.albedo,b.textures.albedo);
  assert.deepEqual(a.textures.normal,b.textures.normal);
  let horizontal=0,vertical=0;
  const tex=a.textures.albedo;
  for(let y=1;y<511;y+=3)for(let x=1;x<511;x+=3){
    const p=(y*512+x)*4;
    horizontal+=Math.abs(tex[p]-tex[p+4]);
    vertical+=Math.abs(tex[p]-tex[p+512*4]);
    assert.equal(tex[p+3],255);
  }
  assert.ok(horizontal>vertical*.85,'Bark should vary predominantly across longitudinal grooves');
  const different=generateTrunk({...r,seed:101});
  assert.notEqual(hash(a.textures.albedo),hash(different.textures.albedo));
  assert.notEqual(hash(new Uint8Array(a.mesh.positions.buffer)),
    hash(new Uint8Array(different.mesh.positions.buffer)));
});

test('GLB is self-contained with two real PNG images, UVs and one trunk mesh',()=>{
  const result=generateTrunk(recipe()),one=exportTrunkGlb(result);
  assert.equal(hash(one),hash(exportTrunkGlb(result)));
  const dv=new DataView(one.buffer,one.byteOffset,one.byteLength);
  assert.equal(dv.getUint32(0,true),0x46546c67);
  assert.equal(dv.getUint32(4,true),2);
  assert.equal(dv.getUint32(8,true),one.length);
  const jsonSize=dv.getUint32(12,true),gltf=JSON.parse(Buffer.from(one.subarray(20,20+jsonSize)).toString('utf8'));
  assert.equal(gltf.meshes.length,1);
  assert.equal(gltf.meshes[0].primitives.length,1);
  assert.ok(gltf.meshes[0].primitives[0].attributes.TEXCOORD_0>=0);
  assert.equal(gltf.materials[0].normalTexture.index,1);
  assert.deepEqual(gltf.extras.recipe,result.recipe);
  assert.equal(gltf.images.length,2);
  const binStart=28+jsonSize;
  for(const image of gltf.images){
    assert.equal(image.mimeType,'image/png');
    const view=gltf.bufferViews[image.bufferView];
    const png=one.subarray(binStart+view.byteOffset,binStart+view.byteOffset+view.byteLength);
    assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
    const length=new DataView(png.buffer,png.byteOffset,png.byteLength).getUint32(8,false);
    assert.equal(length,13);
    const dataOffset=8+12+13;
    const idatLength=new DataView(png.buffer,png.byteOffset,png.byteLength).getUint32(dataOffset,false);
    const inflated=inflateSync(png.subarray(dataOffset+8,dataOffset+8+idatLength));
    assert.equal(inflated.length,512*(512*4+1));
  }
});

test('Trunk Studio serves only explicit assets and leaves the Map Editor untouched',async()=>{
  const html=readFileSync(new URL('../tools/trunk-studio/web/index.html',import.meta.url),'utf8');
  assert.match(html,/Just the trunk/);
  assert.doesNotMatch(html,/id="branchDensity"/);
  for(const file of ['app.js','trunk.mjs','export.mjs']){
    assert.doesNotThrow(()=>execFileSync(process.execPath,['--check',
      fileURLToPath(new URL('../tools/trunk-studio/web/'+file,import.meta.url))],{stdio:'pipe'}));
  }
  const doc=await loadMap('../map_system/coastal_relief.map.json');
  const server=createEditorServer(doc);
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const addr=server.address();assert.ok(addr && typeof addr!=='string');
    const base='http://127.0.0.1:'+addr.port;
    for(const path of ['/tools/trunk-studio/','/tools/trunk-studio']){
      const res=await fetch(base+path);assert.equal(res.status,200);assert.match(await res.text(),/Trunk Studio/);
    }
    for(const extension of ['app.js','trunk.mjs','export.mjs','style.css']){
      const response=await fetch(base+'/tools/trunk-studio/'+extension);
      assert.equal(response.status,200);
      assert.ok((await response.text()).length>100);
    }
    assert.equal((await fetch(base+'/api/map')).status,200);
    assert.equal((await fetch(base+'/tools/map-editor/')).status,200);
    assert.equal((await fetch(base+'/tools/trunk-studio/../src/server.ts')).status,404);
    assert.equal((await fetch(base+'/tools/trunk-studio/',{method:'POST'})).status,405);
  } finally {
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
});
