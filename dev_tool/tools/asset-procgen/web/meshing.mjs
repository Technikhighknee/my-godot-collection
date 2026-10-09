import { add,sub,scale,unit,dot,cross,clamp,TAU,randomStream,signed } from './math.mjs';

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
function shadeWood(branch,station,side){
  const tone=.84+.09*Math.sin(side*2.2+station*.41+branch.id*.73);
  const depth=branch.generation===0?1:(.9+.12*branch.vigor);
  return [.32,.24,.165].map(x=>clamp(x*tone*depth,0,1));
}
function woodTube(builder,branch) {
  const P=branch.points,R=branch.radii;
  const sides=branch.generation===0?12:branch.generation===1?9:branch.generation===2?7:5;
  const rings=[];
  let tangent=unit(sub(P[1],P[0]));
  let frame=unit(cross(tangent,Math.abs(tangent[1])>.9?[1,0,0]:[0,1,0]));
  for(let k=0;k<P.length;k++) {
    tangent=unit(sub(P[Math.min(P.length-1,k+1)],P[Math.max(0,k-1)]));
    const projected=sub(frame,scale(tangent,dot(frame,tangent)));
    frame=unit(projected);
    if(Math.abs(dot(frame,tangent))>.98)frame=unit(cross(tangent,[0,0,1]));
    const other=unit(cross(tangent,frame)),ring=[];
    for(let j=0;j<sides;j++) {
      const angle=j*TAU/sides,n=unit(add(scale(frame,Math.cos(angle)),scale(other,Math.sin(angle))));
      const ridge=1+.036*Math.sin(j*2.4+k*.62);
      ring.push(builder.vertex(add(P[k],scale(n,R[k]*ridge)),n,shadeWood(branch,k,j)));
    }
    rings.push(ring);
  }
  for(let k=0;k<rings.length-1;k++)
    for(let j=0;j<sides;j++) {
      const nxt=(j+1)%sides,a=rings[k][j],b=rings[k][nxt],c=rings[k+1][j],d=rings[k+1][nxt];
      builder.face(a,b,c);builder.face(b,d,c);
    }
  // Joined limbs overlap their parent, so the hidden base is left open.
  // A terminal cap closes visible endpoints.
  const end=P.length-1,tip=builder.vertex(P[end],tangent,shadeWood(branch,end,0));
  for(let j=0;j<sides;j++)builder.face(rings[end][j],rings[end][(j+1)%sides],tip);
  if(branch.generation===0){
    const bottom=builder.vertex(P[0],scale(unit(sub(P[1],P[0])),-1),shadeWood(branch,0,0));
    for(let j=0;j<sides;j++)builder.face(rings[0][j],bottom,rings[0][(j+1)%sides]);
  }
}
export function meshWood(skeleton) {
  const b=builder();
  for(const branch of skeleton.branches)woodTube(b,branch);
  return b.finish();
}

const stations=[0,.15,.31,.47,.63,.80,1];
const widths=[.025,.31,.40,.49,.35,.23,.004];
// A real, lobed leaf silhouette. No opaque ellipsoid or hidden shell.
function leaf(builder,base,direction,up,length,width,color) {
  const axis=unit(direction);
  let across=unit(cross(axis,up));
  if(Math.abs(dot(across,axis))>.9)across=unit(cross(axis,[0,0,1]));
  const n=unit(cross(across,axis));
  const sides=[];
  for(let i=0;i<stations.length;i++){
    const t=stations[i],peak=Math.sin(t*Math.PI);
    const curl=scale(n,length*.035*peak);
    const spine=add(add(base,scale(axis,t*length)),curl);
    const w=width*widths[i];
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
function leafSpray(builder,anchor,seed,density) {
  const rnd=randomStream(seed,anchor.id,103);
  // A compact shoot with individually oriented leaves, not a blob.
  const leafCount=2+Math.round(density*1.9+anchor.vigor*.7);
  for(let i=0;i<leafCount;i++){
    const t=(i+.30+rnd()*.3)/leafCount;
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
    leaf(builder,origin,pose,tilt,size,size*(.88+.2*rnd()),base);
  }
  return leafCount;
}
export function meshFoliage(skeleton,recipe) {
  const b=builder();let leaves=0;
  for(const anchor of skeleton.leafAnchors)
    leaves+=leafSpray(b,anchor,recipe.seed,recipe.parameters.leafDensity);
  return {mesh:b.finish(),leaves};
}
