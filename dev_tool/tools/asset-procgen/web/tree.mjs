// Seeded wood growth for a compact deciduous oak.
// Only the growth skeleton and its bare, shaded wood are generated.
const TAU=Math.PI*2;
const UP=[0,1,0];
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const lerp=(a,b,t)=>a+(b-a)*t;
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const magnitude=a=>Math.hypot(a[0],a[1],a[2]);
const unit=a=>mul(a,1/(magnitude(a)||1));

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
export const DEFAULT_TREE=Object.freeze({seed:19641});
export function validateTree(settings){
  if(!settings||typeof settings!=='object'||Array.isArray(settings)||
    !Number.isInteger(settings.seed)||settings.seed<0||settings.seed>0xffffffff||
    Object.keys(settings).some(key=>key!=='seed'))
    throw Error('Invalid tree seed');
  return {seed:settings.seed};
}

function frame(tangent,previous){
  const candidate=previous||cross(Math.abs(tangent[1])<.89?UP:[0,0,1],tangent);
  const side=unit(sub(candidate,mul(tangent,dot(candidate,tangent))));
  return {side,across:unit(cross(tangent,side))};
}
function blendSection(branch,t){
  const n=branch.sections.length-1,x=clamp(t,0,1)*n,i=Math.min(n-1,Math.floor(x)),s=x-i;
  const a=branch.sections[i],b=branch.sections[i+1];
  const tangent=unit(add(mul(a.tangent,1-s),mul(b.tangent,s)));
  const basis=frame(tangent,add(mul(a.side,1-s),mul(b.side,s)));
  return {
    position:add(a.position,mul(sub(b.position,a.position),s)),
    tangent,side:basis.side,
    radius:lerp(a.radius,b.radius,s),
  };
}
const PROFILE=Object.freeze([
  {segments:25,taper:.59,exponent:1.5,drift:.010},
  {segments:10,taper:.42,exponent:1.0,drift:.063},
  {segments:9,taper:.69,exponent:1.0,drift:.110},
  {segments:3,taper:1,exponent:1.0,drift:.070},
]);
const CHILD_COUNT=[4,2,3];
const FIRST_CHILD=[.49,.06,.12];
const CHILD_ANGLE=[58,58,32];
const CHILD_LENGTH=[1.16,2.48,1.80];

function rootRidges(rng){
  const phase=rng()*TAU;
  return Array.from({length:5},(_,i)=>({
    angle:phase+i*TAU/5+(rng()-.5)*.24,
    weight:.055+rng()*.055,
    spread:.23+rng()*.13,
  }));
}
function initialDeviation(rng,level){
  return (rng()-.5)*(level===0?.015:.085);
}
function growAxis({id,parentId,level,continuation,seededLength,radius,start,
  tangent,side,rng,roots=[]}){
  const rule=PROFILE[level];
  const sections=[];
  let origin=start,heading=unit(tangent),transverse=frame(heading,side).side;
  const stepLength=seededLength/rule.segments;
  const leanBias=initialDeviation(rng,level);
  for(let i=0;i<=rule.segments;i++){
    const t=i/rule.segments;
    const r=level===3
      ? Math.max(.0009,radius*(1-.999*t))
      : radius*(1-rule.taper*Math.pow(t,rule.exponent));
    transverse=frame(heading,transverse).side;
    sections.push({position:origin,tangent:heading,side:transverse,radius:r});
    if(i===rule.segments)break;

    // Orientation is inherited and then changed incrementally. No heading
    // is pulled back toward a preset destination during subsequent steps.
    const basis=frame(heading,transverse);
    const sensitivity=Math.sqrt(.17/Math.max(r,.006));
    const randomTurn=(rng()-.5)*2*rule.drift*sensitivity;
    const randomBend=(rng()-.5)*2*rule.drift*sensitivity;
    const drift=add(
      mul(basis.side,randomTurn+leanBias*.3),
      mul(basis.across,randomBend));
    // The youngest shoots can fan sideways; otherwise they all converge
    // upward into parallel, brush-like tips at the crown top.
    const sky=level===0?0:
      level===3?clamp(.0025/Math.max(r,.008),0,.048):
      clamp(.006/Math.max(r,.008),0,.095);
    const towardSky=sub(UP,mul(heading,dot(UP,heading)));
    heading=unit(add(add(heading,drift),mul(towardSky,sky)));
    origin=add(origin,mul(heading,stepLength));
  }
  return {id,parentId,level,continuation,sections,roots,length:seededLength};
}
function growTree(rng){
  const trunkLength=6.15+(rng()-.5)*.55;
  const trunk=growAxis({
    id:0,parentId:null,level:0,continuation:false,
    seededLength:trunkLength,radius:.19+(rng()-.5)*.035,
    start:[0,0,0],tangent:unit([(rng()-.5)*.07,1,(rng()-.5)*.07]),
    side:null,rng,roots:rootRidges(rng),
  });
  const branches=[trunk],queue=[trunk];
  let nextId=1;
  for(let head=0;head<queue.length;head++){
    const parent=queue[head];
    if(parent.level===3)continue;
    const level=parent.level+1,end=parent.sections[parent.sections.length-1];
    // The next growth order continues the same axis from its end, carrying
    // its complete frame and local radius into the next ring.
    const continuation=growAxis({
      id:nextId++,parentId:parent.id,level,continuation:true,
      seededLength:CHILD_LENGTH[level-1]*(level===1?.95:1),
      radius:end.radius,start:end.position,tangent:end.tangent,side:end.side,rng,
    });
    branches.push(continuation);
    queue.push(continuation);

    // Height strata and angular strata are sampled independently.
    const count=CHILD_COUNT[parent.level],start=FIRST_CHILD[parent.level];
    const order=Array.from({length:count},(_,i)=>i);
    for(let i=count-1;i>0;i--){
      const j=Math.floor(rng()*(i+1));
      [order[i],order[j]]=[order[j],order[i]];
    }
    const phase=rng()*TAU;
    for(let i=0;i<count;i++){
      const jitter=level===2&&i===0 ? .10+.60*rng() : .15+.70*rng();
      const location=start+(i+jitter)*(1-start)/count;
      const attachment=blendSection(parent,location);
      const azimuth=phase+(order[i]+(rng()-.5)*.66)*TAU/count;
      const basis=frame(attachment.tangent,attachment.side);
      const outward=unit(add(
        mul(basis.side,Math.cos(azimuth)),
        mul(basis.across,Math.sin(azimuth))));
      // Young tip shoots do not all follow the same narrow cone.
      const spread=parent.level===2?24:7;
      const tilt=(CHILD_ANGLE[parent.level]+(rng()-.5)*spread)*Math.PI/180;
      const direction=unit(add(
        mul(attachment.tangent,Math.cos(tilt)),
        mul(outward,Math.sin(tilt))));
      const radiusScale=[.94,.72,.78][parent.level];
      const radius=attachment.radius*radiusScale*(.92+.16*rng());
      // Suppress the repeated long, upward-pointing terminal silhouette.
      // Keep the number of shoots, but let some finish much sooner.
      const length=parent.level===2
        ? CHILD_LENGTH[2]*(rng()<.23 ? .46+.24*rng() : .76+.40*rng())
        : CHILD_LENGTH[parent.level]*(.92+.16*rng());
      const child=growAxis({
        id:nextId++,parentId:parent.id,level,continuation:false,
        seededLength:length,radius,start:attachment.position,
        tangent:direction,side:basis.side,rng,
      });
      branches.push(child);
      queue.push(child);
    }
  }
  return branches;
}
function chainsFrom(axes){
  const continuations=new Map(axes.filter(x=>x.continuation)
    .map(x=>[x.parentId,x]));
  return axes.filter(x=>!x.continuation).map(root=>{
    const sections=root.sections.slice();
    let active=root;
    while(continuations.has(active.id)){
      active=continuations.get(active.id);
      sections.push(...active.sections.slice(1));
    }
    return {...root,sections};
  });
}
function flare(angle,height,roots){
  if(height>.72)return 0;
  // A low, uneven basal swelling: broad enough to read in silhouette, but
  // not an exposed set of radial spikes.
  let amount=.075*Math.exp(-Math.pow(height/.38,1.75));
  for(const root of roots){
    const d=Math.atan2(Math.sin(angle-root.angle),Math.cos(angle-root.angle));
    amount+=root.weight*Math.exp(-.5*Math.pow(d/root.spread,2))*
      Math.exp(-Math.pow(height/.44,1.65));
  }
  return amount;
}
function meshChain(chain,output){
  const sides=[14,10,7,4][chain.level],sections=chain.sections;
  const offset=output.positions.length/3;
  for(let sectionIndex=0;sectionIndex<sections.length;sectionIndex++){
    const section=sections[sectionIndex];
    const tangent=section.tangent,basis=frame(tangent,section.side);
    const ringAcross=mul(basis.across,-1);
    for(let j=0;j<sides;j++){
      const angle=TAU*j/sides;
      const radial=add(mul(basis.side,Math.cos(angle)),mul(ringAcross,Math.sin(angle)));
      // Bury the narrowest part of a lateral attachment within its
      // supporting axis, then recover full diameter smoothly along the
      // emerging wood. This avoids an exposed blunt cylinder end.
      const collar=chain.level>0&&chain.level<3
        ? .71+.29*Math.min(1,sectionIndex/3)
        : 1;
      const irregular=chain.level===0
        ? .022*Math.sin(3*angle+section.position[1]*.42)+
          .011*Math.sin(5*angle-section.position[1]*.31)
        : 0;
      const radius=section.radius*collar*(1+irregular+
        (chain.level===0?flare(angle,section.position[1],chain.roots):0));
      output.positions.push(...add(section.position,mul(radial,radius)));
      output.normals.push(...radial);
    }
  }
  for(let ring=0;ring<sections.length-1;ring++){
    for(let j=0;j<sides;j++){
      const a=offset+ring*sides+j,c=offset+ring*sides+(j+1)%sides;
      const b=a+sides,d=c+sides;
      output.indices.push(a,b,c,c,b,d);
    }
  }
  const first=sections[0],last=sections[sections.length-1];
  const base=output.positions.length/3;
  output.positions.push(...first.position);
  output.normals.push(...mul(first.tangent,-1));
  for(let j=0;j<sides;j++)
    output.indices.push(base,offset+j,offset+(j+1)%sides);
  const tip=output.positions.length/3;
  output.positions.push(...add(last.position,mul(last.tangent,last.radius*.9)));
  output.normals.push(...last.tangent);
  const ring=offset+(sections.length-1)*sides;
  for(let j=0;j<sides;j++)
    output.indices.push(tip,ring+(j+1)%sides,ring+j);
}
export function generateTree(raw=DEFAULT_TREE){
  const {seed}=validateTree(raw);
  const axes=growTree(random(seed));
  const buffer={positions:[],normals:[],indices:[]};
  for(const chain of chainsFrom(axes))meshChain(chain,buffer);
  if(buffer.indices.length>600000)throw Error('Geometry budget exceeded');
  const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  for(let i=0;i<buffer.positions.length;i+=3){
    for(let j=0;j<3;j++){
      bounds.min[j]=Math.min(bounds.min[j],buffer.positions[i+j]);
      bounds.max[j]=Math.max(bounds.max[j],buffer.positions[i+j]);
    }
  }
  return {
    seed,positions:Float32Array.from(buffer.positions),
    normals:Float32Array.from(buffer.normals),
    indices:Uint32Array.from(buffer.indices),
    branches:axes.map(axis=>({
      id:axis.id,parentId:axis.parentId,level:axis.level,
      continuation:axis.continuation,length:axis.length,
      baseRadius:axis.sections[0].radius,tipRadius:axis.sections.at(-1).radius,
      from:axis.sections[0].position,to:axis.sections.at(-1).position,
      rings:axis.sections.length,sides:[14,10,7,4][axis.level],
    })),
    bounds,
  };
}
