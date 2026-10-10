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

function growBranch({position,direction,length,radius,level,rng,roots,id,parentId,continuation=false}) {
  const count = [28, 16, 12, 9, 7][level];
  const sections = [];
  const phase = rng() * TAU, azimuth = rng() * TAU;
  const frame = axisFrame(direction);
  const bendAxis = add(mul(frame[0], Math.cos(azimuth)),mul(frame[1],Math.sin(azimuth)));
  const upturn = [0.025, .35, .26, .20, .13][level];
  const sideways = [0.075, .23, .31, .37, .43][level] * (rng() - .5);
  // The load-bearing shaft remains close to its starting diameter.
  // Strong taper belongs to the finer crown axes, not the base of the tree.
  const taper = [.18, .35, .59, .64, .84][level];
  let current = position, heading = unit(direction);
  for (let i=0; i<=count; i++) {
    const t = i/count;
    // Each tier preserves material at its end for a continuation axis;
    // only the final woody shoots approach zero.
    const profile = 1-taper*(.22*t+.78*t*t);
    const r = radius*profile;
    sections.push({position:current,tangent:heading,radius:r,t});
    if (i===count) break;
    const age = (i+.5)/count;
    const wave = Math.sin(phase+age*5.3) * Math.sin(Math.PI*age);
    const steer = add(
      mul(UP,upturn * (.35+.65*age)),
      mul(bendAxis,sideways + [0.02,.12,.17,.25,.24][level]*wave));
    heading = unit(add(heading,mul(steer,1.8/count)));
    current = add(current,mul(heading,length/count));
  }
  return {id,parentId,continuation,level,sections,roots:level===0?roots:[],phase,length};
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
    rng,roots,id:id++,parentId:null,
  });
  const branches=[trunk];
  const growChildren=(parent)=>{
    if(parent.level===4)return;
    const level=parent.level+1;
    const atEnd=parent.sections[parent.sections.length-1];

    // Every wooden axis continues into a slimmer growth stage. This is not
    // another lateral child: it inherits the parent's endpoint and tangent.
    const continuationLength=[0,2.5,1.9,1.25,.82][level]*
      (.85+rng()*.30);
    const continueAxis=growBranch({
      position:atEnd.position,direction:atEnd.tangent,
      length:continuationLength,radius:atEnd.radius,level,
      rng,roots:[],id:id++,parentId:parent.id,continuation:true,
    });
    branches.push(continueAxis);

    const lateralCount=level===1?4:level===2?2:level===3?2:
      (rng()<.63?1:0);
    const radialOffset=rng()*TAU;
    const children=[];
    for(let k=0;k<lateralCount;k++){
      const fraction=level===1?
        .40+.45*(k+.16+.62*rng())/lateralCount:
        .17+.62*(k+.12+.65*rng())/lateralCount;
      const anchor=sampleSection(parent,clamp(fraction,.10,.91));
      const azimuth=radialOffset+(k+(rng()-.5)*.22)*TAU/lateralCount;
      const degrees=level===1?50+rng()*14:
        level===2?47+rng()*19:level===3?37+rng()*26:30+rng()*30;
      const direction=shootDirection(
        anchor.tangent,azimuth,degrees*Math.PI/180,anchor.position,rng);
      const length=[0,3.35,2.25,1.48,.94][level]*(.8+rng()*.40);
      const scale=level===1?.47+rng()*.11:
        level===2?.49+rng()*.13:level===3?.45+rng()*.14:.41+rng()*.13;
      const child=growBranch({
        position:anchor.position,direction,length,
        radius:anchor.radius*scale,level,rng,roots:[],
        id:id++,parentId:parent.id,continuation:false,
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
