// Seeded wood skeleton for a young fir.
// The upright leader, annual whorls and horizontally spread branchlets
// are deliberate traits of this architecture, not scaled broadleaf growth.
const TAU=Math.PI*2;
const UP=[0,1,0];
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const mix=(a,b,t)=>a+(b-a)*t;
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul=(a,n)=>[a[0]*n,a[1]*n,a[2]*n];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const length=a=>Math.hypot(...a);
const unit=a=>mul(a,1/(length(a)||1));

function random(seed){
  let state=seed>>>0;
  return ()=>{
    state+=0x6d2b79f5;
    let n=state;
    n=Math.imul(n^(n>>>15),n|1);
    n^=n+Math.imul(n^(n>>>7),n|61);
    return ((n^(n>>>14))>>>0)/4294967296;
  };
}
export const DEFAULT_FIR=Object.freeze({seed:19641});
function validSeed(settings){
  if(!settings||typeof settings!=='object'||Array.isArray(settings)||
    !Number.isInteger(settings.seed)||settings.seed<0||settings.seed>0xffffffff||
    Object.keys(settings).some(key=>key!=='seed'))
    throw Error('Invalid tree seed');
  return settings.seed;
}
function frame(tangent,previous){
  const initial=previous||cross(Math.abs(tangent[1])<.9?UP:[0,0,1],tangent);
  const side=unit(sub(initial,mul(tangent,dot(initial,tangent))));
  return {side,across:unit(cross(tangent,side))};
}
function at(axis,fraction){
  const sections=axis.sections,index=clamp(fraction,0,1)*(sections.length-1);
  const first=Math.min(sections.length-2,Math.floor(index)),t=index-first;
  const a=sections[first],b=sections[first+1];
  const tangent=unit(add(mul(a.tangent,1-t),mul(b.tangent,t)));
  return {
    position:add(a.position,mul(sub(b.position,a.position),t)),
    tangent,side:frame(tangent,add(mul(a.side,1-t),mul(b.side,t))).side,
    radius:mix(a.radius,b.radius,t),
  };
}
function leader(rng){
  const height=7.45+(rng()-.5)*.65;
  const radius=.16+(rng()-.5)*.025;
  const sections=[];
  let center=[0,0,0],heading=unit([(rng()-.5)*.026,1,(rng()-.5)*.026]);
  let crossSection=frame(heading).side,drift=[0,0];
  const count=48,step=height/count;
  for(let i=0;i<=count;i++){
    const f=i/count;
    const r=Math.max(.0015,radius*Math.pow(1-f,.88));
    crossSection=frame(heading,crossSection).side;
    sections.push({position:center,tangent:heading,side:crossSection,radius:r});
    if(i===count)break;
    drift=[
      clamp(drift[0]*.86+(rng()-.5)*.0025,-.011,.011),
      clamp(drift[1]*.86+(rng()-.5)*.0025,-.011,.011),
    ];
    heading=unit(add(heading,[drift[0]*.32,0,drift[1]*.32]));
    center=add(center,mul(heading,step));
  }
  return {id:0,parentId:null,level:0,continuation:false,length:height,sections};
}
function growAxis({id,parentId,level,start,heading,length:extent,radius,
  rng,side,upward=0,sideBias=0,tipRadius=.16}){
  const sections=[];
  const count=level===1?12:level===2?6:4;
  const step=extent/count;
  let pos=start,dir=unit(heading),transverse=frame(dir,side).side;
  let turn=0,sway=0;
  for(let i=0;i<=count;i++){
    const f=i/count;
    const radiusAt=Math.max(.00075,radius*(1-(1-tipRadius)*Math.pow(f,1.18)));
    transverse=frame(dir,transverse).side;
    sections.push({position:pos,tangent:dir,side:transverse,radius:radiusAt});
    if(i===count)break;
    // Correlated deviations and modest tip lift keep wood irregular but
    // preserve the recognizable, near-horizontal fir branch sprays.
    turn=clamp(.75*turn+.25*(rng()-.5),-.6,.6);
    sway=clamp(.75*sway+.25*(rng()-.5),-.6,.6);
    const basis=frame(dir,transverse),progress=(i+.5)/count;
    const disturbance=level===1?.018:level===2?.036:.050;
    const rise=upward*(.30+.90*progress*progress);
    const sideways=sideBias*(.4+.6*progress);
    const force=add(
      add(mul(basis.side,turn*disturbance+sideways),mul(basis.across,sway*disturbance)),
      mul(sub(UP,mul(dir,dot(dir,UP))),rise));
    dir=unit(add(dir,force));
    pos=add(pos,mul(dir,step));
  }
  return {id,parentId,level,continuation:false,length:extent,sections};
}
function buildFir(seed){
  const rng=random(seed),trunk=leader(rng),axes=[trunk];
  let nextId=1;
  const whorls=11;
  const lower=1.20+(rng()-.5)*.14;
  const crownTop=trunk.length-.58;
  const interval=(crownTop-lower)/(whorls-1);
  let phase=rng()*TAU;
  let growthBias=.0;
  for(let tier=0;tier<whorls;tier++){
    const u=tier/(whorls-1);
    // Neighboring yearly whorls do not arrive at perfectly regular
    // elevations. A little correlated annual vigor alters their spacing.
    growthBias=clamp(growthBias*.67+(rng()-.5)*.19,-.16,.16);
    const height=lower+tier*interval+growthBias;
    const n=tier<=2?5:tier<=7?4:3;
    phase+=Math.PI*(3-Math.sqrt(5))+(rng()-.5)*.28;
    const size=2.27*Math.pow(1-u,.82)+.20;
    for(let i=0;i<n;i++){
      const angle=phase+TAU*(i+(rng()-.5)*.28)/n;
      const outward=[Math.cos(angle),0,Math.sin(angle)];
      const anchor=at(trunk,clamp((height+(rng()-.5)*.25)/trunk.length,.06,.975));
      const climb=-.035+.095*u+.32*u*u+(rng()-.5)*.11;
      const heading=unit(add(mul(outward,Math.cos(climb)),mul(UP,Math.sin(climb))));
      // Local light and vigor affect individual boughs rather than
      // multiplying an entire ring by one common length.
      const extent=size*(.77+rng()*.40);
      const base=Math.min(anchor.radius*.50,.052)*(1-.22*u)*(.88+rng()*.18);
      const b=growAxis({
        id:nextId++,parentId:0,level:1,
        start:anchor.position,heading,length:extent,radius:base,
        side:anchor.side,rng,upward:(.008+.010*u),
        tipRadius:.13,
      });
      axes.push(b);

      // Fern-like branchlet fans share the horizontal plane of each
      // supporting bough, with gently raised outer tips.
      const spread=unit(cross(UP,outward));
      const lateralCount=extent>1.6?8:extent>.85?6:4;
      for(let j=0;j<lateralCount;j++){
        const fraction=.16+(j+.14+.63*rng())*.79/lateralCount;
        const point=at(b,fraction);
        const sign=j%2===0?1:-1;
        const lift=.11+.13*u+(rng()-.5)*.13;
        const heading=unit(add(
          add(mul(outward,.45+.13*rng()),mul(spread,sign*(.80+.14*rng()))),
          mul(UP,lift)));
        const reach=extent*(.40+.13*rng())*
          Math.pow(1-fraction,.69)*
          (1+.22*(rng()-.5));
        const sideBranch=growAxis({
          id:nextId++,parentId:b.id,level:2,
          start:point.position,heading,length:reach,
          radius:Math.min(point.radius*.54,.0135),
          side:point.side,rng,upward:.008,tipRadius:.11,
        });
        axes.push(sideBranch);

        // One slim terminal shoot adds depth to the fan without turning
        // the bare skeleton into an opaque mass of sticks.
        const tip=at(sideBranch,.44+.32*rng());
        const tilt=sign*(.32+.2*rng());
        const tipDir=unit(add(
          add(mul(sideBranch.sections.at(-1).tangent,.78),
            mul(outward,.24)),
          add(mul(spread,tilt),mul(UP,.10+.09*u))));
        const twig=growAxis({
          id:nextId++,parentId:sideBranch.id,level:3,
          start:tip.position,heading:tipDir,
          length:Math.max(.085,reach*(.28+.30*rng())),
          radius:Math.min(.006,tip.radius*.66),
          side:tip.side,rng,upward:.015,tipRadius:.035,
        });
        axes.push(twig);
      }
    }
  }
  return axes;
}
function meshAxis(axis,result){
  const sides=[14,9,6,4][axis.level],s=axis.sections;
  const offset=result.positions.length/3;
  for(let i=0;i<s.length;i++){
    const sec=s[i],basis=frame(sec.tangent,sec.side);
    for(let j=0;j<sides;j++){
      const theta=TAU*j/sides;
      const outward=add(mul(basis.side,Math.cos(theta)),
        mul(basis.across,-Math.sin(theta)));
      const flare=axis.level===0?
        .055*Math.exp(-Math.pow(sec.position[1]/.34,2))*
        (1+.28*Math.cos(theta*5+1.3)):0;
      const diameter=sec.radius*(1+flare);
      result.positions.push(...add(sec.position,mul(outward,diameter)));
      result.normals.push(...outward);
    }
  }
  for(let row=0;row<s.length-1;row++)
    for(let j=0;j<sides;j++){
      const a=offset+row*sides+j,b=a+sides,
        c=offset+row*sides+(j+1)%sides,d=c+sides;
      result.indices.push(a,b,c,c,b,d);
    }
  const start=result.positions.length/3;
  result.positions.push(...s[0].position);
  result.normals.push(...mul(s[0].tangent,-1));
  for(let j=0;j<sides;j++)
    result.indices.push(start,offset+j,offset+(j+1)%sides);
  const last=s.at(-1),tip=result.positions.length/3;
  result.positions.push(...add(last.position,mul(last.tangent,last.radius*.9)));
  result.normals.push(...last.tangent);
  const ring=offset+(s.length-1)*sides;
  for(let j=0;j<sides;j++)
    result.indices.push(tip,ring+(j+1)%sides,ring+j);
}
export function generateFir(settings=DEFAULT_FIR){
  const seed=validSeed(settings);
  const axes=buildFir(seed),buffer={positions:[],normals:[],indices:[]};
  for(const axis of axes)meshAxis(axis,buffer);
  if(buffer.indices.length>600000)throw Error('Geometry budget exceeded');
  const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  for(let i=0;i<buffer.positions.length;i+=3)
    for(let j=0;j<3;j++){
      bounds.min[j]=Math.min(bounds.min[j],buffer.positions[i+j]);
      bounds.max[j]=Math.max(bounds.max[j],buffer.positions[i+j]);
    }
  return {
    seed,positions:Float32Array.from(buffer.positions),
    normals:Float32Array.from(buffer.normals),
    indices:Uint32Array.from(buffer.indices),bounds,
    branches:axes.map(a=>({
      id:a.id,parentId:a.parentId,level:a.level,continuation:false,
      length:a.length,baseRadius:a.sections[0].radius,
      tipRadius:a.sections.at(-1).radius,
      from:a.sections[0].position,to:a.sections.at(-1).position,
      rings:a.sections.length,sides:[14,9,6,4][a.level],
    })),
  };
}
