import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  DEFAULT_TREE,generateTree,validateTree,type TreeMesh,
} from '../tools/asset-procgen/web/tree.mjs';
import {loadMap} from '../tools/map-editor/src/io/map-io.ts';
import {createEditorServer} from '../tools/map-editor/src/server.ts';

const SEEDS=[0,1,55,101,19641,30895,3350221335,4294967295];

function inspectGeometry(tree:TreeMesh){
  const {positions,indices,normals,bounds}=tree;
  assert.equal(positions.length,normals.length);
  assert.equal(positions.length%3,0);
  assert.equal(indices.length%3,0);
  assert.ok(positions.every(Number.isFinite));
  assert.ok(normals.every(Number.isFinite));
  assert.ok(indices.every(i=>i<positions.length/3));
  assert.ok(indices.length/3<200000);
  const edges=new Map<string,[number,number]>();
  for(let i=0;i<indices.length;i+=3){
    const ids=[indices[i],indices[i+1],indices[i+2]];
    const [a,b,c]=ids.map(v=>v*3);
    const u=[0,1,2].map(k=>positions[b+k]-positions[a+k]);
    const v=[0,1,2].map(k=>positions[c+k]-positions[a+k]);
    const face=[
      u[1]*v[2]-u[2]*v[1],
      u[2]*v[0]-u[0]*v[2],
      u[0]*v[1]-u[1]*v[0],
    ];
    assert.ok(Math.hypot(...face)>1e-11,'Degenerate triangle');
    const alignment=face.reduce((sum,x,k)=>sum+x*
      (normals[a+k]+normals[b+k]+normals[c+k]),0);
    assert.ok(alignment>=-1e-8,'Triangle faces inward');
    for(const [from,to] of [[ids[0],ids[1]],[ids[1],ids[2]],[ids[2],ids[0]]]){
      const key=Math.min(from,to)+':'+Math.max(from,to);
      const edge=edges.get(key)??[0,0];
      edge[0]++;edge[1]+=from<to?1:-1;
      edges.set(key,edge);
    }
  }
  for(const [count,winding] of edges.values()){
    assert.equal(count,2,'Every woody shell must be closed');
    assert.equal(winding,0,'Shared edges must face opposite ways');
  }
  for(let axis=0;axis<3;axis++){
    assert.ok(bounds.max[axis]>bounds.min[axis]);
    for(let i=axis;i<positions.length;i+=3){
      assert.ok(positions[i]>=bounds.min[axis]-1e-4);
      assert.ok(positions[i]<=bounds.max[axis]+1e-4);
    }
  }
}

test('seed is the only public generation setting',()=>{
  assert.deepEqual(validateTree(DEFAULT_TREE),DEFAULT_TREE);
  for(const bad of [
    null,{},[],{seed:-1},{seed:2**32},{seed:NaN},{seed:1.5},
    {seed:0,height:10},{seed:0,foliage:false},
  ])assert.throws(()=>validateTree(bad));
});

test('wood growth uses four orders with continuing ends and lateral offspring',()=>{
  for(const seed of SEEDS){
    const tree=generateTree({seed});
    const counts=[0,1,2,3].map(level=>
      tree.branches.filter(b=>b.level===level).length);
    assert.deepEqual(counts,[1,5,15,60]);
    assert.equal(tree.branches.length,81);
    const byId=new Map(tree.branches.map(b=>[b.id,b]));
    assert.equal(byId.size,81);
    assert.equal(tree.branches[0].parentId,null);
    assert.equal(tree.branches[0].continuation,false);
    const continued=new Set<number>();
    for(const branch of tree.branches.slice(1)){
      assert.ok(branch.parentId!==null);
      const parent=byId.get(branch.parentId!);
      assert.ok(parent,'Unknown parent');
      assert.equal(branch.level,parent!.level+1);
      assert.ok(branch.baseRadius>0&&branch.tipRadius>0);
      assert.ok(branch.tipRadius<branch.baseRadius);
      assert.ok(branch.length>0);
      if(branch.continuation){
        assert.ok(!continued.has(branch.parentId!));
        continued.add(branch.parentId!);
        assert.deepEqual(branch.from,parent!.to);
        assert.equal(branch.baseRadius,parent!.tipRadius);
      } else {
        assert.ok(branch.baseRadius<parent!.baseRadius);
      }
    }
    assert.equal(continued.size,21);
    assert.equal(tree.branches.filter(b=>!b.continuation).length,60);
  }
});

test('small oak builds crown reach with short supports and longer boughs',()=>{
  for(const seed of SEEDS){
    const tree=generateTree({seed});
    const trunk=tree.branches[0];
    assert.ok(trunk.baseRadius>.17&&trunk.baseRadius<.21);
    assert.ok(trunk.tipRadius/trunk.baseRadius>.39);
    assert.ok(trunk.tipRadius/trunk.baseRadius<.43);
    const first=tree.branches.filter(b=>b.level===1&&!b.continuation);
    const second=tree.branches.filter(b=>b.level===2&&!b.continuation);
    const tips=tree.branches.filter(b=>b.level===3&&!b.continuation);
    assert.equal(first.length,4);
    assert.equal(second.length,10);
    assert.equal(tips.length,45);
    assert.ok(first.every(b=>b.length>1.04&&b.length<1.36));
    assert.ok(second.every(b=>b.length>2.25&&b.length<2.73));
    assert.ok(tips.every(b=>b.length>1.65&&b.length<1.96));
    const average=(axes:TreeMesh['branches'])=>axes.reduce((sum,b)=>sum+b.length,0)/axes.length;
    assert.ok(average(second)>average(first)*1.8);
    for(const support of first){
      const following=second.filter(b=>b.parentId===support.id);
      assert.equal(following.length,2);
      const offset=Math.min(...following.map(b=>
        Math.hypot(...b.from.map((x,i)=>x-support.from[i]))/support.length));
      assert.ok(offset<.45,'Secondary bough must develop near support base');
    }
    const height=tree.bounds.max[1]-tree.bounds.min[1];
    const width=Math.max(tree.bounds.max[0]-tree.bounds.min[0],
      tree.bounds.max[2]-tree.bounds.min[2]);
    assert.ok(height>9&&height<13);
    assert.ok(width>5&&width<11.5);
  }
});

test('local, seeded growth produces different three-dimensional crowns',()=>{
  const kinds=new Set<string>();
  const first=generateTree(DEFAULT_TREE);
  const repeat=generateTree(DEFAULT_TREE);
  assert.deepEqual(first.positions,repeat.positions);
  assert.deepEqual(first.normals,repeat.normals);
  assert.deepEqual(first.indices,repeat.indices);
  for(const seed of SEEDS){
    const tree=generateTree({seed});
    if(seed!==DEFAULT_TREE.seed)assert.notDeepEqual(tree.positions,first.positions);
    const branches=tree.branches.filter(b=>b.level===1&&!b.continuation)
      .sort((a,b)=>a.from[1]-b.from[1]);
    const angles=branches.map(b=>
      (Math.atan2(b.to[2]-b.from[2],b.to[0]-b.from[0])+2*Math.PI)%(2*Math.PI));
    const sorted=[...angles].sort((a,b)=>a-b);
    const gaps=sorted.map((v,i)=>
      (sorted[(i+1)%sorted.length]-v+2*Math.PI)%(2*Math.PI));
    assert.ok(gaps.every(v=>v>.4),'Main boughs must spread across azimuths');
    kinds.add(angles.map(v=>sorted.indexOf(v)).join('/'));
  }
  assert.ok(kinds.size>=3,'Azimuth assignments must vary between seeds');
});

test('wood surfaces have consistent topology, normals and bounds',()=>{
  for(const seed of SEEDS)inspectGeometry(generateTree({seed}));
});

test('asset generator remains seed-only and Map Editor routes still work',async()=>{
  const html=readFileSync(new URL('../tools/asset-procgen/web/index.html',import.meta.url),'utf8');
  assert.match(html,/id="viewport"/);
  assert.match(html,/id="seedValue" type="number"/);
  for(const id of ['reseed','whole','foot','crown','silhouette','turntable'])
    assert.ok(html.includes('id="'+id+'"'));
  assert.doesNotMatch(html,/data-key=|type="range"|Export GLB|Save recipe/);
  const app=readFileSync(new URL('../tools/asset-procgen/web/app.js',import.meta.url),'utf8');
  assert.match(app,/generateTree\(settings\)/);
  assert.doesNotMatch(app,/trunk\.mjs|export GLB/i);
  const map=await loadMap('../map_system/coastal_relief.map.json');
  const server=createEditorServer(map);
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const address=server.address();
    assert.ok(address&&typeof address!=='string');
    const base='http://127.0.0.1:'+address.port;
    for(const route of [
      '/tools/asset-procgen/','/tools/asset-procgen/app.js',
      '/tools/asset-procgen/style.css','/tools/asset-procgen/tree.mjs',
      '/tools/map-editor/','/api/map',
    ])assert.equal((await fetch(base+route)).status,200,route);
    assert.equal((await fetch(base+'/tools/asset-procgen/trunk.mjs')).status,404);
  } finally {
    await new Promise<void>((resolve,reject)=>
      server.close(error=>error?reject(error):resolve()));
  }
});
