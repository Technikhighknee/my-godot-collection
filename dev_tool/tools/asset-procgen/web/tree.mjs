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
  const tangent=unit(add(mul(a.tangent,1-f),mul(b.tangent,f)));
  const side=add(mul(a.side,1-f),mul(b.side,f));
  return {
    position:add(a.position,mul(sub(b.position,a.position),f)),
    tangent,
    side:unit(sub(side,mul(tangent,dot(side,tangent)))),
    radius:lerp(a.radius,b.radius,f),
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
  continuation=false,attachment=null,joinedTangent=null,central=false,initialSide=null}) {
  const count=[28,20,15,11,8][level];
  const taper=[.18,.43,.64,.70,.84][level];
  const target=unit(direction);
  const initial=joinedTangent?unit(joinedTangent):
    attachment?unit(add(mul(unit(attachment),.46),mul(target,.54))):target;
  const sections=[];
  let current=position,heading=initial;
  let frameU=initialSide
    ? unit(sub(initialSide,mul(initial,dot(initialSide,initial))))
    : axisFrame(initial)[0];
  const segmentLength=length/count;

  // Directional impulses persist across several increments. They model
  // uneven growth without imposing a prescribed sinusoidal centerline.
  let driftU=(rng()-.5)*.8,driftV=(rng()-.5)*.8;
  const personality=(rng()-.5)*2;
  const phase=rng()*TAU;
  const [biasU,biasV]=axisFrame(target);
  const biasDirection=unit(add(mul(biasU,Math.cos(phase)),
    mul(biasV,Math.sin(phase))));

  for(let i=0;i<=count;i++){
    const age=i/count;
    const profile=1-taper*(.22*age+.78*age*age);
    const sectionRadius=radius*profile;
    frameU=unit(sub(frameU,mul(heading,dot(frameU,heading))));
    sections.push({
      position:current,tangent:heading,side:frameU,
      radius:sectionRadius,t:age,
    });
    if(i===count)break;

    // Inherited tangent controls the beginning of a lateral shoot or a
    // continuous leader. The intended branch heading emerges gradually.
    const ageMid=(i+.5)/count;
    const turnout=joinedTangent?.38:attachment?.16:0;
    const blend=turnout?smooth(clamp(ageMid/turnout,0,1)):1;
    const desired=unit(add(mul(initial,1-blend),mul(target,blend)));

    // Disturbance grows as the wood becomes thinner. Correlated angular
    // motion produces bends and occasional reversals, never sharp kinks.
    driftU=clamp(.72*driftU+.28*(2*rng()-1),-.85,.85);
    driftV=clamp(.72*driftV+.28*(2*rng()-1),-.85,.85);
    // Parallel-transport the transverse direction; rebuilding a frame
    // from a fixed world axis can flip it mid-branch.
    const u=frameU;
    const v=unit(cross(heading,u));
    const noise=Math.min(.105,
      [.005,.034,.054,.072,.082][level]*
      Math.sqrt(.16/Math.max(sectionRadius,.008)));
    const irregular=add(mul(u,driftU),mul(v,driftV));
    const longArc=mul(biasDirection,
      personality*[.008,.030,.033,.028,.022][level]*Math.sin(Math.PI*ageMid));

    // Heavy supports are allowed to spread sideways; fine shoots respond
    // more strongly to upward growth pressure.
    const lift=[0,-.009,.007,.009,.011][level];
    const sky=clamp((.008+lift)*segmentLength/
      Math.max(sectionRadius,.009),0,.067);
    const upward=sub(UP,mul(heading,dot(UP,heading)));
    const crownTurn=(level===1?.003+.012*ageMid*ageMid:0);
    const steer=add(
      add(mul(irregular,noise),longArc),
      mul(upward,level===0?0:sky+crownTurn));
    const aimStrength=joinedTangent?.20:attachment?.60:.055;
    heading=unit(add(add(heading,mul(sub(desired,heading),aimStrength)),steer));
    current=add(current,mul(heading,segmentLength));
  }
  return {id,parentId,continuation,level,sections,
    roots:level===0?roots:[],phase,length,central};
}
function shootDirection(tangent, side, angle, tilt, origin, rng) {
  // Branches share their parent's growth orientation, but occupy distinct
  // azimuths around the parent rather than falling into a single 2D plane.
  const radial=add(mul(side,Math.cos(angle)),
    mul(unit(cross(tangent,side)),Math.sin(angle)));
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
      primaryExtension ? .79 : 1;
    const continuationLength=[0,1.85,1.55,1.10,.69][level]*
      lengthFactor*(.85+rng()*.30);
    const continueAxis=growBranch({
      position:atEnd.position,direction:heading,
      joinedTangent:parent.central?atEnd.tangent:null,
      initialSide:atEnd.side,
      length:continuationLength,radius:atEnd.radius,level,
      rng,roots:[],id:id++,parentId:parent.id,continuation:true,
      central:parent.central,
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
    // Decouple attachment height from compass direction. Distribute the
    // available azimuth sectors without tying them to height order.
    const radialOffset=rng()*TAU;
    const sectors=Array.from({length:lateralCount},(_,i)=>i);
    for(let i=sectors.length-1;i>0;i--){
      const j=Math.floor(rng()*(i+1));
      [sectors[i],sectors[j]]=[sectors[j],sectors[i]];
    }
    const children=[];
    for(let k=0;k<lateralCount;k++){
      const start=level===1?.49:level===2?.06:level===3?.12:.16;
      const jitter=level===2 && k===0 ? .10+.25*rng() : .12+.76*rng();
      const fraction=start+(k+jitter)*(.985-start)/lateralCount;
      const anchor=sampleSection(parent,clamp(fraction,.05,.985));
      const azimuth=radialOffset+
        (sectors[k]+(rng()-.5)*.65)*TAU/lateralCount;
      const degrees=level===1?54+rng()*10:
        level===2?52+rng()*12:level===3?29+rng()*10:24+rng()*13;
      const direction=shootDirection(
        anchor.tangent,anchor.side,azimuth,degrees*Math.PI/180,
        anchor.position,rng);
      // Short primary supports split early into longer, finer boughs.
      // The crown comes from their descendants, not four long arms.
      const length=[0,1.27,2.52,1.72,.88][level]*
        (level===1 ? (.88+rng()*.22) : (.84+rng()*.32));
      const scale=level===1?.73+rng()*.10:
        level===2?.53+rng()*.12:level===3?.47+rng()*.12:.42+rng()*.11;
      const child=growBranch({
        position:anchor.position,direction,length,attachment:anchor.tangent,
        initialSide:anchor.side,
        radius:anchor.radius*scale,level,rng,roots:[],
        id:id++,parentId:parent.id,continuation:false,central:false,
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
  for(let j=0;j<rings;j++){
    const section=branch.sections[j],tangent=section.tangent;
    const u=section.side;
    const v=unit(cross(u,tangent));
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
