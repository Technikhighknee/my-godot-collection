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
  rng,side,bend=0,tipLift=0,sideBias=0,tipRadius=.16}){
  const sections=[];
  const count=level===1?16:level===2?7:4;
  const step=extent/count;
  let pos=start,dir=unit(heading),transverse=frame(dir,side).side;
  let turn=0,sway=0;
  for(let i=0;i<=count;i++){
    const f=i/count;
    // The supporting bough is thick at its collar and sheds diameter
    // rapidly; small twigs remain thin and taper to fine points.
    const exponent=level===1?.78:1.05;
    const radiusAt=Math.max(.00065,radius*(1-(1-tipRadius)*Math.pow(f,exponent)));
    transverse=frame(dir,transverse).side;
    sections.push({position:pos,tangent:dir,side:transverse,radius:radiusAt});
    if(i===count)break;
    turn=clamp(.82*turn+.18*(rng()-.5),-.55,.55);
    sway=clamp(.82*sway+.18*(rng()-.5),-.55,.55);
    const basis=frame(dir,transverse),progress=(i+.5)/count;
    const disturbance=level===1?.027:level===2?.031:.036;
    // A live fir limb has a quiet downward bow through its middle,
    // followed by recovered growth at the illuminated outer tip.
    // Its young upper whorls are more ascending than the older ones.
    const vertical=-bend*Math.cos(Math.PI*progress)+tipLift*progress**3;
    const force=add(
      add(mul(basis.side,turn*disturbance+sideBias),mul(basis.across,sway*disturbance)),
      mul(sub(UP,mul(dir,dot(dir,UP))),vertical));
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
  let phase=rng()*TAU,growthBias=0;
  for(let tier=0;tier<whorls;tier++){
    const u=tier/(whorls-1);
    // The architectural rhythm of a fir is real: retain the annual
    // whorls, with modest shifts in annual growth and local vigor.
    growthBias=clamp(growthBias*.67+(rng()-.5)*.15,-.13,.13);
    const height=lower+tier*interval+growthBias;
    const n=tier<=2?5:tier<=7?4:3;
    phase+=Math.PI*(3-Math.sqrt(5))+(rng()-.5)*.24;
    const size=2.18*Math.pow(1-u,.84)+.21;
    for(let i=0;i<n;i++){
      const angle=phase+TAU*(i+(rng()-.5)*.20)/n;
      const outward=[Math.cos(angle),0,Math.sin(angle)];
      const anchor=at(trunk,clamp((height+(rng()-.5)*.19)/trunk.length,.06,.975));
      const climb=.02+.07*u+.22*u*u+(rng()-.5)*.065;
      const heading=unit(add(mul(outward,Math.cos(climb)),mul(UP,Math.sin(climb))));
      const extent=size*(.82+rng()*.31);
      const base=Math.min(anchor.radius*.67,.073)*(1-.16*u)*(.90+rng()*.14);
      const b=growAxis({
        id:nextId++,parentId:0,level:1,
        // Begin inside the bark shell; the expanded butt of the bough
        // is visible at the union without a foreign-looking round cap.
        start:add(anchor.position,mul(outward,anchor.radius*.48)),
        heading,length:extent,radius:base,
        side:anchor.side,rng,bend:.066*(1-.50*u),
        tipLift:.014+.004*u,sideBias:(rng()-.5)*.007,
        tipRadius:.13,
      });
      axes.push(b);

      // A fir's flat sprays emerge in two ranks along the woody bough.
      // Each rank grows forward as well as sideways; it is not a line
      // of upright spikes. Older boughs support more lateral stations.
      const spread=unit(cross(UP,outward));
      const stations=extent>1.65?6:extent>.88?5:4;
      for(let j=0;j<stations;j++){
        const station=.15+(j+.18+.40*rng())*.79/stations;
        for(const sign of [-1,1]){
          const fraction=clamp(station+(rng()-.5)*.055,.13,.94);
          const point=at(b,fraction);
          const lift=.025+.08*u+(rng()-.5)*.055;
          const direction=unit(add(
            add(mul(outward,.53+.12*rng()),mul(spread,sign*(.82+.15*rng()))),
            mul(UP,lift)));
          const reach=extent*(.32+.075*rng())*
            Math.pow(1-fraction,.66)*(1+(rng()-.5)*.17);
          const lateral=growAxis({
            id:nextId++,parentId:b.id,level:2,
            start:point.position,heading:direction,length:reach,
            radius:Math.min(point.radius*.59,.013),
            side:point.side,rng,bend:.003,tipLift:.007,
            tipRadius:.085,
          });
          axes.push(lateral);

          // Small tertiary shoots remain within the lateral spray.
          // Alternating forks create a woody fan, not comb teeth.
          const tipCount=reach>.35?2:1;
          for(let k=0;k<tipCount;k++){
            const along=tipCount===1?.61:(k===0?.40:.69)+(rng()-.5)*.07;
            const origin=at(lateral,along);
            const lateralDir=origin.tangent;
            const side=unit(cross(UP,lateralDir));
            const turn=(k===0?-1:1)*(.34+.14*rng());
            const twigDirection=unit(add(
              add(mul(lateralDir,.88),mul(side,turn)),
              mul(UP,.025+.06*u+(rng()-.5)*.032)));
            const length=reach*(.25+.12*rng())*
              Math.pow(1-along,.27);
            const twig=growAxis({
              id:nextId++,parentId:lateral.id,level:3,
              start:origin.position,heading:twigDirection,
              length:Math.max(.052,length),
              radius:Math.min(.0054,origin.radius*.67),
              side:origin.side,rng,tipLift:.004,
              tipRadius:.035,
            });
            axes.push(twig);
          }
        }
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
