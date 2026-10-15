// Periodic seeded signals and channel allocation shared by native surfaces.
// This module defines mathematics only, not materials or style semantics.
export const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
export const mix=(a,b,t)=>a+(b-a)*t;
export const smooth=t=>{t=clamp(t);return t*t*(3-2*t);};
export const wrap=(v,n)=>(v%n+n)%n;
export function hash(x,y,seed){
  let n=(Math.imul(x,374761393)^Math.imul(y,668265263)^(seed>>>0))>>>0;
  n=Math.imul(n^(n>>>13),1274126177);
  return ((n^(n>>>16))>>>0)/4294967296;
}
export function noise(x,y,width,height,columns,rows,seed){
  const u=x*columns/width,v=y*rows/height;
  const ix=Math.floor(u),iy=Math.floor(v),fx=smooth(u-ix),fy=smooth(v-iy);
  const sample=(a,b)=>hash(wrap(a,columns),wrap(b,rows),seed);
  return mix(mix(sample(ix,iy),sample(ix+1,iy),fx),
    mix(sample(ix,iy+1),sample(ix+1,iy+1),fx),fy)-.5;
}
export function allocate(width,height){
  const count=width*height;
  return {width,height,albedo:new Float32Array(count*3),
    heightMap:new Float32Array(count),roughness:new Float32Array(count)};
}
export function colorize(m,p,rgb,height,rough){
  const i=p*3;
  for(let c=0;c<3;c++)m.albedo[i+c]=clamp(rgb[c]);
  m.heightMap[p]=clamp(height);m.roughness[p]=clamp(rough);
}
// Ensure periodic border pixels for every generated channel. Work on the
// native raster *before* retro upscaling, keeping texels and tangent normals
// consistent when the surface wraps on a building.
export function weldSeams(m){
  const {width:w,height:h,albedo,heightMap,roughness}=m;
  const margin=Math.max(3,Math.floor(Math.min(w,h)*.035));
  const blendPair=(a,b,t)=>{
    for(let c=0;c<3;c++){
      const ia=a*3+c,ib=b*3+c;
      const midpoint=(albedo[ia]+albedo[ib])*.5;
      albedo[ia]=mix(albedo[ia],midpoint,t);
      albedo[ib]=mix(albedo[ib],midpoint,t);
    }
    const median=(heightMap[a]+heightMap[b])*.5;
    heightMap[a]=mix(heightMap[a],median,t);
    heightMap[b]=mix(heightMap[b],median,t);
    const rough=(roughness[a]+roughness[b])*.5;
    roughness[a]=mix(roughness[a],rough,t);
    roughness[b]=mix(roughness[b],rough,t);
  };
  for(let y=0;y<h;y++)for(let k=0;k<margin;k++){
    blendPair(y*w+k,y*w+(w-1-k),1-smooth(k/margin));
  }
  for(let x=0;x<w;x++)for(let k=0;k<margin;k++){
    blendPair(k*w+x,(h-1-k)*w+x,1-smooth(k/margin));
  }
  return m;
}
