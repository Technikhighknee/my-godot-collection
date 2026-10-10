// Independent trunk study: no branches, foliage, voxel fields or game state.
const TAU=Math.PI*2;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const mix=(a,b,t)=>a+(b-a)*t;
const smooth=t=>t*t*(3-2*t);
const mod=(x,m)=>(x%m+m)%m;
function hash(x,y,seed) {
  let n=Math.imul(x|0,374761393)^Math.imul(y|0,668265263)^(seed|0);
  n=Math.imul(n^(n>>>13),1274126177);
  return ((n^(n>>>16))>>>0)/4294967295;
}
function noise(u,v,cx,cy,seed) {
  const x=u*cx,y=v*cy,ix=Math.floor(x),iy=Math.floor(y),a=smooth(x-ix),b=smooth(y-iy);
  const h=(dx,dy)=>hash(mod(ix+dx,cx),mod(iy+dy,cy),seed);
  return mix(mix(h(0,0),h(1,0),a),mix(h(0,1),h(1,1),a),b)*2-1;
}
export const DEFAULT_TRUNK=Object.freeze({
  schema:'1400.trunk.study',name:'Oak trunk',seed:147241,
  height:11.5,radius:.42,taper:.68,flare:.42,character:.38,bark:.8
});
const limits={height:[5,18],radius:[.18,.85],taper:[.38,.82],flare:[.1,.85],character:[0,1],bark:[0,1]};
export function validateTrunk(raw) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid trunk recipe');
  const keys=['schema','name','seed',...Object.keys(limits)].sort().join();
  if(Object.keys(raw).sort().join()!==keys || raw.schema!=='1400.trunk.study' ||
    typeof raw.name!=='string'||!raw.name.trim()||raw.name.length>60 ||
    !Number.isInteger(raw.seed)||raw.seed<0||raw.seed>0xffffffff)
    throw Error('Invalid trunk recipe');
  for(const [k,[a,b]] of Object.entries(limits))
    if(typeof raw[k]!=='number'||!Number.isFinite(raw[k])||raw[k]<a||raw[k]>b)
      throw Error('Invalid trunk parameter '+k);
  if(raw.radius/raw.height>.12)throw Error('Trunk proportions are outside the study limits');
  return {...raw,name:raw.name.trim()};
}
function rootAnchors(seed) {
  const count=5+(seed%2);
  const start=hash(seed,7,55)*TAU;
  return Array.from({length:count},(_,i)=>({
    angle:start+TAU*(i+.17*(hash(i,2,seed)-.5))/count,
    width:.14+.065*hash(i,3,seed),
    strength:.55+.40*hash(i,4,seed),
    reach:.52+.32*hash(i,5,seed)
  }));
}
function deltaAngle(a,b){return Math.atan2(Math.sin(a-b),Math.cos(a-b));}
function trunkFrame(recipe,y,roots) {
  const t=clamp(y/recipe.height,0,1);
  const character=recipe.character;
  const phase=hash(recipe.seed,11,71)*TAU;
  const bend=character*recipe.height*.020*t*t;
  const center=[
    bend*Math.cos(phase)+character*recipe.height*.0028*(Math.sin(t*4.5+phase)-Math.sin(phase))*t,
    y,
    bend*Math.sin(phase)+character*recipe.height*.0028*(Math.cos(t*4.1+phase)-Math.cos(phase))*t
  ];
  const shaft=recipe.radius*(1-recipe.taper*Math.pow(t,.88));
  const flare=recipe.flare*Math.exp(-Math.pow(Math.max(0,y)/(.72+recipe.radius*1.6),1.65));
  return {t,center,shaft,flare,phase,roots};
}
function trunkPoint(recipe,frame,theta) {
  const {t,center,shaft,flare,phase,roots}=frame,y=center[1];
  const char=recipe.character;
  let rootForm=0;
  for(const root of roots) {
    const d=deltaAngle(theta,root.angle+char*.075*Math.sin(y*.7+phase));
    const lateral=Math.exp(-.5*(d/root.width)**2);
    // Flared roots become longitudinal buttress ridges and disappear upward.
    rootForm+=lateral*root.strength*(
      root.reach*Math.exp(-Math.pow(Math.max(0,y)/(.24+recipe.radius*.45),1.3))+
      .14*Math.exp(-Math.pow(Math.max(0,y)/(1.25+recipe.radius),1.4))
    );
  }
  // Slow, coherent lobing and restrained helical drift; no per-ring jitter.
  const slow=.016*char*Math.cos(3*theta+phase+.25*t)+
    .010*char*Math.cos(5*theta-phase*.7-.44*t);
  const longitudinal=recipe.bark*.010*(
    Math.cos(11*theta+.28*y+phase)+.39*Math.cos(19*theta-.17*y+phase*.43)
  );
  const radius=Math.max(.006,shaft*(1+flare+rootForm+slow+longitudinal));
  return [center[0]+radius*Math.cos(theta),y,center[2]+radius*Math.sin(theta)];
}
function normalize(x,y,z) {
  const d=Math.hypot(x,y,z)||1;return [x/d,y/d,z/d];
}
function createGeometry(recipe) {
  // Deliberately independent radial/axial resolution for the trunk silhouette.
  const sides=96,rings=161,strip=sides+1;
  const roots=rootAnchors(recipe.seed);
  const positions=new Float32Array((rings*strip+2)*3);
  const normals=new Float32Array(positions.length);
  const uv=new Float32Array((rings*strip+2)*2);
  const indices=[];
  for(let j=0;j<rings;j++){
    const t=j/(rings-1),y=recipe.height*t;
    const frame=trunkFrame(recipe,y,roots);
    for(let i=0;i<=sides;i++){
      const theta=TAU*i/sides,idx=j*strip+i,p=trunkPoint(recipe,frame,theta);
      positions.set(p,idx*3);
      uv.set([i/sides,(y/2.8)],idx*2);
    }
  }
  for(let j=0;j<rings-1;j++)for(let i=0;i<sides;i++){
    const a=j*strip+i,b=a+1,c=a+strip,d=c+1;
    indices.push(a,c,b,b,c,d);
  }
  // Analytical sampled surface derivatives give matching normals across UV seams.
  for(let j=0;j<rings;j++)for(let i=0;i<=sides;i++){
    const k=j*strip+i,l=j*strip+(i===0?sides-1:i-1),r=j*strip+(i===sides?1:i+1);
    const up=Math.min(rings-1,j+1)*strip+i,down=Math.max(0,j-1)*strip+i;
    const tu=[positions[r*3]-positions[l*3],positions[r*3+1]-positions[l*3+1],positions[r*3+2]-positions[l*3+2]];
    const tv=[positions[up*3]-positions[down*3],positions[up*3+1]-positions[down*3+1],positions[up*3+2]-positions[down*3+2]];
    // Height tangent crossed with angular tangent points outward.
    normals.set(normalize(tv[1]*tu[2]-tv[2]*tu[1],tv[2]*tu[0]-tv[0]*tu[2],tv[0]*tu[1]-tv[1]*tu[0]),k*3);
  }
  const lower=rings*strip,upper=lower+1;
  positions.set([0,-.035,0],lower*3);
  // Slightly recessed underside prevents a visible dark floating base.
  const topCenter=trunkFrame(recipe,recipe.height,roots).center;
  positions.set([topCenter[0],recipe.height+.005,topCenter[2]],upper*3);
  normals.set([0,-1,0],lower*3);normals.set([0,1,0],upper*3);
  uv.set([.5,.5],lower*2);uv.set([.5,recipe.height/2.8],upper*2);
  for(let i=0;i<sides;i++){
    indices.push(lower,i,i+1);
    const top=(rings-1)*strip;
    indices.push(upper,top+i+1,top+i);
  }
  return {positions,normals,uv,indices:new Uint32Array(indices)};
}
export function createBarkTextures(recipe,size=512) {
  if(!Number.isInteger(size)||size<32||size>1024)throw Error('Invalid texture size');
  const heights=new Float32Array(size*size),albedo=new Uint8Array(size*size*4);
  const bark=recipe.bark,seed=recipe.seed;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const u=x/size,v=y/size;
    const broad=noise(u,v,8,7,seed+11);
    const warp=.028*noise(u,v,5,11,seed+13)+.008*noise(u,v,21,31,seed+19);
    const track=24*(u+warp)+.16*noise(u,v,15,5,seed+23);
    const crack=Math.pow(Math.max(0,1-Math.abs(Math.sin(Math.PI*track))/.22),2);
    const fragments=noise(u,v,45,85,seed+31);
    const grain=noise(u,v,32,125,seed+37);
    const micro=noise(u,v,91,161,seed+41);
    const relief=(broad*.15+grain*.16+micro*.045-crack*.41*(.7+.3*fragments))*bark;
    const luminance=(.89+.13*broad+.09*grain+.055*micro-.34*crack*(.7+.3*fragments));
    const k=(y*size+x)*4;
    const variation=luminance*(1-.035*bark);
    albedo[k]=clamp(Math.round(137*variation),0,255);
    albedo[k+1]=clamp(Math.round(121*variation),0,255);
    albedo[k+2]=clamp(Math.round(100*variation),0,255);
    albedo[k+3]=255;
    heights[y*size+x]=relief;
  }
  const normal=new Uint8Array(albedo.length);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const a=heights[y*size+mod(x-1,size)],b=heights[y*size+mod(x+1,size)];
    const c=heights[mod(y-1,size)*size+x],d=heights[mod(y+1,size)*size+x];
    // Tangent-space normal; shallow bark faults catch grazing light.
    const n=normalize((a-b)*1.6,(c-d)*1.0,1);
    const k=(y*size+x)*4;
    normal[k]=Math.round((n[0]*.5+.5)*255);
    normal[k+1]=Math.round((n[1]*.5+.5)*255);
    normal[k+2]=Math.round((n[2]*.5+.5)*255);
    normal[k+3]=255;
  }
  return {size,albedo,normal};
}
export function generateTrunk(raw) {
  const recipe=validateTrunk(raw);
  return {recipe,mesh:createGeometry(recipe),textures:createBarkTextures(recipe),
    stats:{rings:161,sides:96}};
}
