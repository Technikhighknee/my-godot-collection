import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {DEFAULT_TREE,generateTree,validateTree,type TreeMesh} from '../tools/asset-procgen/web/tree.mjs';
import {loadMap} from '../tools/map-editor/src/io/map-io.ts';
import {createEditorServer} from '../tools/map-editor/src/server.ts';

function checkGeometry(tree:TreeMesh) {
  assert.equal(tree.positions.length,tree.normals.length);
  assert.ok(tree.positions.every(Number.isFinite));
  assert.ok(tree.normals.every(Number.isFinite));
  assert.ok(tree.indices.every(i=>i<tree.positions.length/3));
  assert.ok(tree.indices.length/3<200000);
  assert.equal(tree.branches[0].parentId,null);
  assert.equal(tree.branches[0].level,0);
  const rootCount=tree.branches.filter(b=>!b.continuation).length;
  assert.ok(rootCount<tree.branches.length,
    'Terminal growth must be meshed continuously rather than capped per tier');
  const present=new Map(tree.branches.map(b=>[b.id,b]));
  const levels=new Set<number>();
  for(const branch of tree.branches){
    levels.add(branch.level);
    assert.ok(branch.baseRadius>0 && branch.tipRadius>0);
    assert.ok(branch.tipRadius<branch.baseRadius);
    assert.ok(branch.length>0);
    assert.equal(typeof branch.continuation,'boolean');
    if(branch.parentId!==null){
      const parent=present.get(branch.parentId);
      assert.ok(parent);
      assert.equal(parent!.level,branch.level-1);
      assert.ok(branch.baseRadius<parent!.baseRadius);
    }
    for(const value of [...branch.from,...branch.to])assert.ok(Number.isFinite(value));
  }
  assert.deepEqual([...levels].sort(),[0,1,2,3,4]);
  const edges=new Map<string,[number,number]>();
  const positions=tree.positions,indices=tree.indices,normals=tree.normals;
  for(let i=0;i<indices.length;i+=3){
    const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
    const u=[0,1,2].map(k=>positions[b+k]-positions[a+k]);
    const v=[0,1,2].map(k=>positions[c+k]-positions[a+k]);
    const face=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    assert.ok(Math.hypot(...face)>1e-11,'Degenerate wood face');
    const outward=face.reduce((sum,x,k)=>sum+x*
      (normals[a+k]+normals[b+k]+normals[c+k]),0);
    assert.ok(outward>=-1e-8,'Inverted face');
    const vertices=[indices[i],indices[i+1],indices[i+2]];
    for(const [j,k] of [[0,1],[1,2],[2,0]]){
      const lo=Math.min(vertices[j],vertices[k]),hi=Math.max(vertices[j],vertices[k]);
      const key=lo+':'+hi;
      const entry=edges.get(key)??[0,0];
      entry[0]++; entry[1]+=vertices[j]<vertices[k]?1:-1;
      edges.set(key,entry);
    }
  }
  for(const [count,winding] of edges.values()){
    assert.equal(count,2,'Each wood shell must be closed');
    assert.equal(winding,0,'Shared edges must have opposite winding');
  }
  for(let axis=0;axis<3;axis++){
    assert.ok(tree.bounds.max[axis]>tree.bounds.min[axis]);
    for(let i=axis;i<positions.length;i+=3){
      assert.ok(positions[i]>=tree.bounds.min[axis]-1e-4);
      assert.ok(positions[i]<=tree.bounds.max[axis]+1e-4);
    }
  }
}

test('seed is the only public shape setting',()=>{
  assert.deepEqual(validateTree(DEFAULT_TREE),DEFAULT_TREE);
  for(const bad of [null,{},[],{seed:-1},{seed:2**32},{seed:1.1},
    {seed:NaN},{seed:0,height:10}])assert.throws(()=>validateTree(bad));
});

test('tree produces a branched woody crown and thin terminal twigs',()=>{
  const oak=generateTree();
  checkGeometry(oak);
  // A terminal continuation plus four distinct lateral growth axes.
  const first=oak.branches.filter(b=>b.level===1);
  assert.equal(first.length,5);
  assert.equal(first.filter(b=>b.continuation).length,1);
  assert.equal(first.filter(b=>!b.continuation).length,4);
  const byId=new Map(oak.branches.map(b=>[b.id,b]));
  for(const continuation of oak.branches.filter(b=>b.continuation)){
    const parent=byId.get(continuation.parentId!);
    assert.ok(parent);
    assert.deepEqual(continuation.from,parent!.to);
    assert.equal(continuation.baseRadius,parent!.tipRadius);
  }
  const trunk=oak.branches[0];
  assert.ok(trunk.tipRadius/trunk.baseRadius>.30,
    'The main trunk must not end in a spike');
  assert.ok(oak.branches.filter(b=>b.level===2).length>=12);
  assert.ok(oak.branches.filter(b=>b.level===3).length>=28);
  assert.ok(oak.branches.filter(b=>b.level===4).length>=25);
  assert.ok(oak.branches.some(b=>b.level===4&&b.tipRadius<.01));
  assert.ok(oak.bounds.max[1]>7);
  assert.ok(oak.bounds.max[0]-oak.bounds.min[0]>5);
  assert.ok(oak.bounds.max[2]-oak.bounds.min[2]>5);
});

test('compact oak keeps a slim lower shaft and gradual, proportionate first limbs',()=>{
  for(const seed of [0,1,55,101,19641,3350221335,4294967295]){
    const tree=generateTree({seed}),trunk=tree.branches[0];
    assert.ok(trunk.baseRadius>=.17&&trunk.baseRadius<=.21,
      'Lower trunk must be slender relative to the crown');
    const retained=trunk.tipRadius/trunk.baseRadius;
    assert.ok(retained>=.79&&retained<=.86,
      'Supporting trunk must not collapse into a steep cone');

    // The root ring begins the first wood chain, using fourteen segments.
    const radiusAt=(row:number)=>{
      const count=14,p=tree.positions,center=[0,0,0];
      for(let i=0;i<count;i++)
        for(let axis=0;axis<3;axis++)center[axis]+=p[(row*count+i)*3+axis]/count;
      const radii=Array.from({length:count},(_,i)=>
        Math.hypot(...[0,1,2].map(axis=>p[(row*count+i)*3+axis]-center[axis])));
      return {average:radii.reduce((sum,v)=>sum+v,0)/count,maximum:Math.max(...radii)};
    };
    assert.ok(radiusAt(0).maximum<trunk.baseRadius*1.15,
      'The root flare must not become a broad conical skirt');
    assert.ok(radiusAt(14).average>trunk.baseRadius*.92,
      'The lower half of the trunk should lose little thickness');
    assert.ok(radiusAt(28).average>trunk.baseRadius*.79,
      'The first shaft section must retain most of its radius');

    const largeLimbs=tree.branches.filter(b=>b.level===1&&!b.continuation);
    assert.equal(largeLimbs.length,4);
    for(const limb of largeLimbs) {
      assert.ok(limb.baseRadius<trunk.baseRadius*.58,
        'Primary branches must be thinner than the supporting trunk');
    }
  }
});

test('compact crown shortens primary limb lineages without shrinking finer wood',()=>{
  for(const seed of [0,1,55,101,19641,3350221335,4294967295]){
    const tree=generateTree({seed}),trunk=tree.branches[0];
    const primary=tree.branches.filter(b=>b.level===1&&!b.continuation);
    const parentMap=new Map(tree.branches.map(b=>[b.id,b]));
    assert.equal(primary.length,4);
    for(const limb of primary) {
      assert.ok(limb.length>=2.0&&limb.length<2.70,
        'Compact small-oak primary limbs must remain short');
      assert.ok(limb.length<trunk.length*.67,
        'Major lateral limb must remain shorter than the supporting trunk');
      const continuation=tree.branches.filter(b=>
        b.continuation&&b.parentId===limb.id);
      assert.equal(continuation.length,1);
      assert.ok(continuation[0].length<1.45,
        'The next continuation should not undo the compact primary limb');
      assert.equal(parentMap.get(continuation[0].parentId!)?.id,limb.id);
    }
    const secondary=tree.branches.filter(b=>b.level===2&&!b.continuation);
    assert.ok(secondary.every(b=>b.length>=1.75&&b.length<=2.75),
      'Fine crown branching stays developed rather than being cut down');
    assert.ok(tree.branches.filter(b=>b.level===4).length>=25);
    assert.ok(trunk.baseRadius>=.17&&trunk.baseRadius<=.21);
    assert.ok(trunk.tipRadius/trunk.baseRadius>.79);
  }
});

test('primary wood spreads laterally and bends rather than forming straight spikes',()=>{
  const seeds=[0,55,101,19641,3350221335,4294967295];
  for(const seed of seeds){
    const tree=generateTree({seed});
    const primary=tree.branches.filter(b=>b.level===1&&!b.continuation);
    assert.equal(primary.length,4);
    for(const b of primary){
      const horizontal=Math.hypot(b.to[0]-b.from[0],b.to[2]-b.from[2]);
      const vertical=Math.abs(b.to[1]-b.from[1]);
      assert.ok(horizontal>vertical,
        'Major limbs must spread outwards rather than all pointing straight up');
    }

    // Wood is emitted once per non-continuation lineage. Its sections join
    // all consecutive continuing axes, so we can measure the actual tube
    // centerline without exposing another generation control or API.
    const continuations=new Map(tree.branches.filter(b=>b.continuation)
      .map(b=>[b.parentId!,b]));
    let vertexOffset=0;
    const curves=new Map<number,number>();
    for(const root of tree.branches.filter(b=>!b.continuation)){
      let rings=root.rings,endpoint=root;
      while(continuations.has(endpoint.id)){
        endpoint=continuations.get(endpoint.id)!;
        rings+=endpoint.rings-1;
      }
      const center=(row:number)=>{
        const value=[0,0,0];
        for(let i=0;i<root.sides;i++)
          for(let axis=0;axis<3;axis++)
            value[axis]+=tree.positions[(vertexOffset+row*root.sides+i)*3+axis]/root.sides;
        return value;
      };
      const first=center(0),last=center(rings-1),mid=center(Math.floor((rings-1)*.5));
      const vector=last.map((v,i)=>v-first[i]);
      const squared=vector.reduce((sum,x)=>sum+x*x,0);
      const displacement=mid.map((v,i)=>v-first[i]);
      const amount=displacement.reduce((sum,x,i)=>sum+x*vector[i],0)/squared;
      const projected=first.map((v,i)=>v+amount*vector[i]);
      curves.set(root.id,Math.hypot(...mid.map((v,i)=>v-projected[i])));
      vertexOffset+=rings*root.sides+2;
    }
    assert.equal(vertexOffset,tree.positions.length/3,'All wood lineages accounted for');
    for(const branch of primary)
      assert.ok(curves.get(branch.id)!>.10,
        'Each primary lineage must have visible curvature rather than a straight tube');
  }
});

test('main leader bends into the crown instead of remaining a vertical pole',()=>{
  const seeds=[0,1,55,101,19641,3350221335,4294967295];
  for(const seed of seeds){
    const tree=generateTree({seed}),trunk=tree.branches[0];
    const following=new Map(tree.branches.filter(b=>b.continuation)
      .map(b=>[b.parentId!,b]));
    const segments=[trunk];
    let leader=trunk;
    while(following.has(leader.id)){
      leader=following.get(leader.id)!;
      segments.push(leader);
    }
    assert.equal(segments.length,5,
      'Trunk must carry a single continuous leader through the crown');
    const displacement=Math.hypot(
      leader.to[0]-trunk.to[0],leader.to[2]-trunk.to[2]);
    assert.ok(displacement>1.1,
      'Crown leader should progressively turn away from the trunk axis');
    const upperGrowth=leader.to[1]-trunk.to[1];
    assert.ok(upperGrowth>2.5,
      'Crown leader must continue growing upward while turning sideways');
    assert.ok(upperGrowth<4.5,
      'Upper leader should not overtop a compact crown as a tall pole');
    assert.ok(trunk.tipRadius/trunk.baseRadius>.79);
  }
});

test('branch hierarchy varies between seeds without losing terminal growth',()=>{
  const seeds=[0,1,55,101,19641,3350221335,4294967295];
  const signatures=new Set<string>();
  for(const seed of seeds){
    const tree=generateTree({seed});
    const counts=[0,1,2,3,4].map(level=>tree.branches.filter(b=>b.level===level).length);
    assert.equal(counts[0],1);
    assert.equal(counts[1],5);
    assert.ok(counts[2]>=12 && counts[2]<=20);
    assert.ok(counts[3]>=28 && counts[3]<=60);
    assert.ok(counts[4]>=25 && counts[4]<=110);
    signatures.add(counts.join('/'));
    const continuationIds=new Set(tree.branches.filter(b=>b.continuation)
      .map(b=>b.parentId));
    assert.equal(continuationIds.size,tree.branches.filter(b=>b.continuation).length,
      'Every parent has only one through-growing continuation');
  }
  assert.ok(signatures.size>=3,
    'Tree form should vary through branching topology, not just rotations');
});

test('different seeds generate reproducible but distinct trees',()=>{
  const original=generateTree();
  assert.deepEqual(original.positions,generateTree().positions);
  assert.deepEqual(original.indices,generateTree().indices);
  for(const seed of [0,1,55,101,3350221335,4294967295]){
    const wood=generateTree({seed});
    checkGeometry(wood);
    assert.notDeepEqual(wood.positions,original.positions);
  }
});

test('Asset ProcGen exposes seed-only preview and does not break Map Editor',async()=>{
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
    const origin='http://127.0.0.1:'+address.port;
    for(const url of ['/tools/asset-procgen/','/tools/asset-procgen/app.js',
      '/tools/asset-procgen/style.css','/tools/asset-procgen/tree.mjs']){
      assert.equal((await fetch(origin+url)).status,200,url);
    }
    assert.equal((await fetch(origin+'/tools/asset-procgen/trunk.mjs')).status,404);
    assert.equal((await fetch(origin+'/tools/map-editor/')).status,200);
    assert.equal((await fetch(origin+'/api/map')).status,200);
  } finally {
    await new Promise<void>((resolve,reject)=>
      server.close(error=>error?reject(error):resolve()));
  }
});
