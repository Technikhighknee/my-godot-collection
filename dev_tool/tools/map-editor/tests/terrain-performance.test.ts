import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTerrainGeometry, makeVertexColors, sampleHeight } from '../web/mesh-data.mjs';
import { intersectTerrainRay } from '../web/terrain-ray.mjs';
import { updateTerrainPatch } from '../web/terrain-patch.mjs';
import { MapEdits } from '../web/terrain-edit.mjs';

function doc(width = 23, rows = 19) {
  const heights = new Float32Array(width * rows);
  for (let z = 0; z < rows; z++) for (let x = 0; x < width; x++) heights[z * width + x] = (Math.sin(x * .4) * Math.cos(z * .3) + 2) / 4;
  const surface = new Uint8Array((width - 1) * (rows - 1));
  surface.fill(0);
  const terrain = { size: [48, 37] as [number, number], min_height: -15, max_height: 75, surface_palette: ['terrain.grass', 'terrain.rock'] };
  return { map: { terrain, roads: [], buildings: [], objects: [], water: [], settlements: [] }, height: { width, height: rows, data: heights }, surface: { width: width-1, height: rows-1, data: surface } };
}
function allNormals(positions: Float32Array, indices: Uint32Array) {
  const result = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const ai = indices[i] * 3, bi = indices[i + 1] * 3, ci = indices[i + 2] * 3;
    const ux=positions[bi]-positions[ai], uy=positions[bi+1]-positions[ai+1], uz=positions[bi+2]-positions[ai+2];
    const vx=positions[ci]-positions[ai], vy=positions[ci+1]-positions[ai+1], vz=positions[ci+2]-positions[ai+2];
    const normal = [uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx];
    for (const n of [ai, bi, ci]) { result[n]+=normal[0]; result[n+1]+=normal[1]; result[n+2]+=normal[2]; }
  }
  for (let i = 0; i < result.length; i += 3) {
    const len=Math.hypot(result[i],result[i+1],result[i+2])||1;
    result[i]/=len;result[i+1]/=len;result[i+2]/=len;
  }
  return result;
}

test('heightfield ray intersection matches exact Godot diagonal and rejects out-of-map rays', () => {
  const d = doc();
  for(let i=0;i<100;i++) {
    const x=(i*.735799)%d.map.terrain.size[0],z=(i*1.159787)%d.map.terrain.size[1];
    const hit=intersectTerrainRay(d.map.terrain,d.height,[x,120,z],[0,-1,0]);
    assert.ok(hit, `ray ${i} missing`);
    assert.ok(Math.abs(hit.point.y-sampleHeight(d.map.terrain,d.height,x,z))<1e-6);
    assert.ok(Math.abs(hit.point.x-x)<1e-7);
  }
  assert.equal(intersectTerrainRay(d.map.terrain,d.height,[-5,50,10],[0,-1,0]),null);
  assert.equal(intersectTerrainRay(d.map.terrain,d.height,[10,100,10],[0,1,0]),null);
  for (const ray of [
    [[-15,98,13],[0.4,-1,0.04]],
    [[55,65,28],[-0.5,-0.9,0.15]],
    [[10,200,-25],[0.12,-1,0.26]],
  ] as [number[], number[]][]) {
    const length = Math.hypot(...ray[1]);
    const dir = ray[1].map(x=>x/length) as [number,number,number];
    const hit = intersectTerrainRay(d.map.terrain,d.height,ray[0] as [number,number,number],dir);
    if(hit) assert.ok(Math.abs(hit.point.y-sampleHeight(d.map.terrain,d.height,hit.point.x,hit.point.z))<1e-5);
  }
});

test('partial updates match full geometry, normals and palette colors', () => {
  const d=doc();
  const {positions,indices}=buildTerrainGeometry(d.map.terrain,d.height);
  const normals=allNormals(positions,indices);
  const colors=makeVertexColors(d.map.terrain,d.height,d.surface,d.map.terrain.surface_palette);
  for(let z=6;z<=10;z++) for(let x=8;x<=13;x++) d.height.data[z*d.height.width+x]=0.9;
  for(let z=7;z<=9;z++) for(let x=9;x<=12;x++) d.surface.data[z*d.surface.width+x]=1;
  const dirty={ height:{minX:8,maxX:13,minZ:6,maxZ:10}, surface:{minX:9,maxX:12,minZ:7,maxZ:9} };
  const updated=updateTerrainPatch(d.map.terrain,d.height,d.surface,d.map.terrain.surface_palette,positions,normals,colors,dirty);
  assert.equal(updated.positions.length,5);
  assert.equal(updated.colors.length,4);
  assert.equal(updated.normals.length,7);
  const expected=buildTerrainGeometry(d.map.terrain,d.height);
  const expectedNormals=allNormals(expected.positions,expected.indices);
  const expectedColors=makeVertexColors(d.map.terrain,d.height,d.surface,d.map.terrain.surface_palette);
  assert.deepEqual(positions,expected.positions);
  for(let i=0;i<normals.length;i++) assert.ok(Math.abs(normals[i]-expectedNormals[i])<1e-5,`normal ${i}`);
  assert.deepEqual(colors,expectedColors);
});

test('stroke bounds accumulate between previews and clear when consumed', () => {
  const d=doc(); const edits=new MapEdits(d as any);
  edits.beginStroke('raise',{radius:2.0,strength:1},[8,8]);
  const first=edits.takeStrokeBounds();
  assert.ok(first?.height && first.height.maxX>=first.height.minX);
  assert.equal(edits.takeStrokeBounds(),null);
  edits.strokeTo([11,8]);
  const second=edits.takeStrokeBounds();
  assert.ok(second?.height && second.height.minX<=second.height.maxX);
  edits.endStroke();
  assert.equal(edits.takeStrokeBounds(),null);
  edits.undo();
  assert.equal(edits.heightDirty,false);
});

// Deliberately independent Möller–Trumbore intersection over every triangle:
// serves as the slow correctness oracle for oblique camera rays.
function bruteTerrainHit(d: ReturnType<typeof doc>, origin: number[], direction: number[]) {
  const { positions, indices } = buildTerrainGeometry(d.map.terrain, d.height);
  let nearest = Infinity;
  for (let i=0;i<indices.length;i+=3) {
    const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
    const e1=[positions[b]-positions[a],positions[b+1]-positions[a+1],positions[b+2]-positions[a+2]];
    const e2=[positions[c]-positions[a],positions[c+1]-positions[a+1],positions[c+2]-positions[a+2]];
    const p=[direction[1]*e2[2]-direction[2]*e2[1], direction[2]*e2[0]-direction[0]*e2[2],direction[0]*e2[1]-direction[1]*e2[0]];
    const determinant=e1[0]*p[0]+e1[1]*p[1]+e1[2]*p[2];
    if(Math.abs(determinant)<1e-12)continue;
    const inv=1/determinant;
    const tvec=[origin[0]-positions[a],origin[1]-positions[a+1],origin[2]-positions[a+2]];
    const u=(tvec[0]*p[0]+tvec[1]*p[1]+tvec[2]*p[2])*inv;
    if(u < -1e-7 || u > 1+1e-7)continue;
    const q=[tvec[1]*e1[2]-tvec[2]*e1[1],tvec[2]*e1[0]-tvec[0]*e1[2],tvec[0]*e1[1]-tvec[1]*e1[0]];
    const v=(direction[0]*q[0]+direction[1]*q[1]+direction[2]*q[2])*inv;
    if(v < -1e-7 || u+v > 1+1e-7)continue;
    const t=(e2[0]*q[0]+e2[1]*q[1]+e2[2]*q[2])*inv;
    if(t>=0 && t<nearest)nearest=t;
  }
  return Number.isFinite(nearest)?nearest:null;
}

test('grid traversal matches independent exhaustive triangle picking for oblique camera rays', () => {
  const d=doc(29,25);
  for(let i=0;i<150;i++) {
    const targetX=(i*1.75531)%d.map.terrain.size[0],targetZ=(i*0.91187)%d.map.terrain.size[1];
    const origin=[targetX+8*Math.sin(i*.3),90+(i%10),targetZ+11*Math.cos(i*.45)];
    const targetY=sampleHeight(d.map.terrain,d.height,targetX,targetZ);
    const v=[targetX-origin[0],targetY-origin[1],targetZ-origin[2]];
    const len=Math.hypot(...v),dir=v.map(n=>n/len);
    const expected=bruteTerrainHit(d,origin,dir);
    const actual=intersectTerrainRay(d.map.terrain,d.height,origin as [number,number,number],dir as [number,number,number]);
    assert.equal(actual===null,expected===null,`ray ${i}`);
    if(expected!==null && actual!==null)assert.ok(Math.abs(actual.distance-expected)<0.0001,`ray ${i}: ${actual.distance} vs ${expected}`);
  }
});
