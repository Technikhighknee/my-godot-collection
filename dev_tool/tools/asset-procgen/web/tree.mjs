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
  let amount = .07 * Math.exp(-Math.pow(t / .14, 1.7));
  for (const root of roots) {
    const offset = Math.atan2(Math.sin(angle-root.angle),Math.cos(angle-root.angle));
    const width = root.width * (1+t*.75);
    amount += root.strength * Math.exp(-Math.pow(t/root.height,1.45)) *
      Math.exp(-.5 * Math.pow(offset/width,2));
  }
  return amount;
}

function growBranch({position,direction,length,radius,level,rng,roots,id,parentId}) {
  const count = [32,19,14,10,7][level];
  const sections = [];
  const phase = rng()*TAU, yaw = rng()*TAU;
  const curl = (rng()-.5)*[.06,.28,.37,.47,.5][level];
  const lift = [.012,.14,.18,.19,.13][level];
  const wander = [.025,.045,.065,.09,.085][level];
  const frame = axisFrame(direction);
  let current = position, heading = unit(direction);
  for (let i = 0; i <= count; i++) {
    const t = i/count;
    const exponent = [1.2,1.3,1.18,1.08,1.15][level];
    const terminal = level === 4 ? .06 : [.03,.035,.025,.04][level];
    const r = level === 0
      ? radius*(.014+.986*Math.pow(1-t,1.20))*(1+.025*Math.sin(t*4.5+phase)*t)
      : radius*(terminal+(1-terminal)*Math.pow(1-t,exponent));
    sections.push({position:current,tangent:heading,radius:r,t});
    if (i === count) break;
    const age = (i+.5)/count;
    const wave = Math.sin(age*5.7+phase)*Math.sin(Math.PI*age);
    const lateral = add(mul(frame[0],Math.cos(yaw)),mul(frame[1],Math.sin(yaw)));
    const steer = add(
      mul(lateral,curl*(.5+age)+wander*wave),
      mul(UP,lift*(level===0 ? 0 : .6+.4*age)));
    heading = unit(add(heading,mul(steer,3.7/count)));
    current = add(current,mul(heading,length/count));
  }
  return {id,parentId,level,sections,roots:level===0?roots:[],phase,length};
}

function shootDirection(tangent, angle, tilt, origin, level) {
  const [u,v] = axisFrame(tangent);
  const around = add(mul(u,Math.cos(angle)),mul(v,Math.sin(angle)));
  let forward = unit(add(mul(tangent,Math.cos(tilt)),mul(around,Math.sin(tilt))));
  if (level>1) {
    const outward = unit([origin[0],0,origin[2]]);
    if (Math.hypot(outward[0],outward[2])>.001) forward=unit(add(forward,mul(outward,.12)));
  }
  return forward;
}

function growTree(rng) {
  const height = 6.6+(rng()-.5)*.65;
  const radius = .56+(rng()-.5)*.09;
  const roots=[], phase = rng()*TAU;
  for (let i=0;i<5;i++) roots.push({
    angle:phase+i*TAU/5+(rng()-.5)*.25,
    strength:.09+rng()*.10,
    width:.25+rng()*.13,
    height:.13+rng()*.10,
  });
  const baseDirection = unit([(rng()-.5)*.09,1,(rng()-.5)*.09]);
  const trunk = growBranch({
    position:[0,0,0],direction:baseDirection,length:height,radius,
    level:0,rng,roots,id:0,parentId:null,
  });
  const branches=[trunk];
  let nextId=1;
  const populate=parent=>{
    if(parent.level>=4)return;
    const level=parent.level+1;
    const count=level===1?5:level===2?2+Math.floor(rng()*2)
      :level===3?2+Math.floor(rng()*2):1+Math.floor(rng()*2);
    const startingAngle=rng()*TAU;
    for(let k=0;k<count;k++){
      const fraction=parent.level===0
        ?.36+.49*(k+.15+.68*rng())/count
        :.14+.70*(k+.08+.70*rng())/count;
      const anchor=sampleSection(parent,clamp(fraction,.05,.94));
      const azimuth=startingAngle+(k+(rng()-.5)*.26)*TAU/count;
      const tilt=(level===1?52+rng()*21:level===2?38+rng()*37:37+rng()*40)*Math.PI/180;
      const direction=shootDirection(anchor.tangent,azimuth,tilt,anchor.position,level);
      const length=level===1?height*(.47+rng()*.21):
        level===2?height*(.31+rng()*.15):
        level===3?height*(.17+rng()*.11):height*(.08+rng()*.055);
      const scale=level===1?.55+rng()*.11:level===2?.49+rng()*.14:
        level===3?.43+rng()*.14:.37+rng()*.13;
      const child=growBranch({position:anchor.position,direction,length,
        radius:anchor.radius*scale,level,rng,roots:[],id:nextId++,parentId:parent.id});
      branches.push(child);
      populate(child);
    }
  };
  populate(trunk);
  return branches;
}

function emitWood(branch, output) {
  const rings=branch.sections.length;
  const sides=[13,10,8,6,5][branch.level];
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
      const flare=branch.level===0?footShape(angle,section.t,branch.roots):0;
      const grooves=branch.level<2?.02*Math.cos(3*angle+branch.phase+.2*section.t):0;
      output.positions.push(...add(section.position,mul(radial,section.radius*(1+flare+grooves))));
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
  const apexIndex=output.positions.length/3;
  output.positions.push(...add(end.position,mul(end.tangent,Math.min(end.radius*.8,.035))));
  output.normals.push(...end.tangent);
  for(let i=0;i<sides;i++){
    output.indices.push(apexIndex,offset+(rings-1)*sides+(i+1)%sides,
      offset+(rings-1)*sides+i);
  }
  output.branches.push({
    id:branch.id,parentId:branch.parentId,level:branch.level,
    length:branch.length,baseRadius:start.radius,tipRadius:end.radius,
    from:start.position,to:end.position,rings,sides,
  });
}

export function generateTree(raw=DEFAULT_TREE) {
  const settings=validateTree(raw);
  const skeleton=growTree(random(settings.seed));
  const buffer={positions:[],normals:[],indices:[],branches:[]};
  for(const branch of skeleton)emitWood(branch,buffer);
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
