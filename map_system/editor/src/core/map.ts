import type { FloatImage } from '../formats/exr.ts';
import type { IndexedSurface } from '../formats/png.ts';
import { validateWaterSources } from '../../web/water-field.mjs';

export type Point = [number, number];
export interface Road { id: string; definition: string; width: number; points: Point[]; }
export interface Settlement { id: string; name: string; build_areas: Point[][]; }
export type Water = { id: string; definition: 'water.sea'; height: number } | { id: string; definition: 'water.lake'; height: number; source: Point }; 
export interface MapEntity { id: string; definition: string; position: Point; rotation: number; }
export interface MapJson {
  name: string;
  terrain: {
    size: Point; heightmap: string; min_height: number; max_height: number;
    surface_map: string; surface_palette: string[];
  };
  roads: Road[]; settlements: Settlement[]; water: Water[];
  buildings: MapEntity[]; objects: MapEntity[];
}
export interface MapDocument { map: MapJson; heights: FloatImage; surfaces: IndexedSurface; }
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const string = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
function error(path: string, message: string): never { throw new Error(`Map: ${path} ${message}`); }
function fields(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (!record(value)) error(path, 'must be an object');
  for (const k of keys) if (!(k in value)) error(`${path}.${k}`, 'is required');
  for (const k of Object.keys(value)) if (!keys.includes(k)) error(`${path}.${k}`, 'is unknown');
  return value;
}
function number(value: unknown, path: string): number { if (!finite(value)) error(path, 'must be finite'); return value; }
function requiredString(value: unknown, path: string): string { if (!string(value)) error(path, 'must be non-empty'); return value; }
function array(value: unknown, path: string): unknown[] { if (!Array.isArray(value)) error(path, 'must be an array'); return value; }
function point(value: unknown, path: string, bounds: Point | null): Point {
  if (!Array.isArray(value) || value.length !== 2) error(path, 'must be [x,z]');
  const x = number(value[0], path + '[0]'), z = number(value[1], path + '[1]');
  if (bounds && (x < 0 || z < 0 || x > bounds[0] || z > bounds[1])) error(path, 'lies outside terrain');
  return [x, z];
}
function cross(a: Point, b: Point, c: Point) { return (b[0]-a[0]) * (c[1]-a[1]) - (b[1]-a[1]) * (c[0]-a[0]); }
function intersects(a: Point, b: Point, c: Point, d: Point): boolean {
  const eps = 1e-10, t1=cross(a,b,c),t2=cross(a,b,d),t3=cross(c,d,a),t4=cross(c,d,b);
  if ((t1>eps && t2< -eps || t1< -eps && t2>eps) && (t3>eps && t4< -eps || t3< -eps && t4>eps)) return true;
  const on = (p: Point, q: Point, v: Point) => Math.abs(cross(p,q,v))<=eps && v[0]>=Math.min(p[0],q[0])-eps && v[0]<=Math.max(p[0],q[0])+eps && v[1]>=Math.min(p[1],q[1])-eps && v[1]<=Math.max(p[1],q[1])+eps;
  return on(a,b,c) || on(a,b,d) || on(c,d,a) || on(c,d,b);
}
function polygon(value: unknown, path: string, bounds: Point): Point[] {
  const pts = array(value, path).map((p,i)=>point(p, `${path}[${i}]`, bounds));
  if (pts.length < 3) error(path,'requires at least three points');
  let doubleArea = 0;
  for (let i=0;i<pts.length;i++) {
    const a=pts[i],b=pts[(i+1)%pts.length];
    if (a[0]===b[0] && a[1]===b[1]) error(path,'has duplicate adjacent points');
    doubleArea += a[0]*b[1]-b[0]*a[1];
    for(let j=i+1;j<pts.length;j++) {
      if(j===i+1 || i===0 && j===pts.length-1) continue;
      if(intersects(a,b,pts[j],pts[(j+1)%pts.length])) error(path,'self-intersects');
    }
  }
  if (Math.abs(doubleArea)<1e-9) error(path,'has zero area');
  return pts;
}
/** Pure structural validation of the existing Godot Map JSON contract. */
export function validateMap(value: unknown): MapJson {
  const root = fields(value,'map',['name','terrain','roads','settlements','water','buildings','objects']);
  requiredString(root.name,'map.name');
  const terrain = fields(root.terrain,'map.terrain',['size','heightmap','min_height','max_height','surface_map','surface_palette']);
  const size=point(terrain.size,'map.terrain.size',null);
  if(size[0]<=0||size[1]<=0) error('map.terrain.size','must be positive');
  const min=number(terrain.min_height,'terrain.min_height'),max=number(terrain.max_height,'terrain.max_height');
  if(max<=min)error('map.terrain','max_height must exceed min_height');
  for(const [key,ext] of [['heightmap','.exr'],['surface_map','.png']] as const) {
    const p=requiredString(terrain[key],`map.terrain.${key}`);
    if(!p.toLowerCase().endsWith(ext)||p.startsWith('/')||p.includes('\\')||p.includes(':')||p.split('/').some(x=>x===''||x==='.'||x==='..'))error(`map.terrain.${key}`,'must be a safe relative '+ext+' path');
  }
  const palette=array(terrain.surface_palette,'map.terrain.surface_palette');
  if(palette.length<1||palette.length>256)error('map.terrain.surface_palette','needs 1..256 IDs');
  const found=new Set<string>();
  for(const [i,v] of palette.entries()) { const s=requiredString(v,`map.terrain.surface_palette[${i}]`);if(found.has(s))error('map.terrain.surface_palette','has duplicate ID');found.add(s); }
  const ids=new Set<string>();
  function unique(v: unknown,p:string) { const id=requiredString(v,p);if(ids.has(id))error(p,'duplicates another ID');ids.add(id); }
  for(const [i,v] of array(root.roads,'map.roads').entries()) {
    const p=`map.roads[${i}]`,r=fields(v,p,['id','definition','width','points']);
    unique(r.id,p+'.id');requiredString(r.definition,p+'.definition');if(number(r.width,p+'.width')<=0)error(p+'.width','must be positive');
    const points=array(r.points,p+'.points').map((v,j)=>point(v,p+`.points[${j}]`,size));
    if(points.length<2)error(p+'.points','needs two points');
    for(let j=1;j<points.length;j++)if(Math.hypot(points[j][0]-points[j-1][0],points[j][1]-points[j-1][1])<1e-8)error(p+'.points','has adjacent duplicate');
  }
  for(const [i,v] of array(root.settlements,'map.settlements').entries()) {
    const p=`map.settlements[${i}]`,s=fields(v,p,['id','name','build_areas']);unique(s.id,p+'.id');requiredString(s.name,p+'.name');
    const areas=array(s.build_areas,p+'.build_areas');if(areas.length<1)error(p+'.build_areas','is empty');
    areas.forEach((x,j)=>polygon(x,p+`.build_areas[${j}]`,size));
  }
  validateWaterSources(root.water, size, [...ids]);
  for (const entry of root.water as Water[]) unique(entry.id, 'map.water.id');
  for(const kind of ['buildings','objects'] as const)for(const [i,v] of array(root[kind],`map.${kind}`).entries()) {
    const p=`map.${kind}[${i}]`,o=fields(v,p,['id','definition','position','rotation']);unique(o.id,p+'.id');requiredString(o.definition,p+'.definition');point(o.position,p+'.position',size);number(o.rotation,p+'.rotation');
  }
  return value as MapJson;
}
export function validateDocument(doc: MapDocument): MapDocument {
  const map=validateMap(doc.map),h=doc.heights,s=doc.surfaces;
  if(!Number.isInteger(h.width)||!Number.isInteger(h.height)||h.width<2||h.height<2||h.data.length!==h.width*h.height)error('heightmap','invalid dimensions');
  if(s.width!==h.width-1||s.height!==h.height-1||s.data.length!==s.width*s.height)error('surface_map','must be heightmap grid minus one cell per axis');
  for(let i=0;i<s.data.length;i++)if(s.data[i]>=map.terrain.surface_palette.length)error(`surface_map.pixel[${i}]`,'outside palette');
  for(let i=0;i<h.data.length;i++)if(!Number.isFinite(h.data[i]))error(`heightmap.pixel[${i}]`,'is not finite');
  for(const entry of map.water) if(entry.definition === 'water.lake' && !(heightAt(doc,...entry.source)<entry.height)) error('map.water', `lake ${entry.id} source must be below its water level`);
  return doc;
}
/** Matches Godot's two-triangle terrain interpolation, NOT generic bilinear height blending. */
export function heightAt(doc: MapDocument,x:number,z:number):number {
  const {width,height,data}=doc.heights, [sx,sz]=doc.map.terrain.size;
  if(!Number.isFinite(x)||!Number.isFinite(z))throw new Error('heightAt requires finite coordinates');
  const gx=Math.min(Math.max(x,0),sx)/sx*(width-1),gz=Math.min(Math.max(z,0),sz)/sz*(height-1);
  const ix=Math.min(Math.floor(gx),width-2),iz=Math.min(Math.floor(gz),height-2),tx=gx-ix,tz=gz-iz;
  const h=(dx:number,dz:number)=>doc.map.terrain.min_height+data[(iz+dz)*width+ix+dx]*(doc.map.terrain.max_height-doc.map.terrain.min_height);
  const a=h(0,0),b=h(1,0),c=h(0,1),d=h(1,1);
  return tx+tz<=1 ? a+tx*(b-a)+tz*(c-a) : d+(1-tx)*(c-d)+(1-tz)*(b-d);
}
