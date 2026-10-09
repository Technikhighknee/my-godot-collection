// Pure, seeded geometry. No browser, renderer, clock or global randomness dependencies.
export const RECIPE_SCHEMA = '1400.asset.recipe.v1';
export const GENERATOR = 'tree.oak.v1';
export const GENERATOR_REVISION = 1;
export const DEFAULT_RECIPE = Object.freeze({
  schema: RECIPE_SCHEMA, generator: GENERATOR, revision: GENERATOR_REVISION, name: 'Oak 01', seed: 147241,
  parameters: { height: 12, crownRadius: 4.4, trunkRadius: 0.38, branchDensity: 0.72, leafDensity: 0.76, asymmetry: 0.5 }
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
function meshBuilder() {
  const positions=[],normals=[],colors=[],indices=[];
  const vertex=(p,n,c)=>{ const i=positions.length/3; positions.push(...p); normals.push(...n);colors.push(...c);return i; };
  const triangle=(a,b,c)=>indices.push(a,b,c);
  return { vertex,triangle,finish:()=>({
    positions:new Float32Array(positions),normals:new Float32Array(normals),
    colors:new Float32Array(colors),indices:new Uint32Array(indices)
  }) };
}
function tube(mesh,points,radii,shade) {
  const sides=7, rings=[], last=points.length-1;
  for(let i=0;i<points.length;i++){
    const tangent=norm(vsub(points[Math.min(i+1,last)],points[Math.max(0,i-1)]));
    const guide=Math.abs(dot(tangent,[0,1,0]))>.88?[1,0,0]:[0,1,0];
    const u=norm(cross(tangent,guide)),v=norm(cross(tangent,u));
    const ring=[];
    for(let j=0;j<sides;j++){
      const a=Math.PI*2*j/sides, normal=norm(vadd(vmul(u,Math.cos(a)),vmul(v,Math.sin(a))));
      const ridge=1+.042*Math.sin(j*2.4+i*1.31);
      const position=vadd(points[i],vmul(normal,radii[i]*ridge));
      const tonal=1+.10*Math.sin(j*4.1+i*.7);
      ring.push(mesh.vertex(position,normal,shade.map(k=>clamp(k*tonal,0,1))));
    }
    rings.push(ring);
  }
  for(let i=0;i<last;i++)for(let j=0;j<sides;j++){
    const a=rings[i][j],b=rings[i][(j+1)%sides],c=rings[i+1][j],d=rings[i+1][(j+1)%sides];
    mesh.triangle(a,b,c);mesh.triangle(b,d,c);
  }
  const cap=mesh.vertex(points[last],norm(vsub(points[last],points[last-1])),shade);
  for(let j=0;j<sides;j++)mesh.triangle(rings[last][j],rings[last][(j+1)%sides],cap);
}
function leaf(mesh,center,direction,size,shade,rng) {
  const facing=norm(direction);
  const axis=norm(cross(facing,Math.abs(facing[1])>.88?[1,0,0]:[0,1,0]));
  const across=norm(cross(axis,facing));
  const width=size*(.39+.16*rng());
  const base=vadd(center,vmul(facing,-size*.48));
  const tip=vadd(center,vmul(facing,size*.64));
  const left=vadd(center,vmul(across,-width));
  const right=vadd(center,vmul(across,width));
  const middle=vadd(center,vmul(axis,size*.19));
  const n=norm(cross(vsub(left,base),vsub(middle,base)));
  const tonal=clamp(.78+rng()*.4,0,1.25);
  const col=shade.map(v=>clamp(v*tonal,0,1));
  const a=mesh.vertex(base,n,col),b=mesh.vertex(left,n,col),c=mesh.vertex(tip,n,col),
    d=mesh.vertex(right,n,col),e=mesh.vertex(middle,n,col);
  mesh.triangle(a,b,e);mesh.triangle(b,c,e);mesh.triangle(e,c,d);mesh.triangle(e,d,a);
}
export function generateTree(recipe) {
  const r=validateRecipe(recipe),p=r.parameters,rng=randomGenerator(r.seed);
  const wood=meshBuilder(),foliage=meshBuilder();
  const treeHeight=p.height, trunkHeight=p.height*.72;
  const trunkPoints=[],radii=[];
  const tilt=rng()*Math.PI*2, crooked=p.asymmetry*(.05+rng()*.11);
  for(let i=0;i<=13;i++){
    const t=i/13;
    trunkPoints.push([
      Math.sin(t*5.6+tilt)*crooked*t*t + t*.17*Math.cos(tilt),
      trunkHeight*t,
      Math.cos(t*6.4+tilt)*crooked*t*t + t*.17*Math.sin(tilt)
    ]);
    radii.push(Math.max(.019,p.trunkRadius*Math.pow(1-t,1.3)*(1+.1*Math.sin(i*1.9))));
  }
  const sampleTrunk=t=>{const at=t*13,i=Math.min(12,Math.floor(at)),f=at-i;return vadd(vmul(trunkPoints[i],1-f),vmul(trunkPoints[i+1],f));};
  tube(wood,trunkPoints,radii,[.34,.245,.17]);
  let branches=0,leafCount=0;
  function leavesAt(point,scale,count) {
    for(let k=0;k<count;k++){
      const theta=6.28318530718*rng(),z=rng()*2-1, radial=Math.sqrt(Math.max(0,1-z*z));
      const spread=scale*Math.cbrt(rng());
      const offset=[Math.cos(theta)*radial*spread,z*spread*.73,Math.sin(theta)*radial*spread];
      const center=vadd(point,offset);
      const facing=norm([rng()-.5,.25+rng()*.8,rng()-.5]);
      const green=rng();
      const color=green>.55?[.27,.44,.205]:green>.2?[.34,.48,.24]:[.22,.36,.19];
      leaf(foliage,center,facing,scale*(.31+.24*rng()),color,rng);
      leafCount++;
    }
  }
  const levels=Math.round(lerp(5,9,p.branchDensity));
  for(let level=0;level<levels;level++){
    const t=(level+.22)/levels, startT=.28+t*.69, start=sampleTrunk(startT);
    const perLevel=Math.round(lerp(3,6,p.branchDensity) + (level%2));
    for(let j=0;j<perLevel;j++){
      const azimuth=(j+(level%2)*.5)/perLevel*Math.PI*2 + (rng()-.5)*(.38+p.asymmetry*.65);
      const direction=[Math.cos(azimuth),0,Math.sin(azimuth)];
      const lower=Math.sin(Math.PI*clamp(startT,.05,.95));
      const reach=p.crownRadius*(.55+.58*lower)*(.78+rng()*.35);
      const lift=treeHeight*(.12+.11*rng()+startT*.07);
      const curl=(rng()-.5)*p.asymmetry*.35;
      const points=[],rad=[];
      const r0=p.trunkRadius*(.10+.25*(1-startT))*(.75+rng()*.45);
      for(let k=0;k<=6;k++){
        const s=k/6;
        const horizontal=reach*s;
        const twist=azimuth+curl*s;
        points.push([
          start[0]+Math.cos(twist)*horizontal,
          start[1]+lift*Math.pow(s,1.55)-Math.sin(s*Math.PI)*reach*.035,
          start[2]+Math.sin(twist)*horizontal
        ]);
        rad.push(Math.max(.012,r0*Math.pow(1-s,1.12)));
      }
      tube(wood,points,rad,[.35,.25,.17]);branches++;
      for(let sub=0;sub<2;sub++){
        const startIndex=3+sub;
        const joint=points[startIndex];
        const side=(sub===0?-1:1)*(Math.PI/3+rng()*.6);
        const angle=azimuth+side;
        const reach2=p.crownRadius*(.19+.17*rng());
        const tip=vadd(joint,[Math.cos(angle)*reach2,treeHeight*(.04+.07*rng()),Math.sin(angle)*reach2]);
        const midpoint=vadd(joint,vmul(vsub(tip,joint),.52));
        midpoint[1]+=treeHeight*.018;
        tube(wood,[joint,midpoint,tip],[r0*.30,r0*.17,.007],[.36,.255,.18]);branches++;
        leavesAt(tip,p.crownRadius*(.16+.04*rng()),Math.round(lerp(6,16,p.leafDensity)));
      }
      leavesAt(points[6],p.crownRadius*(.20+.06*rng()),Math.round(lerp(9,22,p.leafDensity)));
      leavesAt(points[5],p.crownRadius*.15,Math.round(lerp(4,10,p.leafDensity)));
    }
  }
  // Distinct upper crown: the apex is not a leafless trunk sticking through the canopy.
  for(let i=0;i<9;i++){
    const a=i/9*Math.PI*2,dis=p.crownRadius*(.07+.2*rng());
    leavesAt(vadd(trunkPoints[13],[Math.cos(a)*dis,treeHeight*(.04+.14*rng()),Math.sin(a)*dis]),
      p.crownRadius*.18,Math.round(lerp(7,17,p.leafDensity)));
  }
  const model={wood:wood.finish(),foliage:foliage.finish()};
  const triangles=(model.wood.indices.length+model.foliage.indices.length)/3;
  if(triangles>200000)throw new Error('Geometry complexity limit exceeded');
  return { recipe:r, model, stats:{ branches, leaves:leafCount, triangles, vertices:(model.wood.positions.length+model.foliage.positions.length)/3 } };
}
