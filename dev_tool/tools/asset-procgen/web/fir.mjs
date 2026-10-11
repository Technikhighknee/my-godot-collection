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

// Geometry-local variation must not advance the growth RNG. Seeds produce
// stable architecture when mesh resolution or surface detail changes.
function hashUnit(seed,id,salt){
  let h=(seed ^ Math.imul(id+1,0x9e3779b1) ^ Math.imul(salt+1,0x85ebca6b))>>>0;
  h=Math.imul(h^(h>>>16),0x7feb352d);
  h=Math.imul(h^(h>>>15),0x846ca68b);
  return ((h^(h>>>16))>>>0)/4294967296;
}

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
  const wandering=level===1?.035:level===2?.095:.125;
  for(let i=0;i<=count;i++){
    const f=i/count;
    // The supporting bough is thick at its collar and sheds diameter
    // rapidly; small twigs remain thin and taper to fine points.
    const exponent=level===1?.78:1.05;
    const radiusAt=Math.max(Math.min(.00025,radius*.18),
      radius*(1-(1-tipRadius)*Math.pow(f,exponent)));
    transverse=frame(dir,transverse).side;
    sections.push({position:pos,tangent:dir,side:transverse,radius:radiusAt});
    if(i===count)break;
    turn=clamp(.77*turn+.23*(rng()-.5),-.55,.55);
    sway=clamp(.79*sway+.21*(rng()-.5),-.55,.55);
    const basis=frame(dir,transverse),progress=(i+.5)/count;
    const disturbance=wandering;
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
      // Continuous vigor and uneven light exposure influence each
      // bough's descendants. The two sides develop differently.
      const vigor=.75+rng()*.49;
      const lightSide=(rng()-.5)*.58;
      const density=.73+rng()*.47;
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

      // Opposed lateral ranks remain recognizable, but not synchronized:
      // stations, gaps, asymmetric vigor and tip distribution differ on
      // every supporting limb. This is a branch hierarchy, not a comb.
      const spread=unit(cross(UP,outward));
      const stations=clamp(Math.round((extent>1.65?6:extent>.88?5:4)*density),3,8);
      let cursor=.13+.045*rng();
      const intervals=Array.from({length:stations},()=>.70+rng()*.65);
      const total=intervals.reduce((a,b)=>a+b,0);
      const spacing=.78/total;
      for(let j=0;j<stations;j++){
        cursor+=intervals[j]*spacing;
        const station=cursor+(rng()-.5)*.035;
        const stageVigor=clamp(vigor*(.77+.47*rng()),.52,1.42);
        const preferredSide=lightSide+(rng()-.5)*.26;
        for(const sign of [-1,1]){
          // Missing shoots interrupt the mirrored fan but preserve
          // the species' flat, forward-reaching lateral architecture.
          const sideFavor=sign*preferredSide;
          const omit=clamp(.12+(1-stageVigor)*.23-sideFavor*.20,.035,.38);
          if(rng()<omit)continue;
          const fraction=clamp(station+(rng()-.5)*.09,.10,.95);
          const point=at(b,fraction);
          const lift=.025+.075*u+(rng()-.5)*.065;
          const direction=unit(add(
            add(mul(outward,.46+.22*rng()),mul(spread,sign*(.75+.27*rng()))),
            mul(UP,lift)));
          const reach=extent*(.28+.13*rng())*
            Math.pow(1-fraction,.61)*stageVigor*
            (1+sideFavor*.32);
          const lateral=growAxis({
            id:nextId++,parentId:b.id,level:2,
            start:point.position,heading:direction,
            length:Math.max(.075,reach),
            radius:Math.min(point.radius*(.43+.21*rng()),.014),
            side:point.side,rng,bend:(rng()-.5)*.012,
            tipLift:.003+.008*rng(),sideBias:(rng()-.5)*.008,
            tipRadius:.07+.05*rng(),
          });
          axes.push(lateral);

          // Some laterals remain young and unbranched; mature ones
          // fork unevenly along several internodes.
          const branchOdds=clamp(.14+(reach-.13)*2.35*stageVigor,.20,.95);
          const tips= rng()<branchOdds
            ? (reach>.34&&rng()<.34*stageVigor?3:reach>.19&&rng()<.76?2:1)
            : 0;
          let last=.18+.10*rng();
          for(let k=0;k<tips;k++){
            const along=clamp(last+(.72-last)/(tips-k+1)*(.69+.44*rng()),.27,.89);
            last=along;
            const origin=at(lateral,along);
            const side=unit(cross(UP,origin.tangent));
            const fork=(rng()<.5?-1:1)*(.23+.34*rng());
            const twigDirection=unit(add(
              add(mul(origin.tangent,.75+.23*rng()),mul(side,fork)),
              mul(UP,.018+.07*u+(rng()-.5)*.052)));
            const twigExtent=reach*(.20+.24*rng())*
              Math.pow(1-along,.28)*(.77+.40*rng());
            axes.push(growAxis({
              id:nextId++,parentId:lateral.id,level:3,
              start:origin.position,heading:twigDirection,
              length:Math.max(.05,twigExtent),
              radius:Math.min(.0055,origin.radius*(.52+.19*rng())),
              side:origin.side,rng,tipLift:(rng()-.5)*.010,
              sideBias:(rng()-.5)*.012,
              tipRadius:.025+.025*rng(),
            }));
          }
        }
      }
    }
  }
  return axes;
}
function meshAxis(axis,result,seed){
  const sides=[18,11,6,4][axis.level],s=axis.sections;
  const offset=result.positions.length/3;
  const phase1=hashUnit(seed,axis.id,0)*TAU;
  const phase2=hashUnit(seed,axis.id,1)*TAU;
  const phase3=hashUnit(seed,axis.id,2)*TAU;
  const strength=[.075,.057,.018,.009][axis.level];
  for(let i=0;i<s.length;i++){
    const sec=s[i],basis=frame(sec.tangent,sec.side);
    const f=i/(s.length-1);
    // Gently twisting longitudinal ridges, irregular section outlines,
    // and slow changes in thickness. Geometry, not a bark texture.
    // Detail scales with the wood radius, fading on fine twigs.
    const longitudinal=.021*Math.sin(f*11.7+phase2)
      +.010*Math.sin(f*23.4+phase3);
    for(let j=0;j<sides;j++){
      const theta=TAU*j/sides;
      const outward=add(mul(basis.side,Math.cos(theta)),
        mul(basis.across,-Math.sin(theta)));
      const around=add(mul(basis.side,-Math.sin(theta)),
        mul(basis.across,-Math.cos(theta)));
      const a=theta*3+phase1+f*2.2;
      const b=theta*5+phase2-f*.85;
      const c=theta*2+phase3+f*4.0;
      const ridges=.55*Math.sin(a)+.31*Math.sin(b)+.14*Math.sin(c);
      const dridges=1.65*Math.cos(a)+1.55*Math.cos(b)+.28*Math.cos(c);
      const root=axis.level===0?
        .052*Math.exp(-Math.pow(sec.position[1]/.34,2)):0;
      const rootShape=root*(1+.24*Math.cos(theta*5+phase1));
      const rootSlope=-root*.24*5*Math.sin(theta*5+phase1);
      const ripple=strength*ridges;
      const axial=axis.level<=1?longitudinal:longitudinal*.3;
      const profile=1+rootShape+ripple+axial;
      const radius=sec.radius*profile;
      const angularSlope=(rootSlope+strength*dridges)/profile;
      result.positions.push(...add(sec.position,mul(outward,radius)));
      // Account for the local radial derivative to produce believable
      // smooth lighting across the irregular polygonal cross section.
      result.normals.push(...unit(sub(outward,mul(around,angularSlope))));
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
  for(const axis of axes)meshAxis(axis,buffer,seed);
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
      rings:a.sections.length,sides:[18,11,6,4][a.level],
    })),
  };
}
