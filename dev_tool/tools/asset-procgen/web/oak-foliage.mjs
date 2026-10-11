// Seeded, branch-supported oak leaf-spray cards. One small shared atlas
// replaces individually triangulated leaf blades and their lateral veins.
export const OAK_ATLAS_GRID=4;
export const OAK_CARD_TRIANGLES=4;
const TAU=Math.PI*2, GOLDEN=Math.PI*(3-Math.sqrt(5));
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const length=a=>Math.hypot(...a);
const unit=a=>mul(a,1/(length(a)||1));
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const lerp=(a,b,t)=>a+(b-a)*t;
function random(seed){
  let state=seed>>>0;
  return ()=>{
    state=(state+0x6d2b79f5)>>>0;
    let x=state;
    x=Math.imul(x^(x>>>15),x|1);
    x^=x+Math.imul(x^(x>>>7),x|61);
    return ((x^(x>>>14))>>>0)/4294967296;
  };
}
// Reconstruct the woody centerlines from the already accepted mesh.
// Continuation axes share boundary rings with their parent tube.
function axisCenters(wood){
  const next=new Map(wood.branches.filter(b=>b.continuation).map(b=>[b.parentId,b]));
  const centers=new Map();
  let vertex=0;
  for(const root of wood.branches.filter(b=>!b.continuation)){
    const chain=[root],seen=new Set([root.id]);
    while(next.has(chain.at(-1).id)){
      const child=next.get(chain.at(-1).id);
      if(seen.has(child.id))throw Error('Cyclic oak wood');
      seen.add(child.id);chain.push(child);
    }
    let row=0;
    for(const axis of chain){
      const samples=[];
      for(let i=0;i<axis.rings;i++){
        const p=[0,0,0],base=(vertex+(row+i)*root.sides)*3;
        for(let j=0;j<root.sides;j++)
          for(let k=0;k<3;k++)
            p[k]+=wood.positions[base+j*3+k]/root.sides;
        samples.push(p);
      }
      centers.set(axis.id,samples);
      row+=axis.rings-1;
    }
    vertex+=(row+1)*root.sides+2;
  }
  if(vertex*3!==wood.positions.length)throw Error('Oak wood axis layout changed');
  return centers;
}
function sampleAxis(points,t){
  const x=clamp(t,0,1)*(points.length-1);
  const i=Math.min(points.length-2,Math.floor(x)),s=x-i;
  return {
    position:add(mul(points[i],1-s),mul(points[i+1],s)),
    tangent:unit(sub(points[i+1],points[i])),
  };
}
// Secondary axes produce a broad inner canopy and a smaller outer
// lobe. Both overlap and remain supported by accepted woody centerlines.
function cushionPair(parent,children,centers,seed){
  const rng=random((seed^Math.imul(parent.id+1,0x632be5ab))>>>0);
  const wood=sampleAxis(centers.get(parent.id),.80);
  const twigs=children.filter(x=>!x.continuation).map(axis=>({
    axis,p:sampleAxis(centers.get(axis.id),.76).position,
  }));
  if(twigs.length<2)throw Error('Oak cushion needs terminal support');
  const near=twigs.reduce((best,x)=>!best||
    length(sub(x.p,wood.position))<length(sub(best.p,wood.position))?x:best,null);
  const far=twigs.reduce((best,x)=>!best||
    length(sub(x.p,near.p))>length(sub(best.p,near.p))?x:best,null);
  const mix=(a,b,t)=>add(mul(a,1-t),mul(b,t));
  const rise=clamp((wood.position[1]-4.5)/5,0,1);
  const core=mix(wood.position,near.p,.43+.09*rng());
  const outer=mix(wood.position,far.p,.59+.08*rng());
  const mainRadius=1.0+.12*rise+.13*rng();
  const smallerRadius=.75+.10*rise+.13*rng();
  const common=unit([wood.position[0],0,wood.position[2]]);
  const make=(position,axisId,scale,outermost)=>({
    center:add(position,add(mul(common,(outermost?.10:.025)*rng()),
      [0,outermost?.09+.06*rng():.11+.08*rng(),0])),
    radii:[scale*(.99+.13*rng()),scale*(.75+.11*rng()),
      scale*(1.07+.15*rng())],
    tangent:wood.tangent,axisId,
    seed:Math.floor(rng()*4294967296),
    tone:(rng()-.5)*.08,outermost,
  });
  return [
    make(core,parent.id,mainRadius,false),
    make(outer,far.axis.id,smallerRadius,true),
  ];
}
function addCard(out,p,facing,width,height,variant,rng,tone){
  const axis=Math.abs(facing[1])>.96?[1,0,0]:[0,1,0];
  const right=unit(cross(axis,facing)),up=unit(cross(facing,right));
  const roll=(rng()-.5)*.62;
  const across=unit(add(mul(right,Math.cos(roll)),mul(up,Math.sin(roll))));
  const rise=unit(cross(facing,across));
  const bend=(.075+.065*rng())*width;
  const xTile=variant%OAK_ATLAS_GRID,yTile=Math.floor(variant/OAK_ATLAS_GRID);
  const u0=(xTile+.035)/OAK_ATLAS_GRID,u1=(xTile+.965)/OAK_ATLAS_GRID;
  const v0=1-(yTile+.965)/OAK_ATLAS_GRID,v1=1-(yTile+.035)/OAK_ATLAS_GRID;
  const start=out.positions.length/3;
  for(let row=0;row<2;row++)
    for(let column=0;column<3;column++){
      const x=column-1,y=row-.5;
      const point=add(p,add(add(mul(across,x*width*.5),
        mul(rise,y*height)),mul(facing,(1-x*x)*bend)));
      const normal=unit(add(facing,mul(across,-x*bend/Math.max(.5*width,.01))));
      const shade=clamp(.91+tone+(rng()-.5)*.052,.79,1.01);
      out.positions.push(...point);
      out.normals.push(...normal);
      out.uvs.push(lerp(u0,u1,column/2),lerp(v0,v1,row));
      out.colors.push(shade*.91,shade,shade*.91);
    }
  for(let column=0;column<2;column++){
    const a=start+column,b=a+1,c=a+3,d=c+1;
    out.indices.push(a,b,c,b,d,c);
  }
}
// Leaf sprays overlap heavily in an irregular volume. The outer shell
// is scalloped by the texture silhouettes, not a hard spherical mesh.
function addCushion(out,cushion,seed){
  const rng=random((seed^cushion.seed)>>>0);
  const [rx,ry,rz]=cushion.radii;
  const hor=unit([cushion.tangent[0],0,cushion.tangent[2]]);
  const along=length(hor)<.3?[1,0,0]:hor;
  const across=unit(cross([0,1,0],along));
  const phase=rng()*TAU;
  const count=(cushion.outermost?19:32)+Math.floor(rng()*8);
  for(let i=0;i<count;i++){
    const y=1-2*(i+.5)/count;
    const angle=phase+i*GOLDEN+(rng()-.5)*.35;
    const r=Math.sqrt(1-y*y);
    const x=r*Math.cos(angle),z=r*Math.sin(angle);
    const bumps=1+.11*Math.sin(3*angle+phase)+.08*Math.sin(5*angle-1.7*y+phase);
    const depth=(.42+.54*rng())*bumps;
    const p=add(cushion.center,add(
      add(mul(along,x*rx*depth),[0,y*ry*depth,0]),
      mul(across,z*rz*depth)));
    const exterior=unit(add(add(mul(along,x),[0,y*.88,0]),mul(across,z)));
    // A mix of upward, outward and crossing cards keeps the foliage
    // visible from the editor's RTS camera as well as from below.
    let facing=unit(add(mul(exterior,.70),mul([0,1,0],.30)));
    if(i%5===0)facing=unit(add(mul([0,1,0],.82),mul(exterior,.38)));
    if(i%7===0)facing=unit(add(mul(exterior,.50),
      mul(along,(i%2?1:-1)*.66)));
    facing=unit(add(facing,mul([rng()-.5,rng()-.5,rng()-.5],.26)));
    const width=(cushion.outermost?.65:.79)+rng()*(cushion.outermost?.20:.24);
    const height=(cushion.outermost?.68:.79)+rng()*(cushion.outermost?.21:.24);
    addCard(out,p,facing,width,height,
      Math.floor(rng()*OAK_ATLAS_GRID**2),rng,cushion.tone);
  }
  return count;
}
export function generateOakFoliage(wood,{seed=wood?.seed}={}){
  if(!wood||!Number.isInteger(wood.seed)||wood.seed<0||
    wood.seed>0xffffffff||!Array.isArray(wood.branches)||
    !(wood.positions instanceof Float32Array))
    throw Error('Expected generated oak wood');
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)
    throw Error('Invalid oak foliage variation seed');
  const centers=axisCenters(wood);
  const out={positions:[],normals:[],uvs:[],colors:[],indices:[]};
  const groups=[];
  let cards=0;
  for(const parent of wood.branches.filter(b=>b.level===2)){
    const children=wood.branches.filter(b=>b.parentId===parent.id&&b.level===3);
    const cushions=cushionPair(parent,children,centers,seed);
    const group={supportAxisId:parent.id,axisCount:children.length+1,
      cardCount:0,cushions:[]};
    for(const c of cushions){
      const firstCard=cards;
      const count=addCushion(out,c,seed);
      cards+=count;group.cardCount+=count;
      group.cushions.push({
        center:c.center.slice(),radii:c.radii.slice(),
        supportAxisId:c.axisId,firstCard,cardCount:count,
      });
    }
    groups.push(group);
  }
  if(!cards||cards>2000||out.indices.length/3!==cards*OAK_CARD_TRIANGLES)
    throw Error('Oak foliage geometry budget exceeded');
  // Fail before handing an invalid position buffer to Three.js.
  // An absent vector component becomes NaN during Float32Array conversion
  // and otherwise surfaces only as computeBoundingSphere() warnings.
  for(const [name,values] of Object.entries({
    positions:out.positions,normals:out.normals,
    uvs:out.uvs,colors:out.colors,
  })){
    const invalid=values.findIndex(value=>!Number.isFinite(value));
    if(invalid!==-1)
      throw Error('Non-finite oak foliage '+name+' at index '+invalid);
  }
  const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  for(let i=0;i<out.positions.length;i+=3)
    for(let k=0;k<3;k++){
      bounds.min[k]=Math.min(bounds.min[k],out.positions[i+k]);
      bounds.max[k]=Math.max(bounds.max[k],out.positions[i+k]);
    }
  return {seed,cardCount:cards,crownMasses:groups,
    atlasGrid:OAK_ATLAS_GRID,
    positions:Float32Array.from(out.positions),
    normals:Float32Array.from(out.normals),
    uvs:Float32Array.from(out.uvs),
    colors:Float32Array.from(out.colors),
    indices:Uint32Array.from(out.indices),bounds};
}
