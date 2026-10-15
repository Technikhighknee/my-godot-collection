// Pure offline world geometry production. Never depends on Godot or editor UI.
// Terrain interpolation, surface palette and flooded regions are shared with
// the Map Editor; road strips are clipped against the exact terrain triangles.
import {buildTerrainGeometry,paletteColor}
  from '../../tools/map-editor/web/mesh-data.mjs';
import {buildWaterRegions} from '../../tools/map-editor/web/water-field.mjs';
import {heightAt,validateDocument} from '../../tools/map-editor/src/core/map.ts';
import type {MapDocument,Point} from '../../tools/map-editor/src/core/map.ts';

export interface WorldMesh {
  positions:Float32Array;
  indices:Uint32Array;
  uv?:Float32Array;
}
export interface SurfaceTransition {
  /** Target palette material. The transition mesh has no collision. */
  definition:string;
  mesh:WorldMesh;
  opacity:Float32Array;
}
export interface WorldGeometry {
  terrain:WorldMesh;
  roads:WorldMesh|null;
  water:WorldMesh|null;
  surfacePixels:Uint8Array;
  surfaceWidth:number;
  surfaceHeight:number;
}

function indexedTriangles(input:number[]):WorldMesh|null{
  if(!input.length)return null;
  const positions=new Float32Array(input);
  const indices=new Uint32Array(positions.length/3);
  for(let i=0;i<indices.length;i++)indices[i]=i;
  return {positions,indices};
}
function lerp(a:Point,b:Point,t:number):Point{
  return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
}
function clipConvex(subject:Point[],clip:Point[]):Point[]{
  let output=subject;
  const sign=Math.sign((clip[1][0]-clip[0][0])*(clip[2][1]-clip[0][1])-
    (clip[1][1]-clip[0][1])*(clip[2][0]-clip[0][0]))||1;
  for(let i=0;i<clip.length;i++){
    const a=clip[i],b=clip[(i+1)%clip.length];
    const dist=(p:Point)=>sign*((b[0]-a[0])*(p[1]-a[1])-
      (b[1]-a[1])*(p[0]-a[0]));
    const next:Point[]=[];
    for(let j=0;j<output.length;j++){
      const start=output[j],end=output[(j+1)%output.length];
      const ds=dist(start),de=dist(end),inside=ds>=-1e-8,endInside=de>=-1e-8;
      if(inside)next.push(start);
      if(inside!==endInside){
        const t=ds/(ds-de);
        next.push(lerp(start,end,t));
      }
    }
    output=next;
    if(!output.length)break;
  }
  return output;
}
const minus=(a:Point,b:Point):Point=>[a[0]-b[0],a[1]-b[1]];
const length=(v:Point)=>Math.hypot(v[0],v[1]);
const normal=(v:Point):Point=>[-v[1]/length(v),v[0]/length(v)];
const dot=(a:Point,b:Point)=>a[0]*b[0]+a[1]*b[1];
const offset=(p:Point,v:Point,d:number):Point=>[p[0]+v[0]*d,p[1]+v[1]*d];

/** Mitered strips; clipped to terrain-cell triangles, so slopes stay exact. */
function buildRoads(doc:MapDocument):WorldMesh|null{
  const {map,heights}=doc;
  const points:number[]=[];
  const w=heights.width,h=heights.height;
  const [sx,sz]=map.terrain.size;
  const stepX=sx/(w-1),stepZ=sz/(h-1);
  function emitPolygon(polygon:Point[]){
    if(polygon.length<3)return;
    const xs=polygon.map(p=>p[0]),zs=polygon.map(p=>p[1]);
    const x0=Math.max(0,Math.floor(Math.min(...xs)/stepX));
    const x1=Math.min(w-2,Math.floor(Math.max(...xs)/stepX));
    const z0=Math.max(0,Math.floor(Math.min(...zs)/stepZ));
    const z1=Math.min(h-2,Math.floor(Math.max(...zs)/stepZ));
    for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
      const a:Point=[x*stepX,z*stepZ];
      const b:Point=[(x+1)*stepX,z*stepZ];
      const c:Point=[x*stepX,(z+1)*stepZ];
      const d:Point=[(x+1)*stepX,(z+1)*stepZ];
      for(const tri of [[a,b,c],[b,d,c]] as Point[][]){
        const poly=clipConvex(polygon,tri);
        for(let i=1;i+1<poly.length;i++){
          const t=[poly[0],poly[i],poly[i+1]];
          const cross=(t[1][0]-t[0][0])*(t[2][1]-t[0][1])-
            (t[1][1]-t[0][1])*(t[2][0]-t[0][0]);
          if(Math.abs(cross)<1e-10)continue;
          // glTF is counter-clockwise as viewed from above (+Y).
          if(cross>0)[t[1],t[2]]=[t[2],t[1]];
          for(const p of t)points.push(p[0],heightAt(doc,...p)+0.02,p[1]);
        }
      }
    }
  }
  for(const road of map.roads){
    const poly=road.points,half=road.width/2;
    const left:Point[]=[],right:Point[]=[];
    for(let i=0;i<poly.length;i++){
      const prev=normal(minus(poly[Math.max(1,i)],poly[Math.max(0,i-1)]));
      const next=normal(minus(poly[Math.min(poly.length-1,i+1)],poly[Math.min(poly.length-2,i)]));
      const blend:Point=[prev[0]+next[0],prev[1]+next[1]];
      const n=i===0?next:i===poly.length-1?prev:
        length(blend)>1e-6?normal(blend):next;
      const cos=Math.max(0.25,Math.abs(dot(n,i===poly.length-1?prev:next)));
      left.push(offset(poly[i],n,half/cos));
      right.push(offset(poly[i],n,-half/cos));
    }
    for(let i=0;i<poly.length-1;i++)
      emitPolygon([left[i],left[i+1],right[i+1],right[i]]);
  }
  return indexedTriangles(points);
}
function buildWater(doc:MapDocument):WorldMesh|null{
  const regions=buildWaterRegions(doc.map.terrain,doc.heights,doc.map.water);
  const positions:number[]=[];
  for(const region of regions)
    for(let i=0;i<region.positions.length;i++)positions.push(region.positions[i]);
  return indexedTriangles(positions);
}

export function buildWorldGeometry(doc:MapDocument):WorldGeometry{
  validateDocument(doc);
  const {map,heights,surfaces}=doc;
  const terrain=buildTerrainGeometry(map.terrain,heights);
  // Indexed map cells are baked into a nearest-filtered albedo image. This
  // preserves categorical boundaries without a runtime Map System shader.
  const rgba=new Uint8Array(surfaces.width*surfaces.height*4);
  const palette=map.terrain.surface_palette.map(paletteColor);
  for(let i=0;i<surfaces.data.length;i++){
    const color=palette[surfaces.data[i]];
    for(let c=0;c<3;c++)rgba[i*4+c]=Math.min(255,Math.round(color[c]*255));
    rgba[i*4+3]=255;
  }
  const uv=new Float32Array(heights.width*heights.height*2);
  let k=0;
  for(let z=0;z<heights.height;z++)for(let x=0;x<heights.width;x++){
    uv[k++]=x/(heights.width-1);
    uv[k++]=1-z/(heights.height-1);
  }
  return {
    terrain:{...terrain,uv},
    roads:buildRoads(doc),
    water:buildWater(doc),
    surfacePixels:rgba,surfaceWidth:surfaces.width,surfaceHeight:surfaces.height,
  };
}


/** Procedurally author only narrow visual seams between categorical cells.
 * Each side borrows its neighbour's material, feathering from zero opacity
 * inside the cell to half-opacity at the boundary. The two sides meet with
 * equal mixture and preserve the original source material away from edges.
 *
 * Each quad is clipped to the same two planar triangles as the authoritative
 * heightfield; no height interpolation or runtime shader is reimplemented.
 * This geometry is never part of the terrain's static collision mesh.
 */
export function buildSurfaceTransitions(doc:MapDocument):SurfaceTransition[]{
  validateDocument(doc);
  const {surfaces,map}=doc;
  const [sx,sz]=map.terrain.size;
  const dx=sx/surfaces.width,dz=sz/surfaces.height;
  const groups=new Map<number,{positions:number[];uv:number[];opacity:number[]}>();
  const samples=surfaces.data;
  const point=(x:number,z:number):Point=>[x,z];
  function append(cellX:number,cellZ:number,target:number,quad:Point[],
    axis:'x'|'z',seam:number,halfWidth:number){
    if(!groups.has(target))groups.set(target,{positions:[],uv:[],opacity:[]});
    const data=groups.get(target)!;
    const x=cellX*dx,z=cellZ*dz;
    const a=point(x,z),b=point(x+dx,z);
    const c=point(x,z+dz),d=point(x+dx,z+dz);
    for(const triangle of [[a,b,c],[b,d,c]] as Point[][]){
      const clipped=clipConvex(quad,triangle);
      for(let n=1;n+1<clipped.length;n++){
        const tri=[clipped[0],clipped[n],clipped[n+1]];
        const cross=(tri[1][0]-tri[0][0])*(tri[2][1]-tri[0][1])-
          (tri[1][1]-tri[0][1])*(tri[2][0]-tri[0][0]);
        if(Math.abs(cross)<1e-10)continue;
        if(cross>0)[tri[1],tri[2]]=[tri[2],tri[1]];
        for(const [px,pz] of tri){
          data.positions.push(px,heightAt(doc,px,pz)+0.025,pz);
          data.uv.push(px/sx,1-pz/sz);
          const dist=Math.abs((axis==='x'?px:pz)-seam);
          // Exact transparent/half-mixed endpoints despite clip float error.
          const blend=Math.max(0,Math.min(1,1-dist/halfWidth));
          data.opacity.push(blend<1e-6?0:blend>1-1e-6?0.5:blend*0.5);
        }
      }
    }
  }
  for(let z=0;z<surfaces.height;z++)for(let x=0;x<surfaces.width;x++){
    const index=z*surfaces.width+x,from=samples[index];
    if(x+1<surfaces.width){
      const next=samples[index+1];
      if(next!==from){
        const seam=(x+1)*dx,width=Math.min(1.5,0.45*dx);
        const z0=z*dz,z1=(z+1)*dz;
        append(x,z,next,[point(seam-width,z0),point(seam,z0),
          point(seam,z1),point(seam-width,z1)],'x',seam,width);
        append(x+1,z,from,[point(seam,z0),point(seam+width,z0),
          point(seam+width,z1),point(seam,z1)],'x',seam,width);
      }
    }
    if(z+1<surfaces.height){
      const next=samples[index+surfaces.width];
      if(next!==from){
        const seam=(z+1)*dz,width=Math.min(1.5,0.45*dz);
        const x0=x*dx,x1=(x+1)*dx;
        append(x,z,next,[point(x0,seam-width),point(x1,seam-width),
          point(x1,seam),point(x0,seam)],'z',seam,width);
        append(x,z+1,from,[point(x0,seam),point(x1,seam),
          point(x1,seam+width),point(x0,seam+width)],'z',seam,width);
      }
    }
  }
  const result:SurfaceTransition[]=[];
  for(const [surface,data] of [...groups].sort(([a],[b])=>a-b)){
    if(surface>=map.terrain.surface_palette.length||!data.opacity.length)
      throw Error('Invalid surface transition palette index');
    const vertices=data.opacity.length;
    result.push({definition:map.terrain.surface_palette[surface],
      opacity:Float32Array.from(data.opacity),
      mesh:{positions:Float32Array.from(data.positions),
        uv:Float32Array.from(data.uv),
        indices:Uint32Array.from({length:vertices},(_,i)=>i)}});
  }
  return result;
}
