import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FIR, generateFir } from '../tools/asset-procgen/web/fir.mjs';
import { generateTree } from '../tools/asset-procgen/web/tree.mjs';

const SEEDS=[0,1,55,101,19641,30895,3350221335,4294967295];

test('fir uses the same seed-only contract as the accepted oak',()=>{
  assert.deepEqual(DEFAULT_FIR,{seed:19641});
  for(const invalid of [
    null,[],{}, {seed:-1},{seed:2**32},{seed:1.5},
    {seed:NaN},{seed:'1'}, {seed:0,height:8},
    {seed:0,needleDensity:.8},
  ])assert.throws(()=>generateFir(invalid as never));
  const oak=generateTree({seed:19641});
  const fir=generateFir({seed:19641});
  assert.notDeepEqual(fir.positions,oak.positions);
  assert.deepEqual(generateTree({seed:19641}).positions,oak.positions,
    'Adding fir must not change the accepted oak generator');
});

test('young fir has one uninterrupted leader and annual branch whorls',()=>{
  for(const seed of SEEDS){
    const fir=generateFir({seed});
    assert.equal(fir.branches[0].level,0);
    assert.equal(fir.branches[0].parentId,null);
    assert.equal(fir.branches[0].rings,49);
    const whorlBranches=fir.branches.filter(b=>b.level===1);
    const sprays=fir.branches.filter(b=>b.level===2);
    const shoots=fir.branches.filter(b=>b.level===3);
    assert.equal(whorlBranches.length,44);
    assert.ok(sprays.length>=350&&sprays.length<=440);
    assert.ok(shoots.length>=sprays.length*.7&&shoots.length<=sprays.length*1.2);
    assert.equal(fir.branches.length,1+44+sprays.length+shoots.length);
    const byId=new Map(fir.branches.map(b=>[b.id,b]));
    assert.equal(byId.size,fir.branches.length);
    for(const b of fir.branches.slice(1)){
      assert.equal(b.continuation,false);
      const parent=byId.get(b.parentId!);
      assert.ok(parent,'Each shoot requires a supporting wood axis');
      assert.equal(parent.level+1,b.level);
      assert.ok(b.baseRadius>0&&b.tipRadius>0&&b.tipRadius<b.baseRadius);
      assert.ok(b.baseRadius<parent.baseRadius);
    }
    assert.ok(whorlBranches.every(b=>b.parentId===0));
    const elevations=whorlBranches.map(b=>b.from[1]);
    assert.ok(Math.min(...elevations)>1.0);
    assert.ok(Math.max(...elevations)<7.3);
    const lower=whorlBranches.filter(b=>b.from[1]<2.7);
    const upper=whorlBranches.filter(b=>b.from[1]>5.4);
    const mean=(xs:typeof whorlBranches)=>xs.reduce((s,b)=>s+b.length,0)/xs.length;
    assert.ok(lower.length>=8&&upper.length>=8);
    assert.ok(mean(lower)>mean(upper)*2.2,
      'Lower whorls must extend farther than the upper crown');
    const height=fir.bounds.max[1]-fir.bounds.min[1];
    const width=Math.max(fir.bounds.max[0]-fir.bounds.min[0],
      fir.bounds.max[2]-fir.bounds.min[2]);
    assert.ok(height>6.9&&height<8.1);
    assert.ok(width>4.0&&width<6.2);
    assert.ok(fir.bounds.min[1]>=-.005);
  }
});

test('fir wood grows in gently arched boughs with flattened lateral sprays',()=>{
  for(const seed of SEEDS){
    const fir=generateFir({seed});
    let offset=0;
    const curves:number[]=[];
    const pitches:number[]=[];
    const secondary= fir.branches.filter(b=>b.level===2);
    const tertiary= fir.branches.filter(b=>b.level===3);
    for(const branch of fir.branches){
      // Each tube is recorded as a sequence of rings with two cap vertices.
      const ringCenter=(ring:number)=>{
        const result=[0,0,0];
        const base=(offset+ring*branch.sides)*3;
        for(let side=0;side<branch.sides;side++)
          for(let k=0;k<3;k++)result[k]+=fir.positions[base+side*3+k]/branch.sides;
        return result;
      };
      if(branch.level===1){
        const first=ringCenter(0),mid=ringCenter(8),last=ringCenter(16);
        curves.push(mid[1]-(first[1]+last[1])*.5);
      }
      if(branch.level>=2){
        const dx=branch.to[0]-branch.from[0];
        const dy=branch.to[1]-branch.from[1];
        const dz=branch.to[2]-branch.from[2];
        const distance=Math.hypot(dx,dy,dz);
        pitches.push(Math.abs(dy/distance));
      }
      offset+=branch.rings*branch.sides+2;
    }
    assert.equal(offset*3,fir.positions.length);
    assert.ok(curves.filter(x=>x<-.01).length>=28,
      'Most supporting fir limbs should show a small downward arc');
    pitches.sort((a,b)=>a-b);
    assert.ok(pitches[Math.floor(pitches.length*.95)]<.2,
      'Most fine shoots should remain in a broadly horizontal spray');
    const supports=new Map<number,number>();
    for(const branch of tertiary)
      supports.set(branch.parentId!,1+(supports.get(branch.parentId!)??0));
    assert.ok([...supports.values()].some(n=>n===2),
      'Lateral shoots should support more than one terminal branch');
    assert.ok(secondary.some(b=>supports.get(b.id)===1),
      'Short laterals retain sparser tip branching');
  }
});

test('fir secondary ranks vary in station count, asymmetry and terminal maturity',()=>{
  for(const seed of SEEDS){
    const fir=generateFir({seed});
    const secondaryByBough=new Map<number,number>();
    const terminalsByLateral=new Map<number,number>();
    for(const axis of fir.branches){
      if(axis.level===2)
        secondaryByBough.set(axis.parentId!,
          (secondaryByBough.get(axis.parentId!)??0)+1);
      if(axis.level===3)
        terminalsByLateral.set(axis.parentId!,
          (terminalsByLateral.get(axis.parentId!)??0)+1);
    }
    const secondaries=fir.branches.filter(b=>b.level===2);
    assert.equal(secondaryByBough.size,44);
    assert.ok(new Set(secondaryByBough.values()).size>=5,
      'Supporting boughs need genuinely different lateral densities');
    assert.ok(secondaries.some(b=>!terminalsByLateral.has(b.id)),
      'Young laterals should sometimes remain unbranched');
    assert.ok([...terminalsByLateral.values()].some(count=>count===1));
    assert.ok([...terminalsByLateral.values()].some(count=>count===2));
    assert.ok([...terminalsByLateral.values()].some(count=>count===3),
      'Vigorous laterals can support three terminal shoots');
  }
});

test('young fir wood has subtle, noncircular longitudinally ridged surfaces',()=>{
  for(const seed of SEEDS){
    const fir=generateFir({seed});
    const trunk=fir.branches[0];
    const sides=trunk.sides,ring=16;
    assert.ok(sides>=16,'Trunk ring resolution must support restrained ridges');
    const center=[0,0,0];
    for(let side=0;side<sides;side++)
      for(let k=0;k<3;k++)
        center[k]+=fir.positions[(ring*sides+side)*3+k]/sides;
    const radii=Array.from({length:sides},(_,side)=>{
      const offset=(ring*sides+side)*3;
      return Math.hypot(...center.map((v,k)=>fir.positions[offset+k]-v));
    });
    const mean=radii.reduce((a,b)=>a+b,0)/sides;
    const variation=Math.sqrt(radii.reduce((a,b)=>a+(b-mean)**2,0)/sides)/mean;
    assert.ok(variation>.02,'Visible wood should not be a perfect cylinder');
    assert.ok(variation<.08,'Young fir bark geometry must remain restrained');
    for(let i=0;i<fir.normals.length;i+=3){
      const normal=Math.hypot(fir.normals[i],fir.normals[i+1],fir.normals[i+2]);
      assert.ok(normal>.995&&normal<1.005,
        'The longitudinal surface normals should remain normalized');
    }
  }
});

test('fir produces deterministic but nonidentical wood for different seeds',()=>{
  const a=generateFir(DEFAULT_FIR);
  const b=generateFir(DEFAULT_FIR);
  assert.deepEqual(a.positions,b.positions);
  assert.deepEqual(a.normals,b.normals);
  assert.deepEqual(a.indices,b.indices);
  const signatures=new Set<string>();
  for(const seed of SEEDS){
    const tree=generateFir({seed});
    signatures.add(Array.from(tree.positions.subarray(0,36))
      .map(x=>x.toFixed(5)).join(','));
  }
  assert.ok(signatures.size>=6);
});

test('every fir wood surface is closed and consistently outward facing',()=>{
  for(const seed of SEEDS){
    const fir=generateFir({seed}),P=fir.positions,N=fir.normals,I=fir.indices;
    assert.equal(P.length,N.length);
    assert.equal(P.length%3,0);
    assert.equal(I.length%3,0);
    assert.ok(I.length/3<200000);
    assert.ok(P.every(Number.isFinite)&&N.every(Number.isFinite));
    assert.ok(I.every(n=>n<P.length/3));
    const edges=new Map<string,[number,number]>();
    for(let i=0;i<I.length;i+=3){
      const ids=[I[i],I[i+1],I[i+2]];
      const [a,b,c]=ids.map(n=>n*3);
      const u=[0,1,2].map(k=>P[b+k]-P[a+k]);
      const v=[0,1,2].map(k=>P[c+k]-P[a+k]);
      const face=[
        u[1]*v[2]-u[2]*v[1],
        u[2]*v[0]-u[0]*v[2],
        u[0]*v[1]-u[1]*v[0],
      ];
      assert.ok(Math.hypot(...face)>1e-11,'Collapsed fir triangle');
      assert.ok(face.reduce((sum,x,k)=>sum+x*
        (N[a+k]+N[b+k]+N[c+k]),0)>=-1e-8,
        'Fir face must point outward');
      for(const [x,y] of [[ids[0],ids[1]],[ids[1],ids[2]],[ids[2],ids[0]]]){
        const key=Math.min(x,y)+':'+Math.max(x,y);
        const edge=edges.get(key)??[0,0];
        edge[0]++;edge[1]+=x<y?1:-1;
        edges.set(key,edge);
      }
    }
    for(const [count,direction] of edges.values()){
      assert.equal(count,2,'Every fir tube must close');
      assert.equal(direction,0,'Every shared edge must reverse direction');
    }
    for(let k=0;k<3;k++)
      for(let i=k;i<P.length;i+=3){
        assert.ok(P[i]>=fir.bounds.min[k]-1e-4);
        assert.ok(P[i]<=fir.bounds.max[k]+1e-4);
      }
  }
});
