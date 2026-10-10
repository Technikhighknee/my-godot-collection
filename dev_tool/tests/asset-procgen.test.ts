import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_STEM, generateStem, validateStem, type StemMesh } from '../tools/asset-procgen/web/trunk.mjs';
import { loadMap } from '../tools/map-editor/src/io/map-io.ts';
import { createEditorServer } from '../tools/map-editor/src/server.ts';

function verifySurface(mesh: StemMesh) {
  const {positions: p, normals: n, indices: f} = mesh;
  assert.equal(p.length, n.length);
  assert.ok(p.every(Number.isFinite));
  assert.ok(n.every(Number.isFinite));
  assert.ok(f.every(i => i < p.length / 3));
  const welded:number[] = [];
  const unique = new Map<string,number>();
  for(let i=0;i<p.length/3;i++){
    const key = Array.from(p.subarray(i*3,i*3+3),v=>v.toFixed(5)).join(',');
    if(!unique.has(key)) unique.set(key,unique.size);
    welded[i] = unique.get(key)!;
  }
  const edges = new Map<string,[number,number]>();
  for(let j=0;j<f.length;j+=3){
    const [a,b,c] = [f[j],f[j+1],f[j+2]];
    const u = [0,1,2].map(k=>p[b*3+k]-p[a*3+k]);
    const v = [0,1,2].map(k=>p[c*3+k]-p[a*3+k]);
    const cross = [
      u[1]*v[2]-u[2]*v[1],
      u[2]*v[0]-u[0]*v[2],
      u[0]*v[1]-u[1]*v[0],
    ];
    assert.ok(Math.hypot(...cross)>1e-10,'Degenerate stem triangle');
    const orientation = cross.reduce((sum,x,k)=>sum+x*
      (n[a*3+k]+n[b*3+k]+n[c*3+k]),0);
    assert.ok(orientation>=-1e-8,'Inward-facing stem triangle');
    for(const [x,y] of [[a,b],[b,c],[c,a]]){
      const i=welded[x],k=welded[y],key=Math.min(i,k)+':'+Math.max(i,k);
      const pair = edges.get(key)??[0,0];
      pair[0]++; pair[1]+=i<k?1:-1; edges.set(key,pair);
    }
  }
  for(const [count,wind] of edges.values()){
    assert.equal(count,2,'All edges must be closed after welding the UV seam');
    assert.equal(wind,0,'All shared edges must be oppositely wound');
  }
}
function center(mesh: StemMesh, row:number) {
  const stride=mesh.sides+1,result=[0,0,0];
  for(let i=0;i<mesh.sides;i++)
    for(let k=0;k<3;k++) result[k]+=mesh.positions[(row*stride+i)*3+k]/mesh.sides;
  return result;
}
function width(mesh:StemMesh,row:number) {
  const middle=center(mesh,row);
  let r=0;
  for(let i=0;i<mesh.sides;i++){
    const index=(row*(mesh.sides+1)+i)*3;
    r+=Math.hypot(...[0,1,2].map(k=>mesh.positions[index+k]-middle[k]))/mesh.sides;
  }
  return r;
}

test('one strictly validated dominant-growth recipe with no old head controls',()=>{
  assert.deepEqual(validateStem(DEFAULT_STEM),DEFAULT_STEM);
  for(const invalid of [
    {...DEFAULT_STEM,seed:-1},{...DEFAULT_STEM,seed:2**32},
    {...DEFAULT_STEM,height:Infinity},{...DEFAULT_STEM,radius:2},
    {...DEFAULT_STEM,leaderStart:.9},{...DEFAULT_STEM,leaderReach:2},
    {...DEFAULT_STEM,lean:-.5},
  ]) assert.throws(()=>validateStem(invalid));
  assert.equal(Object.hasOwn(DEFAULT_STEM,'headMass'),false);
  assert.equal(Object.hasOwn(DEFAULT_STEM,'shaftHeight'),false);
});

test('the entire trunk-to-leader is a deterministic, oriented closed piece of wood',()=>{
  const a=generateStem(),b=generateStem();
  assert.deepEqual(a.positions,b.positions);
  assert.deepEqual(a.indices,b.indices);
  assert.deepEqual(Object.keys(a).sort(),['positions','normals','indices','rings','sides','settings'].sort());
  verifySurface(a);
  const stride=a.sides+1;
  for(let row=0;row<a.rings;row++)for(let k=0;k<3;k++)
    assert.equal(a.positions[(row*stride)*3+k],
      a.positions[(row*stride+a.sides)*3+k],'Periodic radial seam');
});

test('the main stem actually becomes an oblique leader, not a capped upright post',()=>{
  const m=generateStem(),tip=(m.rings*(m.sides+1)+1)*3;
  const apex=[m.positions[tip],m.positions[tip+1],m.positions[tip+2]];
  const foot=center(m,0);
  const sideways=Math.hypot(apex[0]-foot[0],apex[2]-foot[2]);
  assert.ok(sideways>m.settings.height*.20,'Leader must visibly turn sideways');
  assert.ok(apex[1]>m.settings.height*.95,'Leader must keep climbing');
  assert.ok(width(m,m.rings-1)<width(m,0)*.07,'Tip must be slender');
  assert.ok(width(m,m.rings-1)>0,'Terminal ring must retain valid geometry');
  const straight=generateStem({...DEFAULT_STEM,leaderReach:0,lean:0,character:0});
  const end=(straight.rings*(straight.sides+1)+1)*3;
  assert.ok(Math.hypot(straight.positions[end],straight.positions[end+2])<1e-3,
    'A zero-turn recipe must remain vertical');
});

test('leader onset and reach change the actual path, without shifting the root collar',()=>{
  const early=generateStem({...DEFAULT_STEM,leaderStart:.25});
  const late=generateStem({...DEFAULT_STEM,leaderStart:.7});
  const weak=generateStem({...DEFAULT_STEM,leaderReach:.15});
  const strong=generateStem({...DEFAULT_STEM,leaderReach:1.4});
  const bottom=(m:StemMesh)=>center(m,0);
  assert.deepEqual(bottom(early),bottom(late));
  assert.deepEqual(bottom(weak),bottom(strong));
  const mid=Math.floor(early.rings*.7);
  assert.ok(center(early,mid)[0]>center(late,mid)[0]+.05,
    'Early leader must have moved farther from the original growth axis');
  const atTop=strong.rings-1;
  assert.ok(center(strong,atTop)[0]>center(weak,atTop)[0]+1,
    'Reach must change the path itself, not only radial relief');
});

test('seed variation and parameter extremes retain valid oriented geometry',()=>{
  for(const recipe of [
    {...DEFAULT_STEM,seed:0,character:0,buttress:0,leaderReach:0,lean:0},
    {...DEFAULT_STEM,seed:3350221335,radius:.28,leaderReach:1.5,leaderStart:.25},
    {...DEFAULT_STEM,seed:4294967295,height:16,radius:1,leaderReach:1.5,
      character:1.5,buttress:1.5,lean:.3},
  ]) verifySurface(generateStem(recipe));
});

test('Asset ProcGen still contains only the trunk and serves the existing editor',async()=>{
  const html=readFileSync(new URL('../tools/asset-procgen/web/index.html',import.meta.url),'utf8');
  assert.match(html,/id="viewport"/);
  for(const key of ['leaderStart','leaderReach','lean'])
    assert.match(html,new RegExp('data-key="'+key+'"'));
  assert.doesNotMatch(html,/data-key="headMass"|data-key="taper"|Export GLB|Save recipe/);
  const doc=await loadMap('../map_system/coastal_relief.map.json');
  const server=createEditorServer(doc);
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const address=server.address();
    assert.ok(address && typeof address!=='string');
    const base='http://127.0.0.1:'+address.port;
    for(const path of ['/tools/asset-procgen/','/tools/asset-procgen',
      '/tools/asset-procgen/app.js','/tools/asset-procgen/style.css','/tools/asset-procgen/trunk.mjs']){
      const response=await fetch(base+path);
      assert.equal(response.status,200,path);
    }
    assert.equal((await fetch(base+'/tools/map-editor/')).status,200);
    assert.equal((await fetch(base+'/api/map')).status,200);
  } finally {
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
});
