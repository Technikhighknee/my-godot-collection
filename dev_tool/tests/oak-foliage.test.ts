import test from 'node:test';
import assert from 'node:assert/strict';
import {oakLeafProfile} from '../tools/asset-procgen/web/oak-leaf.mjs';
import {paintOakAtlas,OAK_ATLAS_SIZE} from '../tools/asset-procgen/web/oak-atlas.mjs';
import {generateOakFoliage,OAK_CARD_TRIANGLES,OAK_ATLAS_GRID} from '../tools/asset-procgen/web/oak-foliage.mjs';
import {generateTree} from '../tools/asset-procgen/web/tree.mjs';

const SEEDS=[0,1,55,101,19641,4294967295];

test('oak leaf outlines retain rounded, asymmetric botanical lobes',()=>{
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
test('branch-supported foliage cards stay within the full-resolution triangle budget',()=>{
  for(const seed of SEEDS){
    const wood=generateTree({seed});
    const savedPositions=wood.positions.slice(),savedIndices=wood.indices.slice();
    const mesh=generateOakFoliage(wood);
    assert.equal(mesh.seed,seed);
    assert.equal(mesh.atlasGrid,OAK_ATLAS_GRID);
    assert.equal(mesh.crownMasses.length,15);
    assert.equal(new Set(mesh.crownMasses.map(g=>g.supportAxisId)).size,15);
    assert.ok(mesh.crownMasses.every(g=>g.axisCount===5&&g.cushions.length===2&&
      g.cardCount===g.cushions.reduce((n,c)=>n+c.cardCount,0)&&
      g.cushions.every(c=>c.cardCount>=30&&c.cardCount<=38&&
        c.radii.length===3&&c.radii.every(x=>x>.45&&x<1)&&
        c.center.length===3&&c.center.every(Number.isFinite)&&
        Number.isInteger(c.supportAxisId))));
    assert.equal(mesh.cardCount,mesh.crownMasses.reduce((n,g)=>n+g.cardCount,0));
    assert.ok(mesh.cardCount>=900&&mesh.cardCount<=1140);
    assert.equal(mesh.indices.length/3,mesh.cardCount*OAK_CARD_TRIANGLES);
    assert.ok((mesh.indices.length+wood.indices.length)/3<14000,
      'Detailed card foliage plus intact wood must stay below 14k triangles');
    assert.deepEqual(wood.positions,savedPositions,'Do not reshape the wood');
    assert.deepEqual(wood.indices,savedIndices,'Do not rewrite the wood indices');
    assert.equal(mesh.positions.length,mesh.normals.length);
    assert.equal(mesh.positions.length,mesh.colors.length);
    assert.equal(mesh.uvs.length,mesh.positions.length/3*2);
    assert.equal(mesh.positions.length/3,mesh.cardCount*6);
    assert.ok(mesh.indices.every(i=>i<mesh.positions.length/3));
    assert.ok(mesh.positions.every(Number.isFinite));
    assert.ok(mesh.normals.every(Number.isFinite));
    assert.ok(mesh.colors.every(v=>v>=0&&v<=1));
    assert.ok(mesh.uvs.every(v=>v>0&&v<1));
    assert.ok(mesh.bounds.min[1]>2,'Lower trunk must stay visible');
    assert.ok(mesh.bounds.max[1]<wood.bounds.max[1]+1.5);
    for(let k=0;k<3;k++){
      assert.ok(mesh.bounds.max[k]>mesh.bounds.min[k]);
      assert.ok(mesh.bounds.min[k]>=wood.bounds.min[k]-1.7);
      assert.ok(mesh.bounds.max[k]<=wood.bounds.max[k]+1.7);
    }
  }
});
test('deterministic cards have nondegenerate triangles and isolated atlas tiles',()=>{
  const wood=generateTree({seed:19641});
  const a=generateOakFoliage(wood),b=generateOakFoliage(wood);
  for(const field of ['positions','indices','normals','colors','uvs'] as const)
    assert.deepEqual(a[field],b[field]);
  for(let i=0;i<a.normals.length;i+=3){
    const magnitude=Math.hypot(a.normals[i],a.normals[i+1],a.normals[i+2]);
    assert.ok(magnitude>.995&&magnitude<1.005);
  }
  for(let i=0;i<a.indices.length;i+=3){
    const ia=a.indices[i]*3,ib=a.indices[i+1]*3,ic=a.indices[i+2]*3;
    const ab=[0,1,2].map(k=>a.positions[ib+k]-a.positions[ia+k]);
    const ac=[0,1,2].map(k=>a.positions[ic+k]-a.positions[ia+k]);
    assert.ok(Math.hypot(
      ab[1]*ac[2]-ab[2]*ac[1],
      ab[2]*ac[0]-ab[0]*ac[2],
      ab[0]*ac[1]-ab[1]*ac[0])>1e-7);
  }
  for(let i=0;i<a.uvs.length;i+=12){
    const u=[a.uvs[i],a.uvs[i+2],a.uvs[i+4],a.uvs[i+6],a.uvs[i+8],a.uvs[i+10]];
    const v=[a.uvs[i+1],a.uvs[i+3],a.uvs[i+5],a.uvs[i+7],a.uvs[i+9],a.uvs[i+11]];
    assert.ok(Math.max(...u)-Math.min(...u)<1/OAK_ATLAS_GRID);
    assert.ok(Math.max(...v)-Math.min(...v)<1/OAK_ATLAS_GRID);
    assert.equal(new Set(u.map(x=>Math.floor(x*OAK_ATLAS_GRID))).size,1);
    assert.equal(new Set(v.map(y=>Math.floor(y*OAK_ATLAS_GRID))).size,1);
  }
});
test('seeded RGBA atlas draws dense leaf sprays strictly inside tile padding',()=>{
  let tile=-1,filled=0,outlined=0;
  const paddingErrors:number[]=[];
  const context=new Proxy({} as Record<string,unknown>,{
    get(_target,key){
      if(['moveTo','lineTo','quadraticCurveTo'].includes(String(key)))
        return (...points:number[])=>{
          const ox=(tile%OAK_ATLAS_GRID)*256;
          const oy=Math.floor(tile/OAK_ATLAS_GRID)*256;
          for(let i=0;i<points.length;i+=2){
            const x=points[i]-ox,y=points[i+1]-oy;
            if(x<8||x>248||y<8||y>248)paddingErrors.push(tile);
          }
        };
      if(['beginPath','closePath','stroke','fill','clearRect'].includes(String(key)))
        return ()=>{
          if(key==='fill')filled++;
          if(key==='stroke')outlined++;
        };
      return undefined;
    },
    set(_target,key,value){
      if(key==='strokeStyle'&&value==='rgba(50,65,29,.98)')tile++;
      return true;
    },
  });
  const canvas={width:0,height:0,getContext:(type:string)=>{
    assert.equal(type,'2d');return context;
  }};
  const atlas=paintOakAtlas(canvas);
  assert.equal(tile+1,OAK_ATLAS_GRID**2);
  assert.equal(atlas.tiles,16);
  assert.equal(atlas.size,OAK_ATLAS_SIZE);
  assert.equal(canvas.width,OAK_ATLAS_SIZE);
  assert.equal(canvas.height,OAK_ATLAS_SIZE);
  assert.ok(filled>300&&outlined>500);
  assert.deepEqual(paddingErrors,[],'Sprite silhouettes must not bleed into adjacent tiles');
  assert.throws(()=>paintOakAtlas(null as never));
  assert.throws(()=>paintOakAtlas(canvas,-1));
});
test('invalid oak wood input is rejected',()=>{
  for(const bad of [null,{},[],{seed:1,branches:[]},
    {seed:1,branches:[],positions:[]}])
    assert.throws(()=>generateOakFoliage(bad as never));
});
