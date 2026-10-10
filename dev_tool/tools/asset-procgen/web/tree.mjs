// Procedural wood architecture for a compact deciduous tree.
// This phase generates wood geometry only: no leaves, materials or exporters.
const TAU = Math.PI * 2;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit = a => mul(a, 1 / (Math.hypot(...a) || 1));
const UP = [0, 1, 0];

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEFAULT_TREE = Object.freeze({ seed: 19641 });

export function validateTree(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    !Number.isInteger(input.seed) || input.seed < 0 || input.seed > 0xffffffff ||
    Object.keys(input).some(key => key !== 'seed')) {
    throw Error('Invalid tree seed');
  }
  return { seed: input.seed };
}

function axisFrame(direction) {
  const reference = Math.abs(direction[1]) < .86 ? UP : [0, 0, 1];
  const u = unit(cross(reference, direction));
  return [u, unit(cross(direction, u))];
}

function sampleSection(branch, t) {
  const n = branch.sections.length - 1;
  const value = clamp(t, 0, 1) * n;
  const i = Math.min(n - 1, Math.floor(value));
  const f = value - i;
  const a = branch.sections[i], b = branch.sections[i + 1];
  return {
    position: add(a.position, mul(sub(b.position, a.position), f)),
    tangent: unit(add(mul(a.tangent, 1-f), mul(b.tangent, f))),
    radius: lerp(a.radius, b.radius, f),
  };
}

function footShape(angle, t, roots) {
  let amount = .035 * Math.exp(-Math.pow(t / .14, 1.7));
  for (const root of roots) {
    const offset = Math.atan2(Math.sin(angle-root.angle),Math.cos(angle-root.angle));
    const width = root.width * (1+t*.75);
    amount += root.strength * Math.exp(-Math.pow(t/root.height,1.45)) *
      Math.exp(-.5 * Math.pow(offset/width,2));
  }
  return amount;
}

function growBranch({position,direction,length,radius,level,rng,roots,id,parentId,
  continuation=false,attachment=null,joinedTangent=null,central=false,lowerCrown=0}) {
  const count = [28,20,15,11,8][level];
  const sections = [];
  const phase = rng()*TAU, azimuth = rng()*TAU;
  const target = unit(direction);
  const frame = axisFrame(target);
  const bendAxis = add(mul(frame[0],Math.cos(azimuth)),
    mul(frame[1],Math.sin(azimuth)));

  // A lateral shoot begins by following its parent's wood for a short
  // distance. It emerges progressively rather than forming a straight
  // cylinder that cuts across the supporting trunk.
  const initial = joinedTangent ? unit(joinedTangent) :
    attachment ? unit(add(mul(unit(attachment),.54),mul(target,.46))) : target;
  const turnout = joinedTangent ? .52 :
    level===1?.23:level===2?.20:.16;
  const sideways = [0,.17,.22,.25,.24][level]*(rng()-.5);
  const bendPhase = rng()*TAU;
  const taper = [.18,.35,.59,.64,.84][level];
  let current=position,heading=initial;

  for(let i=0;i<=count;i++){
    const t=i/count;
    const profile=1-taper*(.22*t+.78*t*t);
    sections.push({position:current,tangent:heading,radius:radius*profile,t});
    if(i===count)break;

    const age=(i+.5)/count;
    const growOut=(attachment||joinedTangent) ?
      smooth(clamp(age/turnout,0,1)):1;
    const aim=(attachment||joinedTangent)
      ? unit(add(mul(initial,1-growOut),mul(target,growOut)))
      : target;

    // Older, longer limbs spread first, then lift toward light at their
    // extremities. Short twigs retain more individual angular variation.
    const lift=level===0?.018:
      level===1?(-.12*(1-smooth(clamp(age/.52,0,1)))+
        .30*smooth(clamp((age-.42)/.58,0,1))):
      level===2?.08+.20*smooth(clamp((age-.38)/.62,0,1)):
      .12+.15*smooth(clamp((age-.35)/.65,0,1));
    const wave=Math.sin(phase+age*5.0) * Math.sin(Math.PI*age);
    const lateral=sideways+.075*Math.sin(age*4.3+bendPhase)*
      Math.sin(Math.PI*age)+[.006,.035,.058,.083,.10][level]*wave;
    const steer=add(mul(UP,lift),mul(bendAxis,lateral));
    // Subdivide the turn into changes in the local growth tangent.
    heading=unit(add(
      add(heading,mul(sub(aim,heading),joinedTangent?.34:attachment?.67:.16)),
      mul(steer,1.9/count)
    ));
    current=add(current,mul(heading,length/count));
  }
  return {id,parentId,continuation,level,sections,
    roots:level===0?roots:[],phase,length,central,lowerCrown};
}

function shootDirection(tangent, angle, tilt, origin, rng) {
  // Branches share their parent's growth orientation, but occupy distinct
  // azimuths around the parent rather than falling into a single 2D plane.
  const [u,v] = axisFrame(tangent);
  const radial=add(mul(u,Math.cos(angle)),mul(v,Math.sin(angle)));
  const initial=unit(add(mul(tangent,Math.cos(tilt)),mul(radial,Math.sin(tilt))));
  // Side branches keep their own outward direction while gradually lifting.
  const away=unit([origin[0],0,origin[2]]);
  return unit(add(initial,mul(away,.05+.09*rng())));
}

function growTree(rng) {
  const trunkLength=4.6+(rng()-.5)*.42;
  const rootRadius=.19+(rng()-.5)*.035;
  const roots=[],phase=rng()*TAU;
  // The trunk's terminal lineage changes direction within the crown.
  // Different seeds choose different crownward headings.
  const crownward=[Math.cos(phase+.72),0,Math.sin(phase+.72)];
  for(let i=0;i<5;i++)roots.push({
    angle:phase+i*TAU/5+(rng()-.5)*.22,
    strength:.035+rng()*.045,
    width:.25+rng()*.12,
    height:.18+rng()*.075,
  });
  let id=0;
  const trunk=growBranch({
    position:[0,0,0],
    direction:unit([(rng()-.5)*.08,1,(rng()-.5)*.08]),
    length:trunkLength,radius:rootRadius,level:0,
    rng,roots,id:id++,parentId:null,central:true,
  });
  const branches=[trunk];
  const trunkBaseY=trunk.sections[0].position[1];
  const trunkHeight=trunk.sections[trunk.sections.length-1].position[1]-trunkBaseY;
  // Restrict the strongest primary support to the middle/upper clear shaft.
  // Low limbs, when present, remain smaller than high supporting limbs.
  const lowLimbInfluence=height =>
    smooth(clamp((.76-height)/.20,0,1));
  const growChildren=(parent)=>{
    if(parent.level===4)return;
    const level=parent.level+1;
    const atEnd=parent.sections[parent.sections.length-1];

    // A continuation preserves its wood axis, but the crown leader is not
    // privileged to remain upright. Its later sections arc toward a seeded
    // crownward direction while secondary axes compete for canopy space.
    const primaryExtension=level===2 && !parent.continuation;
    const crownBend=[0,.20,.36,.43,.32][level];
    const heading=parent.central ?
      unit(add(atEnd.tangent,mul(crownward,crownBend))) : atEnd.tangent;
    const lengthFactor=parent.central ?
      [0,.84,.77,.82,.84][level] :
      primaryExtension ? .77*(1-.19*parent.lowerCrown) : 1;
    const continuationLength=[0,1.85,1.55,1.10,.69][level]*
      lengthFactor*(.85+rng()*.30);
    const continueAxis=growBranch({
      position:atEnd.position,direction:heading,
      joinedTangent:parent.central?atEnd.tangent:null,
      length:continuationLength,radius:atEnd.radius,level,
      rng,roots:[],id:id++,parentId:parent.id,continuation:true,
      central:parent.central,lowerCrown:parent.lowerCrown,
    });
    branches.push(continueAxis);

    // Seeded density varies per lineage. Central and exterior branches
    // have different growing space rather than repeated identical forks.
    const lateralCount=level===1?4:
      level===2?(parent.central?2:1+(rng()<.70?1:0)+(rng()<.22?1:0)):
      level===3?(parent.central?1+(rng()<.65?1:0):
        1+(rng()<.67?1:0)+(rng()<.18?1:0)):
      parent.central?(rng()<.82?1:0):
        (rng()<.67?1+(rng()<.16?1:0):0);
    const radialOffset=rng()*TAU;
    const children=[];
    for(let k=0;k<lateralCount;k++){
      const fraction=level===1?
        .57+.26*(k+.12+.58*rng())/lateralCount:
        .17+.65*(k+.10+.70*rng())/lateralCount;
      const anchor=sampleSection(parent,clamp(fraction,.10,.91));
      const height=(anchor.position[1]-trunkBaseY)/trunkHeight;
      const lowInfluence=level===1?lowLimbInfluence(height):parent.lowerCrown;
      const azimuth=radialOffset+(k+(rng()-.5)*.22)*TAU/lateralCount;
      const degrees=level===1?60+rng()*19-9*lowInfluence:
        level===2?45+rng()*26:level===3?39+rng()*30:32+rng()*33;
      const direction=shootDirection(
        anchor.tangent,azimuth,degrees*Math.PI/180,anchor.position,rng);
      // Compact primary limbs preserve a dense, rounded small-oak crown.
      // More distal branches keep their established lengths and detail.
      const length=[0,2.35,2.25,1.48,.94][level]*
        (level===1 ? (.86+rng()*.28)*(1-.24*lowInfluence) :
          (.8+rng()*.40)*(level===2?(1-.11*lowInfluence):1));
      const scale=level===1?(.47+rng()*.11)*(1-.14*lowInfluence):
        level===2?.49+rng()*.13:level===3?.45+rng()*.14:.41+rng()*.13;
      const child=growBranch({
        position:anchor.position,direction,length,attachment:anchor.tangent,
        radius:anchor.radius*scale,level,rng,roots:[],
        id:id++,parentId:parent.id,continuation:false,central:false,
        lowerCrown:lowInfluence,
      });
      branches.push(child);
      children.push(child);
    }
    // Expand the continuing axis and the lateral children independently.
    growChildren(continueAxis);
    for(const child of children)growChildren(child);
  };
  growChildren(trunk);
  return branches;
}

// Terminal continuations belong to one cambial tube. Build their mesh as
// a single longitudinal surface instead of hiding two capped cylinders at
// every change of growth level. Side shoots still emerge separately.
function woodChains(branches) {
  const continued=new Map();
  for(const branch of branches)if(branch.continuation)
    continued.set(branch.parentId,branch);
  const chains=[];
  for(const root of branches){
    if(root.continuation)continue;
    const sections=root.sections.slice();
    let terminal=root;
    while(continued.has(terminal.id)){
      terminal=continued.get(terminal.id);
      sections.push(...terminal.sections.slice(1));
    }
    chains.push({...root,sections});
  }
  return chains;
}

function emitWood(branch, output) {
  const rings=branch.sections.length;
  const sides=[14,11,8,6,5][branch.level];
  const offset=output.positions.length/3;
  let previous=axisFrame(branch.sections[0].tangent)[0];
  for(let j=0;j<rings;j++){
    const section=branch.sections[j],tangent=section.tangent;
    const u=unit(sub(previous,mul(tangent,dot(previous,tangent))));
    const v=unit(cross(u,tangent));
    previous=u;
    for(let i=0;i<sides;i++){
      const angle=i*TAU/sides;
      const radial=add(mul(u,Math.cos(angle)),mul(v,Math.sin(angle)));
      // Root features depend on physical distance from the ground, not the
      // normalized section progress of later continuation segments.
      const trunkProgress=section.position[1]/Math.max(branch.length,.001);
      const flare=branch.level===0?
        footShape(angle,Math.max(0,trunkProgress),branch.roots):0;
      const grain=branch.level===0?
        .013*Math.cos(3*angle+branch.phase+.2*trunkProgress):0;
      const r=section.radius*(1+flare+grain);
      output.positions.push(...add(section.position,mul(radial,r)));
      output.normals.push(...radial);
    }
  }
  for(let j=0;j<rings-1;j++)for(let i=0;i<sides;i++){
    const a=offset+j*sides+i,b=offset+(j+1)*sides+i;
    const next=(i+1)%sides;
    const c=offset+j*sides+next,d=offset+(j+1)*sides+next;
    output.indices.push(a,b,c,c,b,d);
  }
  const start=branch.sections[0],end=branch.sections[rings-1];
  const baseIndex=output.positions.length/3;
  output.positions.push(...start.position);
  output.normals.push(...mul(start.tangent,-1));
  for(let i=0;i<sides;i++)output.indices.push(baseIndex,offset+i,offset+(i+1)%sides);
  // The continuation at each nonterminal tier covers the parent's end;
  // the apex on fine tips follows their local growth axis.
  const apexIndex=output.positions.length/3;
  output.positions.push(...add(end.position,mul(end.tangent,Math.min(end.radius*.8,.04))));
  output.normals.push(...end.tangent);
  for(let i=0;i<sides;i++){
    output.indices.push(apexIndex,offset+(rings-1)*sides+(i+1)%sides,
      offset+(rings-1)*sides+i);
  }

}

export function generateTree(raw=DEFAULT_TREE) {
  const settings=validateTree(raw);
  const skeleton=growTree(random(settings.seed));
  const buffer={positions:[],normals:[],indices:[],branches:[]};
  for(const branch of woodChains(skeleton))emitWood(branch,buffer);
  buffer.branches=skeleton.map(branch=>({
    id:branch.id,parentId:branch.parentId,level:branch.level,
    continuation:branch.continuation,length:branch.length,
    baseRadius:branch.sections[0].radius,
    tipRadius:branch.sections[branch.sections.length-1].radius,
    from:branch.sections[0].position,
    to:branch.sections[branch.sections.length-1].position,
    rings:branch.sections.length,
    sides:[14,11,8,6,5][branch.level],
  }));
  if(buffer.indices.length>600000)throw Error('Geometry budget exceeded');
  const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  for(let i=0;i<buffer.positions.length;i+=3)for(let axis=0;axis<3;axis++){
    const v=buffer.positions[i+axis];
    bounds.min[axis]=Math.min(bounds.min[axis],v);
    bounds.max[axis]=Math.max(bounds.max[axis],v);
  }
  return {
    seed:settings.seed,
    positions:Float32Array.from(buffer.positions),
    normals:Float32Array.from(buffer.normals),
    indices:Uint32Array.from(buffer.indices),
    branches:buffer.branches,
    bounds,
  };
}
