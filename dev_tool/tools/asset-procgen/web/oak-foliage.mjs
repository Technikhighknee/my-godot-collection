import { oakLeafProfile } from './oak-leaf.mjs';

const TAU=Math.PI*2;
const COLUMNS=[-1,0,1];
const BLADE_ROWS=27;
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=a=>mul(a,1/(Math.hypot(...a)||1));
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const mix=(a,b,t)=>a+(b-a)*t;
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
// Reconstruct the very same woody centerlines used for the oak mesh.
// A continuation is meshed as part of its root tube: parent and child
// share the boundary ring. Leaf petioles follow the actual grown wood,
// not the straight from/to chord.
function axisCenters(tree){
  const continuation=new Map(tree.branches.filter(b=>b.continuation)
    .map(b=>[b.parentId,b]));
  const centers=new Map();
  let vertex=0;
  for(const root of tree.branches.filter(b=>!b.continuation)){
    const chain=[root];
    while(continuation.has(chain.at(-1).id))
      chain.push(continuation.get(chain.at(-1).id));
    let row=0;
    for(const axis of chain){
      const samples=[];
      for(let i=0;i<axis.rings;i++){
        const middle=[0,0,0],base=(vertex+(row+i)*root.sides)*3;
        for(let j=0;j<root.sides;j++)
          for(let k=0;k<3;k++)
            middle[k]+=tree.positions[base+j*3+k]/root.sides;
        samples.push(middle);
      }
      centers.set(axis.id,samples);
      row+=axis.rings-1;
    }
    vertex+=(row+1)*root.sides+2;
  }
  if(vertex*3!==tree.positions.length)throw Error('Oak wood axis layout changed');
  return centers;
}
function onAxis(samples,t){
  const x=clamp(t,0,1)*(samples.length-1),i=Math.min(samples.length-2,Math.floor(x));
  const s=x-i;
  const tangent=unit(sub(samples[Math.min(i+1,samples.length-1)],samples[Math.max(0,i)]));
  return {position:add(mul(samples[i],1-s),mul(samples[i+1],s)),tangent};
}
function normalOf(p0,p1,p2){
  return unit(cross(sub(p1,p0),sub(p2,p0)));
}
function leafBlade(output,leaf){
  const {origin,direction,normal,leafLength,profile,phase,tint,petioleStart}=leaf;
  const across=unit(cross(direction,normal));
  const twist=.17*Math.sin(phase*1.61);
  const bow=(.035+.030*Math.cos(phase))*leafLength;
  const curl=(.030+.035*Math.sin(phase*.91))*leafLength;
  const n=BLADE_ROWS;
  const sample=(t,u,raised=0)=>{
    const xIndex=t*36.24-.12;
    const i=Math.max(0,Math.min(profile.outline.length-2,Math.floor(xIndex)));
    const s=clamp(xIndex-i,0,1);
    const left=mix(profile.outline[i].left,profile.outline[i+1].left,s);
    const right=mix(profile.outline[i].right,profile.outline[i+1].right,s);
    const width=(u<0?left:right)*leafLength;
    const bendX=Math.sin(Math.PI*t)*leafLength*.045*Math.sin(phase*2.7);
    const y=t*leafLength;
    // The center rib is raised, margins curl and individual blades twist
    // slightly without losing their single connected lamina.
    const z=bow*Math.sin(Math.PI*t)+curl*(1-u*u)*Math.sin(Math.PI*t)
      -.16*Math.abs(width)*u*u*Math.sin(Math.PI*t)
      +twist*leafLength*u*t*Math.sin(Math.PI*t);
    return add(origin,add(mul(direction,y),add(
      mul(across,u*width+bendX),mul(normal,z+raised))));
  };
  const vertexStart=output.positions.length/3;
  const vertices=[];
  const rows=Array.from({length:n},(_,i)=>profile.outline[0].t+
    (profile.outline.at(-1).t-profile.outline[0].t)*i/(n-1));
  for(const t of rows)
    for(const u of COLUMNS)vertices.push(sample(t,u));
  for(let i=0;i<n;i++){
    for(let j=0;j<COLUMNS.length;j++){
      const a=vertices[i*COLUMNS.length+Math.max(0,j-1)];
      const b=vertices[i*COLUMNS.length+Math.min(COLUMNS.length-1,j+1)];
      const c=vertices[Math.max(0,i-1)*COLUMNS.length+j];
      const d=vertices[Math.min(n-1,i+1)*COLUMNS.length+j];
      const surfaceNormal=normalOf(a,b,d);
      const trueNormal=Math.hypot(...surfaceNormal)>.2?surfaceNormal:normalOf(b,a,c);
      const p=vertices[i*COLUMNS.length+j];
      output.positions.push(...p);
      output.normals.push(...trueNormal);
      // Center rib brighter; base and tips shade darker. One coherent
      // color family, not random unrelated greens per polygon.
      const u=COLUMNS[j],vein=Math.exp(-Math.pow(u/.24,2));
      const edge=.08*Math.abs(u);
      const age=.88+.12*Math.sin(Math.PI*rows[i]);
      const s=age*(1-edge);
      output.colors.push(
        clamp((.205+tint[0]+vein*.060)*s,0,1),
        clamp((.345+tint[1]+vein*.066)*s,0,1),
        clamp((.082+tint[2]+vein*.017)*s,0,1));
    }
  }
  for(let i=0;i<n-1;i++)
    for(let j=0;j<COLUMNS.length-1;j++){
      const a=vertexStart+i*COLUMNS.length+j,b=a+COLUMNS.length,c=a+1,d=b+1;
      output.indices.push(a,c,b,c,d,b);
    }
  // Veins end at the individual rounded lobes on each side. Each is a
  // narrow raised strip, curved forward from the midrib toward its lobe.
  for(const pair of profile.veins){
    for(const sign of [-1,1]){
      const target=sign<0?pair[0]:pair[1];
      const width=.014;
      const start=output.positions.length/3;
      for(let k=0;k<=2;k++){
        const p=k/2;
        const t=clamp(target-.105*(1-p)+.016*Math.sin(p*Math.PI),.025,.97);
        const u=sign*(.02+.88*p);
        for(const offset of [-width,width]){
          const v=sample(t,clamp(u+offset,-.98,.98),.00065);
          output.positions.push(...v);
          output.normals.push(...normal);
          output.colors.push(.315+tint[0],.405+tint[1],.119+tint[2]);
        }
        if(k<2){
          const a=start+k*2;
          // The small vein triangles are rendered double-sided.
          output.indices.push(a,a+1,a+2,a+1,a+3,a+2);
        }
      }
      output.veinCount++;
    }
  }
  // A short, slender petiole links the blade to its actual twig node.
  const stemStart=output.positions.length/3;
  const offset=mul(across,.0016);
  for(const pos of [petioleStart,origin]){
    for(const sign of [-1,1]){
      output.positions.push(...add(pos,mul(offset,sign)));
      output.normals.push(...normal);
      output.colors.push(.230+tint[0],.276+tint[1],.094+tint[2]);
    }
  }
  output.indices.push(stemStart,stemStart+1,stemStart+2,
    stemStart+1,stemStart+3,stemStart+2);
}
function fineShoot(output,origin,heading,extent,rng){
  const sections=[origin],direction=unit(heading);
  const side=unit(cross(Math.abs(direction[1])<.85?[0,1,0]:[1,0,0],direction));
  const across=unit(cross(direction,side));
  const bow=(rng()-.5)*.10;
  const lift=(rng()-.5)*.045;
  for(let i=1;i<=5;i++){
    const t=i/5;
    const bend=mul(side,Math.sin(t*Math.PI)*extent*bow);
    const rise=mul([0,1,0],extent*(.030+lift)*t*t);
    sections.push(add(origin,add(mul(direction,extent*t),add(bend,rise))));
  }
  const start=output.positions.length/3,sides=5;
  for(let i=0;i<sections.length;i++){
    const t=i/(sections.length-1);
    const radius=.0031*Math.pow(1-t,.83)+.00035;
    for(let j=0;j<sides;j++){
      const theta=TAU*j/sides,radial=add(mul(side,Math.cos(theta)),mul(across,Math.sin(theta)));
      output.positions.push(...add(sections[i],mul(radial,radius)));
      output.normals.push(...radial);
      output.colors.push(.235,.203,.135);
    }
  }
  for(let i=0;i<sections.length-1;i++)
    for(let j=0;j<sides;j++){
      const a=start+i*sides+j,b=a+sides,c=start+i*sides+(j+1)%sides,d=c+sides;
      output.indices.push(a,c,b,c,d,b);
    }
  for(const [last,sign] of [[false,-1],[true,1]]){
    const row=last?sections.length-1:0;
    const center=output.positions.length/3;
    output.positions.push(...sections[row]);
    output.normals.push(...mul(direction,sign));
    output.colors.push(.235,.203,.135);
    for(let j=0;j<sides;j++){
      const a=start+row*sides+j,b=start+row*sides+(j+1)%sides;
      if(last)output.indices.push(center,a,b);
      else output.indices.push(center,b,a);
    }
  }
  return sections;
}
function attachLeaf(output,site,radial,rng,angle,scale,tone=0){
  const branchTangent=site.tangent;
  const horizontal=unit(cross(Math.abs(branchTangent[1])<.89?[0,1,0]:[1,0,0],branchTangent));
  const perpendicular=unit(cross(branchTangent,horizontal));
  const side=unit(add(mul(horizontal,Math.cos(angle)),mul(perpendicular,Math.sin(angle))));
  const petioleLength=.031+.025*rng();
  const petioleEnd=add(site.position,mul(side,petioleLength));
  const outward=unit(add(mul(radial,.45+.20*rng()),mul(side,.72+.13*rng())));
  const direction=unit(add(add(mul(branchTangent,.30+.26*rng()),
    mul(outward,.78)),[0,.11+.16*rng(),0]));
  // Oak blades are oblique to both the sky and crown exterior; all-up
  // normals make their broad surfaces disappear at RTS camera angles.
  const facing=unit(add(add(mul([0,1,0],.46+.25*rng()),
    mul(radial,.68+.24*rng())),mul(side,(rng()-.5)*.46)));
  let normal=sub(facing,mul(direction,dot(facing,direction)));
  if(Math.hypot(...normal)<.15)normal=horizontal;
  normal=unit(normal);
  const tilt=(rng()-.5)*1.05;
  normal=unit(add(mul(normal,Math.cos(tilt)),mul(cross(direction,normal),Math.sin(tilt))));
  const leafSeed=Math.floor(rng()*4294967296);
  const leafLength=(.164+.096*rng())*scale;
  const hue=(rng()-.5);
  const tint=[hue*.062+tone*.55,(rng()-.5)*.087+tone,(rng()-.5)*.032+tone*.16];
  leafBlade(output,{
    origin:petioleEnd,petioleStart:site.position,direction,normal,
    leafLength,profile:oakLeafProfile(leafSeed),
    phase:angle+(rng()-.5),tint,
  });
}
// A local canopy field that balances light access with woody support.
// Favor connected leaf masses over isolated radial spears. The crown
// envelope is smooth, height-dependent and deliberately a soft guide.

function crownSpace(wood,centers){
  const bounds=wood.bounds;
  const center=[
    (bounds.min[0]+bounds.max[0])*.5,
    (bounds.min[2]+bounds.max[2])*.5,
  ];
  const height=bounds.max[1]-bounds.min[1];
  const bottom=bounds.min[1]+height*.34,top=bounds.max[1];
  const radius=Math.max(bounds.max[0]-bounds.min[0],
    bounds.max[2]-bounds.min[2])*.5;

  // A secondary woody axis and its terminal descendants form one
  // physically connected crown mass. Several overlapping, stretched
  // lobes follow actual wood centerlines, rather than a green sphere
  // placed at the tip or a uniform distribution throughout the tree.
  const descendants=new Map();
  for(const axis of wood.branches.filter(b=>b.level===3)){
    if(!descendants.has(axis.parentId))descendants.set(axis.parentId,[]);
    descendants.get(axis.parentId).push(axis);
  }
  const groups=[],byAxis=new Map();
  for(const parent of wood.branches.filter(b=>b.level===2)){
    const members=[parent,...(descendants.get(parent.id)||[])];
    const rng=random((wood.seed^Math.imul(parent.id+1,0x632be5ab))>>>0);
    const cores=[],centerSamples=[];
    for(const axis of members){
      const samples=centers.get(axis.id);
      if(!samples||samples.length<2)
        throw Error('Oak crown mass has no supporting wood');
      for(const [i,t] of (axis.level===2?[.49,.77,.96]:[.27,.66,.93]).entries()){
        const site=onAxis(samples,t);
        const width=(axis.level===2?.73:.64)*(.81+.35*rng())*
          (i===0?.86:i===2?1.07:1);
        // Stretch around the twig's natural direction. Varying the
        // widths and directions creates scallops and pockets between
        // lobes without disconnected leaf-ball geometry.
        cores.push({
          position:site.position,tangent:site.tangent,
          radius:width,length:width*(1.13+.40*rng()),
        });
        if(i===2)centerSamples.push(site.position);
      }
    }
    const mass={
      id:parent.id,axes:members.length,cores,
      center:[0,0,0],tone:(rng()-.5)*.075,
      leafCount:0,shootCount:0,
    };
    for(const p of centerSamples)
      for(let k=0;k<3;k++)mass.center[k]+=p[k]/centerSamples.length;
    for(const axis of members)byAxis.set(axis.id,mass);
    groups.push(mass);
  }
  if(groups.length===0)throw Error('Oak crown has no supporting masses');

  // Occupancy is still shared across masses. Within each mass the
  // growth field rewards connected sprays; between masses it prevents
  // indiscriminate infill that would erase the dark crown openings.
  const size=.8,cells=new Map();
  const cell=p=>p.map(v=>Math.floor(v/size));
  const key=(x,y,z)=>x+','+y+','+z;
  function register(point,mass){
    const [x,y,z]=cell(point),k=key(x,y,z);
    if(!cells.has(k))cells.set(k,[]);
    cells.get(k).push({point,massId:mass.id});
  }
  function nearby(p,callback){
    const [x,y,z]=cell(p);
    for(let i=x-2;i<=x+2;i++)
      for(let j=y-2;j<=y+2;j++)
        for(let k=z-2;k<=z+2;k++)
          for(const node of cells.get(key(i,j,k))||[])
            callback(node);
  }
  // Signed distance to the closest asymmetric lobe of this branch
  // family. Negative is inside the leaf mass, positive is outside.
  // It is a growth guide, never a hard mesh clipping surface.
  function closestLobe(p,mass){
    let best=null;
    for(const core of mass.cores){
      const delta=sub(p,core.position);
      const along=dot(delta,core.tangent);
      const side=Math.max(0,dot(delta,delta)-along*along);
      const distance=Math.sqrt(along*along/(core.length*core.length)+
        side/(core.radius*core.radius))-1;
      if(!best||distance<best.distance)best={distance,core};
    }
    return best;
  }
  const radial=p=>Math.hypot(p[0]-center[0],p[2]-center[1]);
  const level=p=>clamp((p[1]-bottom)/(top-bottom),0,1);
  const envelope=y=>{
    const t=clamp((y-bottom)/(top-bottom),0,1);
    return radius*(.81+.31*Math.pow(Math.sin(Math.PI*t),.8));
  };
  function conditions(p){
    const t=level(p),r=radial(p),limit=envelope(p[1]);
    return {
      upper:clamp((t-.77)/.23,0,1),
      low:clamp((.13-t)/.13,0,1),
      outer:clamp((r-limit+.22)/1,0,1),
      t,r,limit,
    };
  }
  function localSupport(site,mass){
    let support=0;
    nearby(site,node=>{
      if(node.massId!==mass.id)return;
      const p=node.point;
      const d=Math.hypot(p[0]-site[0],p[1]-site[1],p[2]-site[2]);
      if(d<1.05)support+=1-d/1.05;
    });
    return support;
  }
  function choose(site,tangent,extent,rng,order,mass){
    const from=conditions(site),r=radial(site);
    const outward=r>.001?
      [(site[0]-center[0])/r,0,(site[2]-center[1])/r]:[0,0,0];
    const side=unit(cross(Math.abs(tangent[1])<.86?[0,1,0]:[1,0,0],tangent));
    const across=unit(cross(tangent,side));
    const phase=rng()*TAU;
    let best=null;
    for(let i=0;i<11;i++){
      const phi=phase+i*TAU/11+(rng()-.5)*.21;
      const spread=unit(add(mul(side,Math.cos(phi)),mul(across,Math.sin(phi))));
      const rise=clamp(.13-from.upper*.41+from.low*.22,-.22,.24);
      const aim=unit(add(
        add(mul(tangent,.31+.15*rng()),mul(spread,.75+.17*rng())),
        add(mul(outward,.10+.25*rng()-from.outer*.48),
          [0,rise+(rng()-.5)*.18,0])));
      const middle=add(site,mul(aim,extent*.55));
      const tip=add(site,mul(aim,extent));
      const excessiveRadius=Math.max(0,radial(tip)-envelope(tip[1]));
      const excessiveTop=Math.max(0,tip[1]-(top+.09));
      const excessiveBottom=Math.max(0,(bottom-.36)-tip[1]);
      const outsideMass=Math.max(0,closestLobe(tip,mass).distance);
      const middleOutside=Math.max(0,closestLobe(middle,mass).distance);
      let closest=Infinity,crowding=0,otherMassCrowding=0;
      nearby(tip,node=>{
        const p=node.point;
        const d=Math.hypot(p[0]-tip[0],p[1]-tip[1],p[2]-tip[2]);
        if(node.massId===mass.id){
          closest=Math.min(closest,d);
          crowding+=Math.max(0,1-d/.40);
        } else {
          otherMassCrowding+=Math.max(0,1-d/.66);
        }
      });
      const isolation=closest===Infinity?.65:Math.max(0,closest-.98);
      const score=-4.2*excessiveRadius**2-7.5*excessiveTop**2-
        5*excessiveBottom**2-3.8*outsideMass**2-
        .80*middleOutside**2-.34*isolation**2-
        .28*Math.max(0,crowding-1.7)-
        .17*Math.max(0,otherMassCrowding-1.0)-
        2*Math.max(0,radial(middle)-envelope(middle[1]))**2+
        (order===2?.045:0)+rng()*.26;
      if(!best||score>best.score)best={aim,tip,score};
    }
    register(best.tip,mass);
    return best.aim;
  }
  function steerFork(site,heading,extent,mass){
    const initialTip=add(site,mul(heading,extent));
    const nearest=closestLobe(initialTip,mass);
    if(nearest.distance<=0)return heading;
    const toward=unit(sub(nearest.core.position,site));
    // Only subtly rein in a fork; it must still follow its supporting
    // branch rather than snap to an unrelated cluster center.
    const corrected=unit(add(mul(heading,1),
      mul(toward,.40*clamp(nearest.distance,0,1.25))));
    const correctedTip=add(site,mul(corrected,extent));
    return closestLobe(correctedTip,mass).distance<nearest.distance?
      corrected:heading;
  }
  return {
    groups,massFor:axis=>byAxis.get(axis.id),
    choose,conditions,localSupport,register,steerFork,
  };
}
function leafOnShoot(output,shoot,radial,rng,phase,count,scale,tone){
  const tipCluster=Math.max(2,Math.ceil(count*.64)),early=count-tipCluster;
  let angle=phase;
  let leaves=0;
  for(let j=0;j<count;j++){
    if(rng()<.045)continue;
    const t=j<early
      ?.22+(j+.17+.60*rng())*.46/early
      :.70+(j-early+.12+.56*rng())*.29/tipCluster;
    angle+=2.399963229728653+(rng()-.5)*.41;
    attachLeaf(output,onAxis(shoot,clamp(t,.09,.995)),radial,rng,angle,
      scale*(.86+.21*rng()),tone);
    leaves++;
  }
  return leaves;
}
export function generateOakFoliage(wood){
  if(!wood||!Number.isInteger(wood.seed)||!Array.isArray(wood.branches)||
    !(wood.positions instanceof Float32Array))
    throw Error('Expected generated oak wood');
  const centers=axisCenters(wood);
  const output={positions:[],normals:[],colors:[],indices:[],veinCount:0};
  const crown=crownSpace(wood,centers);
  let leafCount=0,branchesUsed=0,shootCount=0;
  const axes=wood.branches.filter(axis=>axis.level===2||axis.level===3)
    .sort((a,b)=>a.level-b.level||a.id-b.id);
  for(const axis of axes){
    const base=centers.get(axis.id);
    if(!base||base.length<2)continue;
    const mass=crown.massFor(axis);
    if(!mass)throw Error('Oak foliage axis has no crown mass');
    const leavesBefore=leafCount,shootsBefore=shootCount;
    const rng=random((wood.seed^Math.imul(axis.id+1,0x9e3779b1) ^
      Math.imul(axis.level+1,0x85ebca6b))>>>0);
    const upper=base.at(-1);
    const localRadial=[upper[0]-mass.center[0],0,upper[2]-mass.center[2]];
    const radial=unit(Math.hypot(...localRadial)>.18?
      localRadial:[upper[0],0,upper[2]]);
    const status=crown.conditions(upper),level=axis.level;
    // Older side branches support fuller inner foliage. Weak skyline
    // whips and protruding lower shoots get less distal spread, not
    // more foliage merely because an open pocket exists.
    const density=1-.17*status.upper-.04*status.low*status.outer;
    const vigor=(.76+.47*rng())*density;
    const sparse=crown.localSupport(upper,mass)<1.3;
    const infill=level===3&&status.outer<.72&&
      status.t>.20&&status.t<.86&&sparse&&rng()<.70;
    const fans=(level===2?3:3)+Math.floor(rng()*3)+(infill?1:0);
    const internodes=Array.from({length:fans},()=>.64+.74*rng());
    const total=internodes.reduce((sum,v)=>sum+v,0);
    let current=level===2?.49:.19,phase=rng()*TAU;
    // A little leaf cover belongs on the outermost established wood;
    // most foliage belongs to the connected sprays grown below.
    if(level===3){
      const direct=2+Math.floor(rng()*3);
      for(let k=0;k<direct;k++){
        phase+=2.399963229728653+(rng()-.5)*.25;
        const t=.72+(k+.20+.50*rng())*.275/direct;
        attachLeaf(output,onAxis(base,t),radial,rng,phase,vigor,mass.tone);
        leafCount++;
      }
    }
    for(let j=0;j<fans;j++){
      current+=internodes[j]/total*(level===2?.43:.76);
      const bud=onAxis(base,clamp(current+(rng()-.5)*.055,.18,.985));
      phase+=2.399963229728653+(rng()-.5)*.31;
      const extension=((level===2?.45:.36)+rng()*(level===2?.26:.25))*
        (1-.22*status.upper-.18*status.outer);
      const heading=crown.choose(bud.position,bud.tangent,extension,rng,level,mass);
      const main=fineShoot(output,bud.position,heading,extension,rng);
      shootCount++;
      const familyVigor=vigor*(.79+.45*rng());
      leafCount+=leafOnShoot(output,main,radial,rng,phase,
        3+Math.floor(rng()*3),familyVigor,mass.tone);
      // Families branch in space: supporting stems split into several
      // thinner sprays with variable angles, vigor and terminal leaves.
      // The forks are genuine wood meshes, not free-floating leaf balls.
      const forks=1+Math.floor(rng()*3);
      let branchAngle=phase+.35;
      for(let k=0;k<forks;k++){
        const split=clamp(.36+(k+.2+.42*rng())*.48/forks,.29,.84);
        const point=onAxis(main,split);
        const forward=point.tangent;
        const outward=unit([point.position[0],0,point.position[2]]);
        const sideways=unit(cross(Math.abs(forward[1])<.85?[0,1,0]:[1,0,0],forward));
        const across=unit(cross(forward,sideways));
        branchAngle+=2.399963229728653+(rng()-.5)*.43;
        const turn=add(mul(sideways,Math.cos(branchAngle)),
          mul(across,Math.sin(branchAngle)));
        const crowd=crown.conditions(point.position);
        const inward=crowd.outer*.33;
        const forkHeading=unit(add(add(mul(forward,.44+.19*rng()),
          mul(turn,.68+.22*rng())),
          add(mul(outward,.17-inward),[0,.04-.20*crowd.upper+.14*crowd.low,0])));
        const forkLength=extension*(.42+.25*rng());
        const child=fineShoot(output,point.position,
          crown.steerFork(point.position,forkHeading,forkLength,mass),forkLength,rng);
        crown.register(child.at(-1),mass);
        shootCount++;
        leafCount+=leafOnShoot(output,child,radial,rng,branchAngle,
          4+Math.floor(rng()*4),familyVigor*(.88+.22*rng()),mass.tone);
      }
    }
    branchesUsed++;
    mass.leafCount+=leafCount-leavesBefore;
    mass.shootCount+=shootCount-shootsBefore;
  }
  if(!leafCount)throw Error('Oak crown contains no leaf-bearing wood');
  if(output.indices.length>3300000)throw Error('Foliage geometry budget exceeded');
  const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  for(let i=0;i<output.positions.length;i+=3)
    for(let k=0;k<3;k++){
      bounds.min[k]=Math.min(bounds.min[k],output.positions[i+k]);
      bounds.max[k]=Math.max(bounds.max[k],output.positions[i+k]);
    }
  return {
    seed:wood.seed,leafCount,branchesUsed,shootCount,
    crownMasses:crown.groups.map(mass=>({
      supportAxisId:mass.id,axisCount:mass.axes,
      center:mass.center.slice(),leafCount:mass.leafCount,
      shootCount:mass.shootCount,
    })),
    veinCount:output.veinCount,
    positions:Float32Array.from(output.positions),
    normals:Float32Array.from(output.normals),
    colors:Float32Array.from(output.colors),
    indices:Uint32Array.from(output.indices),bounds,
  };
}
