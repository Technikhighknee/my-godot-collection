import { oakLeafProfile } from './oak-leaf.mjs';

const TAU=Math.PI*2;
const COLUMNS=[-1,-.52,0,.52,1];
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
  const n=profile.outline.length;
  const sample=(t,u,raised=0)=>{
    const xIndex=t*36.24-.12;
    const i=Math.max(0,Math.min(n-2,Math.floor(xIndex)));
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
      +twist*leafLength*u*t*t;
    return add(origin,add(mul(direction,y),add(
      mul(across,u*width+bendX),mul(normal,z+raised))));
  };
  const vertexStart=output.positions.length/3;
  const vertices=[];
  for(const line of profile.outline)
    for(const u of COLUMNS)vertices.push(sample(line.t,u));
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
      const age=.88+.12*Math.sin(Math.PI*profile.outline[i].t);
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
      for(let k=0;k<=3;k++){
        const p=k/3;
        const t=clamp(target-.105*(1-p)+.016*Math.sin(p*Math.PI),.025,.97);
        const u=sign*(.02+.88*p);
        for(const offset of [-width,width]){
          const v=sample(t,clamp(u+offset,-.98,.98),.00065);
          output.positions.push(...v);
          output.normals.push(...normal);
          output.colors.push(.315+tint[0],.405+tint[1],.119+tint[2]);
        }
        if(k<3){
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
  let pos=origin;
  for(let i=1;i<=5;i++){
    const t=i/5;
    const bend=mul(side,Math.sin(t*Math.PI)*extent*(rng()-.5)*.075);
    const rise=mul([0,1,0],extent*.022*t*t);
    pos=add(origin,add(mul(direction,extent*t),add(bend,rise)));
    sections.push(pos);
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
function attachLeaf(output,site,radial,rng,angle,scale){
  const branchTangent=site.tangent;
  const horizontal=unit(cross(Math.abs(branchTangent[1])<.89?[0,1,0]:[1,0,0],branchTangent));
  const perpendicular=unit(cross(branchTangent,horizontal));
  const side=unit(add(mul(horizontal,Math.cos(angle)),mul(perpendicular,Math.sin(angle))));
  const petioleLength=.029+.022*rng();
  const petioleEnd=add(site.position,mul(side,petioleLength));
  const outward=unit(add(mul(radial,.45+.20*rng()),mul(side,.72+.13*rng())));
  const direction=unit(add(add(mul(branchTangent,.30+.26*rng()),
    mul(outward,.78)),[0,.11+.16*rng(),0]));
  let normal=sub([0,1,0],mul(direction,dot([0,1,0],direction)));
  if(Math.hypot(...normal)<.15)normal=horizontal;
  normal=unit(normal);
  const tilt=(rng()-.5)*.85;
  normal=unit(add(mul(normal,Math.cos(tilt)),mul(cross(direction,normal),Math.sin(tilt))));
  const leafSeed=Math.floor(rng()*4294967296);
  const leafLength=(.139+.091*rng())*scale;
  const hue=(rng()-.5);
  const tint=[hue*.062,(rng()-.5)*.087,(rng()-.5)*.032];
  leafBlade(output,{
    origin:petioleEnd,petioleStart:site.position,direction,normal,
    leafLength,profile:oakLeafProfile(leafSeed),
    phase:angle+(rng()-.5),tint,
  });
}
export function generateOakFoliage(wood){
  if(!wood||!Number.isInteger(wood.seed)||!Array.isArray(wood.branches)||
    !(wood.positions instanceof Float32Array))
    throw Error('Expected generated oak wood');
  const centerlines=axisCenters(wood);
  const output={positions:[],normals:[],colors:[],indices:[],veinCount:0};
  const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  let leafCount=0,branchesUsed=0,shootCount=0;
  for(const axis of wood.branches){
    if(axis.level!==3)continue;
    const sections=centerlines.get(axis.id);
    if(!sections||sections.length<2)continue;
    const rng=random((wood.seed^Math.imul(axis.id+1,0x9e3779b1))>>>0);
    const vigor=.78+.43*rng();
    const center=sections.at(-1);
    const radial=unit([center[0],0,center[2]]);
    let angle=rng()*TAU;

    // A modest number of leaves directly on the continuing axis
    // retains its alternate phyllotaxy without building a perfect comb.
    const direct=6+Math.floor(rng()*5);
    for(let j=0;j<direct;j++){
      const t=clamp(.56+(j+.25+.5*rng())*.43/direct,.52,.995);
      angle+=2.399963229728653+(rng()-.5)*.27;
      attachLeaf(output,onAxis(sections,t),radial,rng,angle,
        vigor*(.90+.17*rng()));
      leafCount++;
    }
    // Fine sprigs occupy volume around the terminal wood, rather than
    // putting all leaves along one long axis. They remain actual small
    // brown woody shoots that visibly support their petioles.
    const spurCount=4+Math.floor(rng()*3);
    for(let j=0;j<spurCount;j++){
      const t=clamp(.35+(j+.14+.63*rng())*.59/spurCount,.31,.97);
      const origin=onAxis(sections,t),tangent=origin.tangent;
      angle+=2.399963229728653+(rng()-.5)*.31;
      const side=unit(cross(Math.abs(tangent[1])<.85?[0,1,0]:[1,0,0],tangent));
      const other=unit(cross(tangent,side));
      const radialSide=unit(add(mul(side,Math.cos(angle)),mul(other,Math.sin(angle))));
      const heading=unit(add(add(mul(tangent,.43+.13*rng()),
        mul(radialSide,.86)),add(mul(radial,.26),[0,.10+.11*rng(),0])));
      const extent=(.23+.20*rng())*(.82+.29*vigor);
      const shoot=fineShoot(output,origin.position,heading,extent,rng);
      shootCount++;
      const leafNodes=6+Math.floor(rng()*5);
      const shootVigor=vigor*(.88+.24*rng());
      let leafAngle=angle+(rng()-.5)*.65;
      for(let i=0;i<leafNodes;i++){
        const location=clamp(.17+(i+.15+.67*rng())*.77/leafNodes,.15,.96);
        if(rng()<.045)continue;
        leafAngle+=2.399963229728653+(rng()-.5)*.28;
        attachLeaf(output,onAxis(shoot,location),radial,rng,leafAngle,
          shootVigor*(.87+.24*rng()));
        leafCount++;
      }
    }
    branchesUsed++;
  }
  if(!leafCount)throw Error('Oak crown contains no terminal wood');
  if(output.indices.length>4500000)throw Error('Foliage geometry budget exceeded');
  for(let i=0;i<output.positions.length;i+=3)
    for(let k=0;k<3;k++){
      bounds.min[k]=Math.min(bounds.min[k],output.positions[i+k]);
      bounds.max[k]=Math.max(bounds.max[k],output.positions[i+k]);
    }
  return {
    seed:wood.seed,leafCount,branchesUsed,shootCount,
    veinCount:output.veinCount,
    positions:Float32Array.from(output.positions),
    normals:Float32Array.from(output.normals),
    colors:Float32Array.from(output.colors),
    indices:Uint32Array.from(output.indices),bounds,
  };
}
