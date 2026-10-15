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
