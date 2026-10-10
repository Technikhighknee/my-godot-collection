import { clamp, randomStream, TAU } from './math.mjs';

const mag=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);

// Root buttresses are short, descending growth ridges inside the same wood
// field. They terminate against the terrain plane, not as exposed cylinders.
function rootPaths(recipe) {
  const r=recipe.parameters.trunkRadius;
  const random=randomStream(recipe.seed,1,211);
  const count=5+Math.floor(random()*3),phase=random()*TAU;
  const paths=[];
  for(let i=0;i<count;i++){
    const angle=phase+TAU*(i+(random()-.5)*.30)/count;
    const reach=(1.65+random()*.80)*r;
    const rise=(1.55+random()*.75)*r;
    const width=(.24+random()*.14)*r;
    const radial=d=>[Math.cos(angle)*d,Math.sin(angle)*d];
    const a=radial(.22*r),b=radial(.75*r),c=radial(1.42*r),d=radial(reach);
    paths.push({
      id:-i-1,parentId:1,
      points:[[a[0],rise,a[1]],[b[0],rise*.48,b[1]],
        [c[0],r*.13,c[1]],[d[0],-.08*r,d[1]]],
      radii:[width*1.14,width,width*.70,width*.16]
    });
  }
  return paths;
}

// Geometry primitives share one interface so the mesher is independent of
// whether the field is occupied by trunk, branch or ground-reaching roots.
export function buildWoodPrimitives(skeleton,recipe,step) {
  const segments=[];
  const paths=[...skeleton.branches.filter(b=>b.generation<=3),...rootPaths(recipe)];
  for(const path of paths){
    const points=path.points,radii=path.radii,root=path.id<0;
    for(let i=0;i<points.length-1;i++){
      const a=points[i],b=points[i+1],ra=Math.max(step*.32,radii[i]),
        rb=Math.max(step*.32,radii[i+1]);
      const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2];
      const len2=dx*dx+dy*dy+dz*dz;
      if(len2<1e-10)continue;
      segments.push({
        a,b,dx,dy,dz,len2,ra,rb,
        id:path.id,parent:path.parentId,root:path.points[0],
        generation:root?-1:path.generation,
        isRoot:root,
        min:[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.min(a[2],b[2])],
        max:[Math.max(a[0],b[0]),Math.max(a[1],b[1]),Math.max(a[2],b[2])]
      });
    }
  }
  return segments;
}

export function woodDistance(s,px,py,pz) {
  const apx=px-s.a[0],apy=py-s.a[1],apz=pz-s.a[2];
  const t=clamp((apx*s.dx+apy*s.dy+apz*s.dz)/s.len2,0,1);
  const ox=apx-t*s.dx,oy=apy-t*s.dy,oz=apz-t*s.dz;
  const radius=s.ra+(s.rb-s.ra)*t;
  const rootFlatten=s.isRoot?1.55:1;
  let d=Math.hypot(ox,oy*rootFlatten,oz)-radius;
  if(s.generation===0 && radius>.12) {
    // Coherent, longitudinal irregularities; the phase follows the local
    // trunk axis rather than using random noise independently per voxel.
    const theta=Math.atan2(oz,ox);
    const relief=radius*.027*(Math.cos(theta*7+py*.35)+
      .38*Math.cos(theta*13-py*.62));
    d-=relief;
  }
  return d;
}

export function rootClearance(skeleton,recipe) {
  const r=recipe.parameters.trunkRadius;
  return rootPaths(recipe).map(p=>({
    point:p.points.at(-1),
    height:mag(p.points[0],p.points.at(-1)),
    radius:r
  }));
}
