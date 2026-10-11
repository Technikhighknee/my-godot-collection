import test from 'node:test';
import assert from 'node:assert/strict';
import {oakLeafProfile} from '../tools/asset-procgen/web/oak-leaf.mjs';
import {generateOakFoliage} from '../tools/asset-procgen/web/oak-foliage.mjs';
import {generateTree} from '../tools/asset-procgen/web/tree.mjs';

const SEEDS=[0,1,55,101,19641,4294967295];

test('European oak leaves have independent lobed edges and basal ears',()=>{
  const outlines=new Set<string>();
  const lobeCounts=new Set<number>();
  for(const seed of SEEDS){
    const leaf=oakLeafProfile(seed);
    assert.ok(leaf.lobes>=4&&leaf.lobes<=6);
    assert.equal(leaf.outline.length,37);
    assert.equal(leaf.veins.length,leaf.lobes);
    assert.ok(leaf.baseEar>.20);
    assert.ok(leaf.depth>.3&&leaf.depth<.6);
    for(const edge of ['left','right'] as const){
      const w=leaf.outline.map(point=>point[edge]);
      assert.ok(w.every(v=>Number.isFinite(v)&&v>0));
      const maxima=w.slice(1,-1).filter((v,i)=>v>w[i]&&v>w[i+2]).length;
      assert.ok(maxima>=4&&maxima<=6,'Oak edges need several rounded lobes');
      assert.ok(w[2]>w[0]*2.1,'A basal auricle must project from the blade base');
    }
    assert.ok(leaf.outline.some(p=>Math.abs(p.left-p.right)>.005),
      'Living leaves should not be perfectly mirrored');
    outlines.add(leaf.outline.map(p=>p.left.toFixed(4)).join(','));
    lobeCounts.add(leaf.lobes);
  }
  assert.ok(outlines.size===SEEDS.length);
  assert.ok(lobeCounts.size>=2);
  for(const seed of [-1,2**32,1.5,Number.NaN,Infinity])
    assert.throws(()=>oakLeafProfile(seed));
});

test('oak foliage grows from all terminal wood and never changes its skeleton',()=>{
  for(const seed of [0,101,19641,4294967295]){
    const tree=generateTree({seed});
    const positions=tree.positions.slice();
    const indices=tree.indices.slice();
    const f=generateOakFoliage(tree);
    assert.equal(f.seed,seed);
    // One connected mass per secondary bough; terminal axes belong
    // to their parent mass rather than forming isolated leaf balls.
    assert.equal(f.crownMasses.length,15);
    assert.equal(new Set(f.crownMasses.map(m=>m.supportAxisId)).size,15);
    assert.ok(f.crownMasses.every(m=>
      m.axisCount===5&&m.leafCount>0&&m.shootCount>0&&
      m.center.length===3&&m.center.every(Number.isFinite)&&
      m.cushions.length===2&&m.cushions.every(c=>
        c.center.length===3&&c.center.every(Number.isFinite)&&
        c.radii.length===3&&c.radii.every(r=>Number.isFinite(r)&&r>.45)&&
        Number.isInteger(c.supportAxisId))));
    assert.equal(f.crownMasses.reduce((n,m)=>n+m.leafCount,0),f.leafCount);
    assert.equal(f.crownMasses.reduce((n,m)=>n+m.shootCount,0),f.shootCount);
    assert.equal(f.branchesUsed,75,
      'Both secondary and terminal wood must carry connected foliage families');
    assert.ok(f.leafCount>6500&&f.leafCount<15000,
      'The distinct leafy cushions need ample individually modeled leaves');
    assert.ok(f.shootCount>=1100&&f.shootCount<=2600,
      'Cushions need dense connected secondary and terminal sprays');
    assert.ok(f.veinCount>=f.leafCount*8);
    assert.ok(f.veinCount<=f.leafCount*12);
    assert.deepEqual(tree.positions,positions,'Foliage cannot reshape accepted oak wood');
    assert.deepEqual(tree.indices,indices,'Foliage cannot rewrite oak indices');
    assert.equal(f.positions.length,f.normals.length);
    assert.equal(f.colors.length,f.positions.length);
    assert.equal(f.indices.length%3,0);
    assert.ok(f.indices.length/3<2500000,
      'Preserve detailed individual blades without unbounded geometry');
    assert.ok(f.positions.every(Number.isFinite));
    assert.ok(f.normals.every(Number.isFinite));
    assert.ok(f.colors.every(x=>Number.isFinite(x)&&x>=0&&x<=1));
    assert.ok(f.indices.every(i=>i<f.positions.length/3));
    assert.ok(f.bounds.min[1]>2.0,'The lower trunk should remain visible');
    assert.ok(f.bounds.max[1]>=tree.bounds.max[1]-.8);
    assert.ok(f.bounds.max[1]<=tree.bounds.max[1]+.45,
      'Sunward shoots may soften the skyline, not form new isolated spires');
    assert.ok(f.leafCount/f.shootCount>4.1&&f.leafCount/f.shootCount<7.0,
      'Denser sprays should be concentrated into connected cushions');
    // The first supporting shoot has six rings of five vertices and
    // two center caps. The first attached blade follows it immediately.
    // Its last row must taper instead of being spread apart by twist.
    const firstLeaf=6*5+2;
    const bladeWidth=(row:number)=>{
      const a=(firstLeaf+row*3)*3,b=(firstLeaf+row*3+2)*3;
      return Math.hypot(
        f.positions[a]-f.positions[b],
        f.positions[a+1]-f.positions[b+1],
        f.positions[a+2]-f.positions[b+2]);
    };
    assert.ok(bladeWidth(26)<bladeWidth(12)*.24,
      'Leaf tips must narrow despite the three-dimensional blade twist');
    // A coarse silhouette coverage regression: foliage must occupy
    // the outer and lower crown in two perpendicular projections.
    // Sampling one of every 15 vertices keeps the test inexpensive.
    const frontal=new Set<string>(),side=new Set<string>(),
      lowerOuter=new Set<string>();
    for(let i=0;i<f.positions.length;i+=45){
      const x=f.positions[i],y=f.positions[i+1],z=f.positions[i+2];
      if(y>=3){
        frontal.add(Math.floor(x/.18)+':'+Math.floor(y/.18));
        side.add(Math.floor(z/.18)+':'+Math.floor(y/.18));
      }
      if(y>=3&&y<7.7&&Math.hypot(x,z)>1.4)
        lowerOuter.add(Math.floor(x/.22)+':'+Math.floor(y/.22));
    }
    assert.ok(frontal.size>780&&side.size>950,
      'Leaf cover must extend across the crown in both projections');
    assert.ok(lowerOuter.size>280,
      'Lower, exposed boughs should not remain conspicuously bare');
    for(let k=0;k<3;k++){
      assert.ok(f.bounds.max[k]>f.bounds.min[k]);
      assert.ok(f.bounds.min[k]>=tree.bounds.min[k]-1.00);
      assert.ok(f.bounds.max[k]<=tree.bounds.max[k]+1.00);
    }
  }
});

test('foliage is fully seeded and has clean, finite triangle surfaces',()=>{
  const wood=generateTree({seed:19641});
  const a=generateOakFoliage(wood);
  const b=generateOakFoliage(wood);
  assert.deepEqual(a.positions,b.positions);
  assert.deepEqual(a.normals,b.normals);
  assert.deepEqual(a.indices,b.indices);
  assert.deepEqual(a.colors,b.colors);
  const P=a.positions,I=a.indices,N=a.normals;
  for(let i=0;i<I.length;i+=3){
    const x=I[i]*3,y=I[i+1]*3,z=I[i+2]*3;
    const u=[0,1,2].map(k=>P[y+k]-P[x+k]);
    const v=[0,1,2].map(k=>P[z+k]-P[x+k]);
    const cross=[
      u[1]*v[2]-u[2]*v[1],
      u[2]*v[0]-u[0]*v[2],
      u[0]*v[1]-u[1]*v[0],
    ];
    assert.ok(Math.hypot(...cross)>1e-13,
      'Leaf surfaces, lateral veins and petioles must not collapse');
  }
  for(let i=0;i<N.length;i+=3){
    const magnitude=Math.hypot(N[i],N[i+1],N[i+2]);
    assert.ok(magnitude>.995&&magnitude<1.005);
  }
});

test('foliage validates its input',()=>{
  for(const bad of [null,{},[],{seed:1,branches:[]},{seed:1,branches:[],positions:[]}])
    assert.throws(()=>generateOakFoliage(bad as never));
});
