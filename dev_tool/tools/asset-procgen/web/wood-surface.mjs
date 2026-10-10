// A single watertight implicit skin grown around the structural centerlines.
// Independent intersecting cylinders cannot produce clean branch junctions.
// A sparse narrow band keeps detail local to wood without voxelizing empty space.
import { clamp } from './math.mjs';
import { buildWoodPrimitives, woodDistance } from './wood-shape.mjs';

const TETS=[
  [0,5,1,6],[0,1,2,6],[0,2,3,6],
  [0,3,7,6],[0,7,4,6],[0,4,5,6]
];
const CORNERS=[
  [0,0,0],[1,0,0],[1,1,0],[0,1,0],
  [0,0,1],[1,0,1],[1,1,1],[0,1,1]
];
const key=(x,y,z)=>x+','+y+','+z;
const smoothUnion=(a,b,k)=>{
  const h=Math.max(k-Math.abs(a-b),0)/k;
  return Math.min(a,b)-h*h*k*.25;
};
const vdist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
export function meshWood(skeleton,recipe,detail='full') {
  if(!skeleton?.branches?.length)throw new Error('Missing wood skeleton');
  if(detail!=='full'&&detail!=='thumbnail')throw new Error('Unsupported mesh detail');
  const baseStep=clamp(Math.max(.052,recipe.parameters.trunkRadius*.21,recipe.parameters.height/180,recipe.parameters.crownRadius/100),.052,.24);
  const step=detail==='thumbnail'?baseStep*1.75:baseStep;
  const segments=buildWoodPrimitives(skeleton,recipe,step);
  // A snapped, six-connected interior spine prevents small branches from
  // disappearing between lattice samples and becoming detached wood islands.
  // Terminal shoots remain in the skeleton for leaves; the wood skin stops at
  // the finer branch generation rather than inflating them into thick spikes.
  const occupied=new Set(),branchSpines=new Map();
  const snap=point=>point.map(v=>Math.round(v/step));
  const occupy=(v)=>occupied.add(key(v[0],v[1],v[2]));
  function bridge(start,end,collector) {
    const at=start.slice();occupy(at);collector.push(at.slice());
    while(at[0]!==end[0]||at[1]!==end[1]||at[2]!==end[2]){
      let axis=0;
      for(let i=1;i<3;i++)
        if(Math.abs(end[i]-at[i])>Math.abs(end[axis]-at[axis]))axis=i;
      at[axis]+=Math.sign(end[axis]-at[axis]);
      occupy(at);collector.push(at.slice());
    }
  }
  for(const branch of skeleton.branches){
    if(branch.generation>3)continue;
    const nodes=[],points=branch.points;
    let previous=snap(points[0]);occupy(previous);nodes.push(previous);
    for(let i=0;i<points.length-1;i++){
      const a=points[i],b=points[i+1],dist=vdist(a,b);
      const count=Math.max(1,Math.ceil(dist/(step*.55)));
      for(let j=1;j<=count;j++){
        const t=j/count,next=snap([
          a[0]+(b[0]-a[0])*t,
          a[1]+(b[1]-a[1])*t,
          a[2]+(b[2]-a[2])*t
        ]);
        bridge(previous,next,nodes);previous=next;
      }
    }
    if(branch.parentId!==null){
      const parent=branchSpines.get(branch.parentId);
      if(!parent||!parent.length)throw new Error('Missing parent wood spine');
      const origin=snap(points[0]);
      let nearest=parent[0],distance=Infinity;
      for(const node of parent){
        const d=(node[0]-origin[0])**2+(node[1]-origin[1])**2+(node[2]-origin[2])**2;
        if(d<distance){distance=d;nearest=node;}
      }
      bridge(origin,nearest,nodes);
    }
    branchSpines.set(branch.id,nodes);
  }
  const binSize=Math.max(step*9,recipe.parameters.trunkRadius*1.6);
  const bins=new Map(),active=new Map();
  for(let j=0;j<segments.length;j++){
    const s=segments[j],r=Math.max(s.ra,s.rb);
    const margin=r+step*1.9;
    const bmin=s.min.map(v=>Math.floor((v-margin)/binSize));
    const bmax=s.max.map(v=>Math.floor((v+margin)/binSize));
    for(let x=bmin[0];x<=bmax[0];x++)
      for(let y=bmin[1];y<=bmax[1];y++)
        for(let z=bmin[2];z<=bmax[2];z++){
          const k=key(x,y,z),bucket=bins.get(k);
          if(bucket)bucket.push(j);else bins.set(k,[j]);
        }
    // Walk the real centerline. Its axis-aligned bounding box covers enormous
    // amounts of empty space on diagonal limbs; a swept narrow band does not.
    const len=Math.sqrt(s.len2),walk=Math.max(1,Math.ceil(len/(step*.8)));
    for(let k=0;k<=walk;k++){
      const u=k/walk,point=[
        s.a[0]+s.dx*u,s.a[1]+s.dy*u,s.a[2]+s.dz*u
      ];
      const margin=s.ra+(s.rb-s.ra)*u+step*2.1;
      const lo=point.map(v=>Math.floor((v-margin)/step));
      const hi=point.map(v=>Math.ceil((v+margin)/step));
      for(let x=lo[0];x<=hi[0];x++)
        for(let y=Math.max(-2,lo[1]);y<=hi[1];y++)
          for(let z=lo[2];z<=hi[2];z++){
            const dx=x*step-point[0],dy=y*step-point[1],dz=z*step-point[2];
            if(dx*dx+dy*dy+dz*dz>(margin+step*.8)**2)continue;
            const cell=key(x,y,z);
            if(!active.has(cell))active.set(cell,[x,y,z]);
          }
    }
    if(active.size>950000)throw new Error('Wood meshing exceeds spatial budget');
  }
  // Every forced interior spine sample must also be surrounded by extractable
  // cubes. A branch thinner than one grid cell can otherwise have negative
  // samples outside the rasterized narrow band and vanish between limbs.
  for(const cell of occupied){
    const [x,y,z]=cell.split(',').map(Number);
    for(let dx=-1;dx<=0;dx++)
      for(let dy=-1;dy<=0;dy++)
        for(let dz=-1;dz<=0;dz++){
          const a=[x+dx,y+dy,z+dz],k=key(...a);
          if(!active.has(k))active.set(k,a);
        }
  }
  if(active.size>950000)throw new Error('Wood meshing exceeds spatial budget');
  const sampleCache=new Map();
  function sample(x,y,z){
    const k=key(x,y,z);
    const existing=sampleCache.get(k);
    if(existing!==undefined)return existing;
    const px=x*step,py=y*step,pz=z*step;
    const bucket=bins.get(key(Math.floor(px/binSize),Math.floor(py/binSize),Math.floor(pz/binSize)));
    let d0=1e6,d1=1e6,id0=-1,id1=-1,s0=null,s1=null;
    if(bucket)for(const index of bucket){
      const s=segments[index];
      const distance=woodDistance(s,px,py,pz);
      if(s.id===id0){if(distance<d0){d0=distance;s0=s;}}
      else if(s.id===id1){if(distance<d1){d1=distance;s1=s;}}
      else if(distance<d0){d1=d0;id1=id0;s1=s0;d0=distance;id0=s.id;s0=s;}
      else if(distance<d1){d1=distance;id1=s.id;s1=s;}
    }
    let d=d0;
    if(s0&&s1&&(s0.parent===s1.id||s1.parent===s0.id)){
      const child=s0.parent===s1.id?s0:s1;
      const parent=s0.parent===s1.id?s1:s0;
      const join=Math.max(step*.9,Math.min(parent.ra,parent.rb)*.65);
      if(vdist([px,py,pz],child.root)<join*3)
        d=smoothUnion(d0,d1,join);
    }
    // A horizontal cut closes the base of the trunk at ground level.
    d=Math.max(d,-py-.012);
    if(occupied.has(k))d=Math.min(d,-step*.20);
    // Near-zero grid samples collapse several tetrahedron intersections onto
    // the same corner. Keep the sign but move such values out of that band.
    const zeroBand=step*.012;
    if(Math.abs(d)<zeroBand)d=d<0?-zeroBand:zeroBand;
    sampleCache.set(k,d);
    return d;
  }
  let positions=[],indices=[];
  const edgeCache=new Map();
  const coords=new Map();
  function corner(x,y,z){
    const k=key(x,y,z),found=coords.get(k);
    if(found)return found;
    const v={key:k,x,y,z,p:[x*step,y*step,z*step],d:sample(x,y,z)};
    coords.set(k,v);return v;
  }
  function edge(a,b){
    const id=a.key<b.key?a.key+'|'+b.key:b.key+'|'+a.key;
    const found=edgeCache.get(id);
    if(found!==undefined)return found;
    let alpha=a.d/(a.d-b.d);
    alpha=clamp(alpha,0,1);
    const idx=positions.length/3;
    positions.push(
      a.p[0]+(b.p[0]-a.p[0])*alpha,
      a.p[1]+(b.p[1]-a.p[1])*alpha,
      a.p[2]+(b.p[2]-a.p[2])*alpha
    );
    edgeCache.set(id,idx);
    return idx;
  }
  function face(a,b,c,inside,outside){
    const ax=positions[a*3],ay=positions[a*3+1],az=positions[a*3+2],
      ux=positions[b*3]-ax,uy=positions[b*3+1]-ay,uz=positions[b*3+2]-az,
      vx=positions[c*3]-ax,vy=positions[c*3+1]-ay,vz=positions[c*3+2]-az;
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
    if(nx*nx+ny*ny+nz*nz<1e-18)return;
    const dx=outside[0]-inside[0],dy=outside[1]-inside[1],dz=outside[2]-inside[2];
    if(nx*dx+ny*dy+nz*dz<0)indices.push(a,c,b);
    else indices.push(a,b,c);
  }
  let inspected=0;
  for(const [x,y,z] of active.values()){
    const v=CORNERS.map(([dx,dy,dz])=>corner(x+dx,y+dy,z+dz));
    const insideMask=v.map(p=>p.d<0);
    if(insideMask.every(Boolean)||!insideMask.some(Boolean))continue;
    inspected++;
    for(const ids of TETS){
      const yes=ids.filter(i=>v[i].d<0),no=ids.filter(i=>v[i].d>=0);
      if(!yes.length||!no.length)continue;
      const inside=[0,0,0],outside=[0,0,0];
      for(const i of yes)for(let j=0;j<3;j++)inside[j]+=v[i].p[j]/yes.length;
      for(const i of no)for(let j=0;j<3;j++)outside[j]+=v[i].p[j]/no.length;
      if(yes.length===1){
        const a=yes[0];face(edge(v[a],v[no[0]]),edge(v[a],v[no[1]]),
          edge(v[a],v[no[2]]),inside,outside);
      }else if(yes.length===3){
        const a=no[0];face(edge(v[a],v[yes[0]]),edge(v[a],v[yes[1]]),
          edge(v[a],v[yes[2]]),inside,outside);
      }else{
        const [a,b]=yes,[c,d]=no;
        const ac=edge(v[a],v[c]),ad=edge(v[a],v[d]),
          bc=edge(v[b],v[c]),bd=edge(v[b],v[d]);
        face(ac,ad,bc,inside,outside);
        face(ad,bd,bc,inside,outside);
      }
    }
  }
  if(inspected===0||indices.length===0)throw new Error('No wood surface was produced');
  // Sub-grid tips can occasionally form tiny isolated surface islands where
  // root ridges meet the ground. Retain the principal wood body, but reject
  // any significant disconnection instead of silently losing a whole limb.
  {
    const count=positions.length/3;
    const parents=new Int32Array(count);
    for(let i=0;i<count;i++)parents[i]=i;
    const find=(start)=>{
      let i=start;
      while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}
      return i;
    };
    for(let i=0;i<indices.length;i+=3){
      const a=find(indices[i]),b=find(indices[i+1]),c=find(indices[i+2]);
      parents[b]=a;parents[c]=a;
    }
    const counts=new Map();
    for(let i=0;i<indices.length;i+=3){
      const root=find(indices[i]);
      counts.set(root,(counts.get(root)??0)+1);
    }
    if(counts.size>1){
      const biggest=[...counts].sort((a,b)=>b[1]-a[1])[0];
      const lost=indices.length/3-biggest[1];
      if(lost>Math.max(100,indices.length/3*.005))
        throw new Error('Wood surface contains disconnected structural limbs');
      for(let i=0;i<count;i++)
        if(find(i)!==biggest[0] && positions[i*3+1]>step*.75)
          throw new Error('An above-ground branch became disconnected');
      const remap=new Int32Array(count).fill(-1);
      const keptPositions=[],keptIndices=[];
      for(let i=0;i<indices.length;i+=3){
        if(find(indices[i])!==biggest[0])continue;
        for(let j=0;j<3;j++){
          const old=indices[i+j];
          if(remap[old]<0){
            remap[old]=keptPositions.length/3;
            keptPositions.push(positions[old*3],positions[old*3+1],positions[old*3+2]);
          }
          keptIndices.push(remap[old]);
        }
      }
      positions=keptPositions;
      indices=keptIndices;
    }
  }
  if(indices.length/3>170000)throw new Error('Wood surface exceeds triangle budget');
  // Area-weighted smooth normals. Every face shares welded intersection
  // vertices, including faces spanning the parent/child junction.
  const normals=new Float32Array(positions.length);
  for(let i=0;i<indices.length;i+=3){
    const ia=indices[i]*3,ib=indices[i+1]*3,ic=indices[i+2]*3;
    const ux=positions[ib]-positions[ia],uy=positions[ib+1]-positions[ia+1],uz=positions[ib+2]-positions[ia+2];
    const vx=positions[ic]-positions[ia],vy=positions[ic+1]-positions[ia+1],vz=positions[ic+2]-positions[ia+2];
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
    for(const k of [ia,ib,ic]){normals[k]+=nx;normals[k+1]+=ny;normals[k+2]+=nz;}
  }
  for(let i=0;i<normals.length;i+=3){
    const length=Math.hypot(normals[i],normals[i+1],normals[i+2]);
    if(length<1e-8){normals[i]=0;normals[i+1]=1;normals[i+2]=0;continue;}
    normals[i]/=length;normals[i+1]/=length;normals[i+2]/=length;
  }
  // Resolve the handful of sharp-corner fan constraints where a small
  // triangle can disagree with averaged vertex normals at an implicit fork.
  // Triangle winding and welded topology are preserved throughout.
  for(let pass=0;pass<8;pass++){
    let conflicts=0;
    for(let i=0;i<indices.length;i+=3){
      const ia=indices[i]*3,ib=indices[i+1]*3,ic=indices[i+2]*3;
      const ux=positions[ib]-positions[ia],uy=positions[ib+1]-positions[ia+1],uz=positions[ib+2]-positions[ia+2];
      const vx=positions[ic]-positions[ia],vy=positions[ic+1]-positions[ia+1],vz=positions[ic+2]-positions[ia+2];
      const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
      const facing=nx*(normals[ia]+normals[ib]+normals[ic])+
        ny*(normals[ia+1]+normals[ib+1]+normals[ic+1])+
        nz*(normals[ia+2]+normals[ib+2]+normals[ic+2]);
      if(facing>=-1e-9)continue;
      conflicts++;
      const len=Math.hypot(nx,ny,nz);
      for(const k of [ia,ib,ic]){
        let x=normals[k]+nx/len*.58,y=normals[k+1]+ny/len*.58,z=normals[k+2]+nz/len*.58;
        const l=Math.hypot(x,y,z);
        normals[k]=x/l;normals[k+1]=y/l;normals[k+2]=z/l;
      }
    }
    if(!conflicts)break;
  }
  const colors=new Float32Array(positions.length);
  for(let i=0;i<positions.length;i+=3){
    const p=positions[i],q=positions[i+1],r=positions[i+2];
    const tone=.84+.09*Math.sin(p*6.31+r*3.93+q*.9);
    colors[i]=.32*tone;colors[i+1]=.24*tone;colors[i+2]=.165*tone;
  }
  return {positions:new Float32Array(positions),normals,colors,indices:new Uint32Array(indices)};
}
