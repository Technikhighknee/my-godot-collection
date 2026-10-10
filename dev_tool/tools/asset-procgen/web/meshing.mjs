import { add,sub,scale,unit,dot,cross,clamp,TAU,randomStream,signed } from './math.mjs';
export { meshWood } from './wood-surface.mjs';

function builder() {
  const positions=[],normals=[],colors=[],indices=[];
  return {
    vertex(p,n,c) {
      const i=positions.length/3;positions.push(...p);normals.push(...n);colors.push(...c);return i;
    },
    face(a,b,c) {indices.push(a,b,c);},
    finish() {return {
      positions:new Float32Array(positions),normals:new Float32Array(normals),
      colors:new Float32Array(colors),indices:new Uint32Array(indices)
    };}
  };
}
const fullStations=[0,.15,.31,.47,.63,.80,1];
const fullWidths=[.025,.31,.40,.49,.35,.23,.004];
// Keep the main contour landmarks as the triangle budget gets tighter.
// Simplifying the tessellation never changes leaf placement or random streams.
const leafProfiles=[
  [0,1,2,3,4,5,6],
  [0,1,2,3,5,6],
  [0,1,3,5,6],
  [0,2,5,6]
].map(ids=>({
  stations:ids.map(i=>fullStations[i]),
  widths:ids.map(i=>fullWidths[i]),
  triangles:(ids.length-1)*2
}));
// A real, lobed leaf silhouette. No opaque ellipsoid or hidden shell.
function leaf(builder,base,direction,up,length,width,color,profile) {
  const axis=unit(direction);
  let across=unit(cross(axis,up));
  if(Math.abs(dot(across,axis))>.9)across=unit(cross(axis,[0,0,1]));
  const n=unit(cross(across,axis));
  const sides=[];
  for(let i=0;i<profile.stations.length;i++){
    const t=profile.stations[i],peak=Math.sin(t*Math.PI);
    const curl=scale(n,length*.035*peak);
    const spine=add(add(base,scale(axis,t*length)),curl);
    const w=width*profile.widths[i];
    const warm=.77+.19*t;
    const col=color.map(x=>clamp(x*warm,0,1));
    const l=builder.vertex(sub(spine,scale(across,w)),n,col);
    const r=builder.vertex(add(spine,scale(across,w)),n,col);
    sides.push([l,r]);
  }
  for(let i=0;i<sides.length-1;i++){
    const [a,b]=sides[i],[c,d]=sides[i+1];
    builder.face(a,b,c);builder.face(b,d,c);
  }
}
function leafCount(anchor,density){
  return 2+Math.round(density*1.9+anchor.vigor*.7);
}
function leafSpray(builder,anchor,seed,density,profile,shouldDraw) {
  const rnd=randomStream(seed,anchor.id,103);
  // A compact shoot with individually oriented leaves, not a blob.
  const count=leafCount(anchor,density);
  let drawn=0;
  for(let i=0;i<count;i++){
    const t=(i+.30+rnd()*.3)/count;
    const spine=add(anchor.position,scale(anchor.direction,anchor.size*(t-.2)*.62));
    const theta=i*2.399963229728653+signed(rnd,.33);
    const side=unit(cross(anchor.direction,Math.abs(anchor.direction[1])>.89?[1,0,0]:[0,1,0]));
    const other=unit(cross(side,anchor.direction));
    const normal=unit(add(scale(side,Math.cos(theta)),scale(other,Math.sin(theta))));
    const pose=unit(add(add(scale(anchor.direction,.37),scale(normal,.78)),[0,.17,0]));
    const tilt=unit(add(anchor.normal,scale(normal,.3)));
    const origin=add(spine,scale(normal,anchor.size*(.08+.11*rnd())));
    const size=anchor.size*(.40+.34*rnd());
    const green=.78+.19*anchor.light+.13*signed(rnd);
    const base=[.29,.43,.185].map((x,k)=>clamp(x*green*(k===1?1.02:1),0,1));
    const width=size*(.88+.2*rnd());
    // Evaluate all leaves before deciding which to render: geometry budgets
    // must never change placement or random values of later leaves.
    if(shouldDraw()){
      leaf(builder,origin,pose,tilt,size,width,base,profile);
      drawn++;
    }
  }
  return drawn;
}
export function meshFoliage(skeleton,recipe,triangleBudget=Infinity) {
  if(!(triangleBudget>=0))throw new Error('Invalid foliage triangle budget');
  const total=skeleton.leafAnchors.reduce(
    (sum,anchor)=>sum+leafCount(anchor,recipe.parameters.leafDensity),0);
  const profile=leafProfiles.find(p=>total*p.triangles<=triangleBudget)
    ??leafProfiles[leafProfiles.length-1];
  const allowed=Math.min(total,Math.floor(triangleBudget/profile.triangles));
  if(allowed<1)throw new Error('Insufficient foliage triangle budget');
  const b=builder();
  let leaves=0,ordinal=0;
  const shouldDraw=()=>{
    const k=ordinal++;
    // Evenly thin only when contour simplification alone cannot fit the
    // budget. Keyed per-anchor randomness is left undisturbed.
    return Math.floor((k+1)*allowed/total)>Math.floor(k*allowed/total);
  };
  for(const anchor of skeleton.leafAnchors)
    leaves+=leafSpray(b,anchor,recipe.seed,recipe.parameters.leafDensity,profile,shouldDraw);
  return {mesh:b.finish(),leaves};
}
