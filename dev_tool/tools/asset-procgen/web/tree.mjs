// Pure, seeded geometry. No browser, renderer, clock or global randomness dependencies.
export const RECIPE_SCHEMA = '1400.asset.recipe.v1';
export const GENERATOR = 'tree.oak.v2';
export const GENERATOR_REVISION = 2;
export const DEFAULT_RECIPE = Object.freeze({
  schema: RECIPE_SCHEMA, generator: GENERATOR, revision: GENERATOR_REVISION, name: 'Oak 01', seed: 147241,
  parameters: { height: 12, crownRadius: 4.4, trunkRadius: 0.43, branchDensity: 0.7, leafDensity: 0.84, asymmetry: 0.62 }
});
const ranges = Object.freeze({
  height: [3, 24], crownRadius: [1, 11], trunkRadius: [0.12, 1.1],
  branchDensity: [0.2, 1], leafDensity: [0.15, 1], asymmetry: [0, 1]
});
const vadd = (a,b) => [a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const vsub = (a,b) => [a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const vmul = (a,s) => [a[0]*s,a[1]*s,a[2]*s];
const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm = a => { const d=Math.hypot(...a); return d>1e-8 ? vmul(a,1/d) : [0,1,0]; };
const lerp = (a,b,t) => a+(b-a)*t;
const clamp = (v,a,b) => Math.min(b,Math.max(a,v));
function randomGenerator(seed) {
  let state = (seed ^ 0x9e3779b9) >>> 0;
  return () => { state ^= state<<13; state ^= state>>>17; state ^= state<<5; return (state>>>0)/4294967296; };
}
export function validateRecipe(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join() !== 'generator,name,parameters,revision,schema,seed' ||
      value.schema !== RECIPE_SCHEMA || value.generator !== GENERATOR || value.revision !== GENERATOR_REVISION ||
      typeof value.name !== 'string' || !value.name.trim() || value.name.length>60 ||
      !Number.isInteger(value.seed) || value.seed<0 || value.seed>0xffffffff)
    throw new Error('Unsupported or invalid asset recipe');
  const p=value.parameters;
  if (!p || typeof p !== 'object' || Array.isArray(p) ||
      Object.keys(p).sort().join() !== Object.keys(ranges).sort().join())
    throw new Error('Invalid generator parameters');
  for (const [key,[min,max]] of Object.entries(ranges))
    if (typeof p[key] !== 'number' || !Number.isFinite(p[key]) || p[key]<min || p[key]>max)
      throw new Error('Invalid parameter: '+key);
  if (p.trunkRadius > p.crownRadius*0.62) throw new Error('Trunk radius exceeds crown proportions');
  return { schema:RECIPE_SCHEMA, generator:GENERATOR, revision:GENERATOR_REVISION, name:value.name.trim(), seed:value.seed,
    parameters:Object.fromEntries(Object.keys(ranges).map(key => [key,p[key]])) };
}
export function variantSeeds(seed) {
  if (!Number.isInteger(seed) || seed<0 || seed>0xffffffff) throw new Error('Invalid seed');
  const next=randomGenerator(seed);
  return Array.from({length:4},()=>Math.floor(next()*0x100000000)>>>0);
}

const TAU = Math.PI*2;
const length = a => Math.hypot(a[0],a[1],a[2]);
const mix = (a,b,t) => vadd(vmul(a,1-t),vmul(b,t));
const jitter = (rng,amount=1) => (rng()*2-1)*amount;
function meshBuilder() {
  const positions=[],normals=[],colors=[],indices=[];
  const vertex=(p,n,c)=>{ const i=positions.length/3; positions.push(...p); normals.push(...n); colors.push(...c); return i; };
  const triangle=(a,b,c)=>indices.push(a,b,c);
  return {vertex,triangle,finish:()=>({
    positions:new Float32Array(positions), normals:new Float32Array(normals),
    colors:new Float32Array(colors), indices:new Uint32Array(indices)
  })};
}
// Rings follow a transported frame, so bends cannot flip the tube suddenly.
function tube(mesh,path,radii,shade,sides=8) {
  let axis=norm(vsub(path[1],path[0]));
  let u=norm(cross(axis,Math.abs(axis[1])>.9?[1,0,0]:[0,1,0]));
  const rings=[];
  for(let i=0;i<path.length;i++){
    const tangent=norm(vsub(path[Math.min(i+1,path.length-1)],path[Math.max(i-1,0)]));
    u=norm(vsub(u,vmul(tangent,dot(u,tangent))));
    if(length(u)<.01)u=norm(cross(tangent,[0,0,1]));
    const v=norm(cross(tangent,u));
    const ring=[];
    for(let k=0;k<sides;k++){
      const a=k*TAU/sides, normal=norm(vadd(vmul(u,Math.cos(a)),vmul(v,Math.sin(a))));
      const ridge=1+.055*Math.sin(k*2.4+i*.43);
      const colorVariation=.90+.15*Math.sin(k*1.4+i*.65);
      ring.push(mesh.vertex(vadd(path[i],vmul(normal,radii[i]*ridge)),normal,
        shade.map(x=>clamp(x*colorVariation,0,1))));
    }
    rings.push(ring);axis=tangent;
  }
  for(let i=0;i<rings.length-1;i++)for(let k=0;k<sides;k++){
    const next=(k+1)%sides,a=rings[i][k],b=rings[i][next],c=rings[i+1][k],d=rings[i+1][next];
    mesh.triangle(a,b,c);mesh.triangle(b,d,c);
  }
  // Both ends are capped: exported branch and trunk segments are closed solids.
  const start=mesh.vertex(path[0],vmul(axis,-1),shade);
  for(let k=0;k<sides;k++)
    mesh.triangle(rings[0][k],start,rings[0][(k+1)%sides]);
  const at=path.length-1;
  const tip=mesh.vertex(path[at],axis,shade);
  for(let k=0;k<sides;k++)mesh.triangle(rings[at][k],rings[at][(k+1)%sides],tip);
}
function leafBlade(mesh,at,surfaceNormal,size,rng,color) {
  // Small curved lanceolate leaves grow *on* a crown lobe, not in empty space.
  const n=norm(surfaceNormal);
  const tipDir=norm(vadd(vmul(n,.26),norm([jitter(rng),.3+rng()*.65,jitter(rng)])));
  const across=norm(cross(n,tipDir));
  const along=norm(cross(across,n));
  const center=vadd(at,vmul(n,size*.12));
  const lo=vadd(vadd(center,vmul(along,-size*.45)),vmul(across,-size*.08));
  const hi=vadd(vadd(center,vmul(along,size*.55)),vmul(n,size*.30));
  const left=vadd(center,vmul(across,-size*.28));
  const right=vadd(center,vmul(across,size*.28));
  const ridge=vadd(center,vmul(n,size*.21));
  const normal=norm(cross(vsub(left,lo),vsub(ridge,lo)));
  const a=mesh.vertex(lo,normal,color),b=mesh.vertex(left,normal,color),c=mesh.vertex(hi,normal,color);
  const d=mesh.vertex(right,normal,color),e=mesh.vertex(ridge,normal,color);
  mesh.triangle(a,b,e);mesh.triangle(b,c,e);mesh.triangle(e,c,d);mesh.triangle(e,d,a);
}
function foliageLobe(mesh,center,extent,rng,base,leafBudget) {
  // Irregular closed ellipsoid: continuous *volume*, with asymmetric overlapping
  // lobes. A tiny number of leaves on its surface break up the silhouette.
  const steps=10,rings=7,shapeSeed=rng()*TAU,vertexRings=[];
  const wave=[rng(),rng(),rng(),rng()];
  const cell=(a,b)=>Math.sin(a*2.7+shapeSeed)*.065+Math.cos(b*4.8+wave[0]*TAU)*.073+
    Math.sin(a*4.4-b*1.8+wave[1]*TAU)*.048;
  const surface=(theta,phi)=>{
    const s=Math.sin(phi);
    const irregular=1+cell(theta,phi)+.052*Math.cos(theta*5+wave[2]*TAU)*s;
    return [center[0]+Math.cos(theta)*s*extent[0]*irregular,
      center[1]+Math.cos(phi)*extent[1]*(1+.065*Math.sin(theta*3+wave[3]*TAU)),
      center[2]+Math.sin(theta)*s*extent[2]*irregular];
  };
  const color=()=>{
    const tonal=.87+rng()*.26;
    return base.map(v=>clamp(v*tonal,0,1));
  };
  // Pole vertices and independently indexed latitude rings: no degenerate faces.
  const top=mesh.vertex(surface(0,0),[0,1,0],color());
  for(let row=1;row<rings;row++){
    const phi=row*Math.PI/rings,ring=[];
    for(let col=0;col<steps;col++){
      const theta=col*TAU/steps,p=surface(theta,phi);
      const normal=norm([(p[0]-center[0])/Math.max(.01,extent[0]**2),
        (p[1]-center[1])/Math.max(.01,extent[1]**2),
        (p[2]-center[2])/Math.max(.01,extent[2]**2)]);
      ring.push(mesh.vertex(p,normal,color()));
    }
    vertexRings.push(ring);
  }
  const bottom=mesh.vertex(surface(0,Math.PI),[0,-1,0],color());
  const first=vertexRings[0],last=vertexRings[vertexRings.length-1];
  for(let col=0;col<steps;col++){
    const nxt=(col+1)%steps;
    mesh.triangle(top,first[nxt],first[col]);
    mesh.triangle(bottom,last[col],last[nxt]);
  }
  for(let row=0;row<vertexRings.length-1;row++)
    for(let col=0;col<steps;col++){
      const nxt=(col+1)%steps,a=vertexRings[row][col],b=vertexRings[row][nxt],
        c=vertexRings[row+1][col],d=vertexRings[row+1][nxt];
      mesh.triangle(a,b,c);mesh.triangle(b,d,c);
    }
  for(let k=0;k<leafBudget;k++){
    const theta=rng()*TAU,phi=.24+rng()*(Math.PI-.48),at=surface(theta,phi);
    const n=norm(vsub(at,center));
    const leafSize=Math.min(...extent)*(.14+.12*rng());
    const palettes=[[.25,.36,.16],[.32,.43,.18],[.34,.42,.18],[.22,.33,.15]];
    leafBlade(mesh,at,n,leafSize,rng,palettes[Math.floor(rng()*palettes.length)]);
  }
}
export function generateTree(recipe) {
  const r=validateRecipe(recipe), p=r.parameters, rng=randomGenerator(r.seed);
  const wood=meshBuilder(),foliage=meshBuilder();
  const H=p.height,R=p.crownRadius;
  const shade=[.29,.21,.14];
  const trunkTop=.81*H, trunkPoints=[],trunkRadii=[];
  const turn=rng()*TAU,lean=.08+.12*p.asymmetry;
  // Low-frequency curved trunk with an expanded foot rather than a bare cone.
  for(let i=0;i<=17;i++){
    const t=i/17;
    trunkPoints.push([
      Math.sin(turn+t*3.2)*lean*t*t*H*.12,
      t*trunkTop,
      Math.cos(turn+t*3.2)*lean*t*t*H*.12
    ]);
    const taper=Math.pow(1-t,.86);
    const flare=1+.59*Math.exp(-t*21);
    trunkRadii.push(Math.max(.012,p.trunkRadius*taper*flare));
  }
  tube(wood,trunkPoints,trunkRadii,shade,10);
  const trunkAt=t=>{
    const x=clamp(t,0,1)*17,i=Math.min(16,Math.floor(x));
    return mix(trunkPoints[i],trunkPoints[i+1],x-i);
  };
  let branches=0,leaves=0,clusters=0;
  const crownBias=rng()*TAU;
  function pod(center,scale,volume=1){
    const palettes=[[.22,.36,.17],[.265,.40,.19],[.285,.43,.205],[.24,.375,.165],[.31,.445,.215]];
    const color=palettes[Math.floor(rng()*palettes.length)];
    const size=scale*(.88+rng()*.23);
    const extents=[size*(.86+rng()*.36),size*(.61+rng()*.22),size*(.84+rng()*.31)];
    const count=Math.round((3+5*p.leafDensity)*volume);
    foliageLobe(foliage,center,extents,rng,color,count);
    clusters++;leaves+=count;
  }
  function limb(start,end,radius,segments=5,curvature=.12){
    const path=[],radii=[],dis=vsub(end,start),flat=[-dis[2],0,dis[0]];
    const flatN=norm(flat),bend=jitter(rng,curvature);
    for(let k=0;k<=segments;k++){
      const u=k/segments;
      const point=mix(start,end,u);
      point[1]+=Math.sin(Math.PI*u)*curvature*H*.33;
      const p2=vadd(point,vmul(flatN,bend*Math.sin(Math.PI*u)*R*.28));
      path.push(p2);
      radii.push(Math.max(.007,radius*Math.pow(1-u,.97)));
    }
    tube(wood,path,radii,shade,radius>p.trunkRadius*.2?8:6);
    branches++;
    return path;
  }
  function clusterAt(tip,dir,scale,baseCount=2){
    // Closely packed crown masses define the silhouette; leaf blades only add detail.
    const sideways=norm(cross(dir,[0,1,0]));
    const podCount=baseCount+Math.round(p.leafDensity);
    for(let j=0;j<podCount;j++){
      const angle=TAU*j/podCount+jitter(rng,.36);
      const radial=scale*(.38+.35*rng());
      const c=vadd(tip,[
        Math.cos(angle)*radial+jitter(rng,scale*.09),
        Math.sin(angle*1.7)*scale*.29+jitter(rng,scale*.17),
        Math.sin(angle)*radial+jitter(rng,scale*.09)
      ]);
      pod(c,scale*(.64+.16*rng()));
    }
    pod(vadd(tip,[0,scale*.15,0]),scale*.86);
  }
  const nMain=Math.round(lerp(8,13,p.branchDensity));
  for(let i=0;i<nMain;i++){
    // Golden angle distributes big scaffolding branches without identical rings.
    const t=(i+.47+jitter(rng,.23))/nMain;
    const heightAlong=.25+t*.69, start=trunkAt(heightAlong);
    const angle=crownBias+i*2.39996322972865+jitter(rng,.16+.24*p.asymmetry);
    const dir=[Math.cos(angle),0,Math.sin(angle)];
    const reach=(.64+.40*Math.sin((.20+t*.83)*Math.PI))*R*(.86+.22*rng());
    const lengthH=H*(.115+.095*rng()+.043*t);
    const end=vadd(start,[dir[0]*reach,Math.min(H*.91-start[1],lengthH),dir[2]*reach]);
    const radius=p.trunkRadius*(.41-.25*t)*(.8+rng()*.27);
    const main=limb(start,end,radius,7,.07+.09*p.asymmetry);
    // Two to four side-branches, each with curved small tips. The network
    // branches outward and upward; it does not create a radial broom.
    const forks=Math.round(lerp(2,4,p.branchDensity));
    for(let j=0;j<forks;j++){
      const along=.40+(j+.35)/(forks+.65)*.43;
      const a=along*7,index=Math.min(6,Math.floor(a)),joint=mix(main[index],main[index+1],a-index);
      const sign=(j%2===0?1:-1),sideAngle=angle+sign*(.42+rng()*.48);
      const childReach=R*(.23+.18*rng())*(.85+.24*(1-t));
      const secondaryEnd=vadd(joint,[
        Math.cos(sideAngle)*childReach, H*(.035+.065*rng()), Math.sin(sideAngle)*childReach
      ]);
      const sec=limb(joint,secondaryEnd,radius*(.29+.1*rng()),4,.06);
      for(let k=0;k<2;k++){
        const subAngle=sideAngle+(k===0?-1:1)*(.29+rng()*.28);
        const attach=sec[2+k];
        const ext=R*(.12+.09*rng());
        const tertiaryEnd=vadd(attach,[
          Math.cos(subAngle)*ext, H*(.035+.04*rng()),Math.sin(subAngle)*ext
        ]);
        limb(attach,tertiaryEnd,radius*.105,3,.025);
        clusterAt(tertiaryEnd,dir,R*(.19+.04*rng()),1);
      }
      clusterAt(secondaryEnd,dir,R*(.20+.035*rng()),2);
    }
    clusterAt(end,dir,R*(.23+.03*rng()),3);
  }
  // A rounded upper canopy bridges gaps between separately generated limbs.
  // It is intentionally lumpy, not a single symmetric sphere.
  const canopyCenter=trunkAt(.84);
  for(let i=0;i<13;i++){
    const phi=TAU*i/13+crownBias*.2;
    const rr=R*(.15+.20*rng()), lift=H*(.12+.09*rng());
    pod(vadd(canopyCenter,[
      Math.cos(phi)*rr,lift+jitter(rng,H*.035),Math.sin(phi)*rr
    ]),R*(.27+.07*rng()),1.15);
  }
  const model={wood:wood.finish(),foliage:foliage.finish()};
  const triangles=(model.wood.indices.length+model.foliage.indices.length)/3;
  if(triangles>200000)throw new Error('Geometry complexity limit exceeded');
  return {recipe:r,model,stats:{
    branches,leaves,clusters,triangles,
    vertices:(model.wood.positions.length+model.foliage.positions.length)/3
  }};
}
