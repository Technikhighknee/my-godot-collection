// UV remapping is a separate render-only mesh: the accepted closed oak
// topology, positions, normals and foliage attachment data are untouched.
// Circumferential seam vertices are duplicated only for rendering.
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const minus=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
export const OAK_BARK_UV_SCALE=Object.freeze({aroundMeters:.48,alongMeters:1.05});
export function mapOakBarkWood(wood){
  if(!wood?.positions||!wood?.normals||!wood?.indices||
    !Array.isArray(wood.branches))
    throw Error('Expected oak wood geometry');
  const positions=Array.from(wood.positions),normals=Array.from(wood.normals);
  const uvs=Array(positions.length/3*2).fill(0),indices=[],groups=[];
  const point=i=>positions.slice(i*3,i*3+3);
  const branches=wood.branches;
  const continuation=new Map(branches.filter(b=>b.continuation)
    .map(b=>[b.parentId,b]));
  const chains=[];
  let originalOffset=0;
  for(const root of branches.filter(b=>!b.continuation)){
    let axis=root;
    const axes=[root];
    while(continuation.has(axis.id)){
      axis=continuation.get(axis.id);
      axes.push(axis);
    }
    const rings=axes.reduce((n,b,i)=>n+b.rings-(i?1:0),0);
    if(rings<2||root.sides<3)throw Error('Malformed oak ring chain');
    const centers=[],distances=[0],radiusSamples=[];
    for(let row=0;row<rings;row++){
      const center=[0,0,0],vertices=[];
      for(let j=0;j<root.sides;j++){
        const p=point(originalOffset+row*root.sides+j);
        vertices.push(p);
        for(let k=0;k<3;k++)center[k]+=p[k]/root.sides;
      }
      centers.push(center);
      radiusSamples.push(vertices.reduce((n,p)=>n+distance(p,center),0)/root.sides);
      if(row)distances.push(distances[row-1]+distance(center,centers[row-1]));
    }
    chains.push({root,axes,rings,offset:originalOffset,centers,
      distances,radiusSamples});
    originalOffset+=rings*root.sides+2;
  }
  if(originalOffset!==wood.positions.length/3)
    throw Error('Oak ring layout does not match wood mesh');
  const byAxis=new Map();
  for(const chain of chains)for(const b of chain.axes)byAxis.set(b.id,chain);
  function inheritDistance(chain){
    if(chain.root.parentId===null)return 0;
    const parent=byAxis.get(chain.root.parentId);
    if(!parent)return 0;
    const origin=chain.centers[0],n=parent.centers.length;
    let best=Infinity,along=0;
    for(let k=0;k<n-1;k++){
      const a=parent.centers[k],b=parent.centers[k+1];
      const ab=minus(b,a),ap=minus(origin,a);
      const span=Math.max(1e-12,dot(ab,ab));
      const t=clamp(dot(ap,ab)/span,0,1);
      const closest=a.map((v,i)=>v+ab[i]*t);
      const error=distance(closest,origin);
      if(error<best){
        best=error;
        along=parent.distances[k]+(parent.distances[k+1]-
          parent.distances[k])*t;
      }
    }
    return parent.offsetV+along;
  }
  for(const chain of chains){
    chain.offsetV=inheritDistance(chain);
    // One connected woody shell receives one stable maturity class.
    // Profile transitions occur only at real axis boundaries, not across
    // arbitrary ring faces. More developed secondary limbs can retain
    // coarse bark, while thin sapwood stays nearly smooth.
    const radius=chain.radiusSamples[0];
    const profile=chain.root.level===0?'trunk':
      radius>=.054?'limb':'young';
    const materialIndex=profile==='trunk'?0:profile==='limb'?1:2;
    const groupStart=indices.length;
    const sides=chain.root.sides,offset=chain.offset;
    const around=Math.max(1,Math.round(2*Math.PI*
      chain.radiusSamples[0]/OAK_BARK_UV_SCALE.aroundMeters));
    const seams=[];
    for(let row=0;row<chain.rings;row++){
      const v=(chain.offsetV+chain.distances[row])/
        OAK_BARK_UV_SCALE.alongMeters;
      for(let j=0;j<sides;j++){
        const vertex=offset+row*sides+j;
        uvs[vertex*2]=j/sides*around;
        uvs[vertex*2+1]=v;
      }
      const source=offset+row*sides;
      const seam=positions.length/3;
      positions.push(...point(source));
      normals.push(...normals.slice(source*3,source*3+3));
      uvs.push(around,v);
      seams.push(seam);
    }
    for(let row=0;row<chain.rings-1;row++)for(let j=0;j<sides;j++){
      const a=offset+row*sides+j,b=a+sides;
      const c=j===sides-1?seams[row]:a+1;
      const d=j===sides-1?seams[row+1]:b+1;
      indices.push(a,b,c,c,b,d);
    }
    // Cap UVs are planar and separate from the sidewall UVs, so there
    // are no collapsed long sliver triangles across the wrap boundary.
    for(const [row,centerIndex,flip] of [
      [0,offset+chain.rings*sides,false],
      [chain.rings-1,offset+chain.rings*sides+1,true],
    ]){
      const midpoint=chain.centers[row],radius=Math.max(chain.radiusSamples[row],1e-5);
      const capCenter=positions.length/3;
      positions.push(...point(centerIndex));
      normals.push(...normals.slice(centerIndex*3,centerIndex*3+3));
      uvs.push(.5,.5);
      const capRing=[];
      for(let j=0;j<sides;j++){
        const original=offset+row*sides+j,p=point(original);
        const clone=positions.length/3;
        positions.push(...p);
        normals.push(...normals.slice(original*3,original*3+3));
        const angle=j*2*Math.PI/sides;
        uvs.push(.5+.45*Math.cos(angle),.5+.45*Math.sin(angle));
        capRing.push(clone);
      }
      for(let j=0;j<sides;j++){
        const next=capRing[(j+1)%sides];
        if(flip)indices.push(capCenter,next,capRing[j]);
        else indices.push(capCenter,capRing[j],next);
      }
    }
    groups.push({start:groupStart,count:indices.length-groupStart,
      materialIndex,profile,axisId:chain.root.id,radius});
  }
  if(indices.length!==wood.indices.length)
    throw Error('Bark render mesh changed triangle count');
  return {
    positions:Float32Array.from(positions),
    normals:Float32Array.from(normals),
    uvs:Float32Array.from(uvs),
    indices:Uint32Array.from(indices),
    groups,
    bounds:wood.bounds,
    uvScale:OAK_BARK_UV_SCALE,
  };
}
