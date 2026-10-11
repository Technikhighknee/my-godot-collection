import test from 'node:test';
import assert from 'node:assert/strict';
import {oakLeafProfile} from '../tools/asset-procgen/web/oak-leaf.mjs';
import {paintOakAtlas,OAK_ATLAS_TILE,OAK_ATLAS_SIZE}
  from '../tools/asset-procgen/web/oak-atlas.mjs';
import {generateOakFoliage,OAK_CARD_TRIANGLES,OAK_ATLAS_GRID}
  from '../tools/asset-procgen/web/oak-foliage.mjs';
import {generateTree} from '../tools/asset-procgen/web/tree.mjs';

const SEEDS=[0,1,55,101,19641,4294967295];
const length=(a:number[],b:number[])=>
  Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);

test('oak leaves remain naturally lobed, variable and asymmetrical',()=>{
  const distinct=new Set<string>();
  for(const seed of SEEDS){
    const p=oakLeafProfile(seed);
    assert.ok(p.lobes>=4&&p.lobes<=6);
    assert.equal(p.outline.length,37);
    assert.equal(p.veins.length,p.lobes);
    assert.ok(p.baseEar>.2);
    assert.ok(p.outline.some(p=>Math.abs(p.left-p.right)>.005));
    distinct.add(p.outline.map(p=>p.left.toFixed(4)).join(','));
  }
  assert.equal(distinct.size,SEEDS.length);
});
test('crown lobes overlap on accepted wood, no spherical detached tufts',()=>{
  for(const seed of SEEDS){
    const wood=generateTree({seed}),backup=wood.positions.slice();
    const f=generateOakFoliage(wood);
    assert.equal(f.seed,seed);
    assert.equal(f.crownMasses.length,15);
    assert.equal(new Set(f.crownMasses.map(x=>x.supportAxisId)).size,15);
    let cursor=0;
    for(const group of f.crownMasses){
      assert.equal(group.axisCount,5);
      assert.equal(group.cushions.length,2);
      assert.equal(group.cushions[0].supportAxisId,group.supportAxisId);
      assert.equal(group.cardCount,group.cushions.reduce((n,c)=>n+c.cardCount,0));
      const [inner,outer]=group.cushions;
      assert.ok(inner.cardCount>=32&&inner.cardCount<=39);
      assert.ok(outer.cardCount>=19&&outer.cardCount<=26);
      // Explicitly guarantee one overlapping, branch-supported mass
      // rather than disconnected spheres anchored at distant tips.
      assert.ok(length(inner.center,outer.center)<
        Math.max(...inner.radii)+Math.max(...outer.radii));
      for(const c of group.cushions){
        assert.equal(c.firstCard,cursor,'Contiguous inspectable draw ranges');
        cursor+=c.cardCount;
        assert.equal(c.center.length,3);
        assert.ok(c.center.every(Number.isFinite));
        assert.ok(c.radii.every(r=>r>.45&&r<1.5));
        assert.equal(c.radii.length,3);
        assert.ok(c.radii[1]<c.radii[2],
          'Lobes must be wider than tall, not spherical balls');
      }
    }
    assert.equal(cursor,f.cardCount);
    assert.ok(f.cardCount>=800&&f.cardCount<=1000);
    assert.equal(f.indices.length/3,f.cardCount*OAK_CARD_TRIANGLES);
    assert.ok((f.indices.length+wood.indices.length)/3<13000);
    assert.deepEqual(wood.positions,backup,'Must leave established wood unchanged');
    assert.equal(f.positions.length,f.normals.length);
    assert.equal(f.positions.length,f.colors.length);
    assert.equal(f.uvs.length,f.positions.length/3*2);
    assert.equal(f.positions.length/3,f.cardCount*6);
    assert.ok(f.positions.every(Number.isFinite));
    assert.ok(f.normals.every(Number.isFinite));
    assert.ok(f.indices.every(i=>i<f.positions.length/3));
    assert.ok(f.colors.every(c=>c>=0&&c<=1));
    assert.ok(f.uvs.every(v=>v>0&&v<1));
    assert.ok(f.bounds.min[1]>2,'Trunk base must stay clear');
    assert.ok(f.bounds.max[1]<wood.bounds.max[1]+1.5);
    for(let k=0;k<3;k++){
      assert.ok(f.bounds.max[k]>f.bounds.min[k]);
      assert.ok(f.bounds.min[k]>=wood.bounds.min[k]-1.7);
      assert.ok(f.bounds.max[k]<=wood.bounds.max[k]+1.7);
    }
  }
});
test('deterministic 3D cards retain finite nondegenerate triangles and isolated UV tiles',()=>{
  const wood=generateTree({seed:19641});
  const a=generateOakFoliage(wood),b=generateOakFoliage(wood);
  for(const field of ['positions','indices','normals','colors','uvs'] as const)
    assert.deepEqual(a[field],b[field]);
  for(let i=0;i<a.normals.length;i+=3){
    const size=Math.hypot(a.normals[i],a.normals[i+1],a.normals[i+2]);
    assert.ok(size>.995&&size<1.005);
  }
  for(let i=0;i<a.indices.length;i+=3){
    const ia=a.indices[i]*3,ib=a.indices[i+1]*3,ic=a.indices[i+2]*3;
    const ab=[0,1,2].map(k=>a.positions[ib+k]-a.positions[ia+k]);
    const ac=[0,1,2].map(k=>a.positions[ic+k]-a.positions[ia+k]);
    assert.ok(Math.hypot(ab[1]*ac[2]-ab[2]*ac[1],
      ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0])>1e-7);
  }
  for(let i=0;i<a.uvs.length;i+=12){
    const us=[],vs=[];
    for(let k=i;k<i+12;k+=2){us.push(a.uvs[k]);vs.push(a.uvs[k+1]);}
    assert.ok(Math.max(...us)-Math.min(...us)<1/OAK_ATLAS_GRID);
    assert.ok(Math.max(...vs)-Math.min(...vs)<1/OAK_ATLAS_GRID);
    assert.equal(new Set(us.map(u=>Math.floor(u*OAK_ATLAS_GRID))).size,1);
    assert.equal(new Set(vs.map(v=>Math.floor(v*OAK_ATLAS_GRID))).size,1);
  }
});
// Test the sprite itself, not merely that some canvas methods were called.
// A coarse alpha-mask union estimates its visible foliage coverage.
test('the shared RGBA atlas contains dense, distinct, clipped leaf masses',()=>{
  let tile=-1,leaves=0,clips=0,strokes=0,outline=0;
  const colors=new Set<string>();
  let path:number[][]=[];
  const samples=new Uint8Array(48*48);
  const context=new Proxy({} as Record<string,unknown>,{
    get(_target,key){
      if(key==='save'||key==='restore'||key==='clearRect')return ()=>{};
      if(key==='rect')return (x:number,y:number,w:number,h:number)=>{
        const ox=(clips%OAK_ATLAS_GRID)*OAK_ATLAS_TILE;
        const oy=Math.floor(clips/OAK_ATLAS_GRID)*OAK_ATLAS_TILE;
        assert.equal(x,ox+9);assert.equal(y,oy+9);
        assert.equal(w,OAK_ATLAS_TILE-18);assert.equal(h,OAK_ATLAS_TILE-18);
      };
      if(key==='clip')return ()=>{tile++;clips++;};
      if(key==='beginPath')return ()=>{path=[];};
      if(key==='moveTo')return (x:number,y:number)=>{path=[[x,y]];};
      if(key==='lineTo')return (x:number,y:number)=>{path.push([x,y]);};
      if(key==='closePath'||key==='quadraticCurveTo')return ()=>{};
      if(key==='stroke')return ()=>{strokes++;};
      if(key==='fill')return ()=>{
        leaves++;
        if(tile!==0)return;
        // Coarse per-tile alpha coverage: polygon winding and clipping.
        for(let y=0;y<48;y++)for(let x=0;x<48;x++){
          const px=(x+.5)*OAK_ATLAS_TILE/48;
          const py=(y+.5)*OAK_ATLAS_TILE/48;
          if(px<9||px>247||py<9||py>247)continue;
          let inside=false;
          for(let k=0,j=path.length-1;k<path.length;j=k++){
            const a=path[k],b=path[j];
            if((a[1]>py)!==(b[1]>py))
              if(px<(b[0]-a[0])*(py-a[1])/(b[1]-a[1])+a[0])
                inside=!inside;
          }
          if(inside)samples[y*48+x]=1;
        }
      };
      return undefined;
    },
    set(_target,key,value){
      if(key==='fillStyle')colors.add(String(value));
      return true;
    },
  });
  const canvas={width:0,height:0,getContext:(kind:string)=>{
    assert.equal(kind,'2d');return context;
  }};
  const meta=paintOakAtlas(canvas);
  assert.equal(meta.tiles,16);
  assert.equal(clips,16);
  assert.equal(canvas.width,OAK_ATLAS_SIZE);
  assert.equal(canvas.height,OAK_ATLAS_SIZE);
  assert.equal(meta.padding,9);
  assert.ok(leaves>900&&strokes>1900);
  assert.ok(colors.size>200);
  const coverage=samples.reduce((sum,n)=>sum+n,0)/samples.length;
  assert.ok(coverage>.42&&coverage<.85,
    'One atlas sprite must be a substantial leaf mass, not isolated streaks');
  assert.throws(()=>paintOakAtlas(null as never));
  assert.throws(()=>paintOakAtlas(canvas,-1));
});
test('reject malformed oak wood',()=>{
  for(const bad of [null,{},[],{seed:1,branches:[]},
    {seed:1,branches:[],positions:[]}])
    assert.throws(()=>generateOakFoliage(bad as never));
});
