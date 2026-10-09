import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaterRegions, waterAt, waterOverlapsFootprint, validateWaterSources } from '../web/water-field.mjs';
import { validateDocument } from '../src/core/map.ts';

const sea = { id: 'sea', definition: 'water.sea', height: 5 } as const;
const lake = { id: 'lake', definition: 'water.lake', height: 5, source: [2, 2] as [number, number] } as const;
const terrain = { size: [4, 4] as [number,number], min_height: 0, max_height: 10 };
const heights = (values:number[]) => ({ width: 5, height: 5, data: new Float32Array(values.map(x => x / 10)) });
const basin = heights([
  10, 10, 10, 10, 10,
  10,  2,  2,  2, 10,
  10,  2,  0,  2, 10,
  10,  2,  2,  2, 10,
  10, 10, 10, 10, 10,
]);

test('sea enters only from submerged map boundaries; isolated lake needs a source', () => {
  const drySea = buildWaterRegions(terrain, basin, [sea]);
  assert.equal(drySea[0].triangleCount, 0);
  assert.equal(waterAt(terrain, basin, drySea, 2, 2), null);
  const inland = buildWaterRegions(terrain, basin, [sea, lake]);
  assert.ok(inland[1].triangleCount > 0);
  assert.equal(waterAt(terrain, basin, inland, 2, 2), 'lake');
  assert.equal(waterAt(terrain, basin, inland, 0, 0), null);
});

test('cutting a channel connects enclosed lowland to the sea; raising it dries the basin', () => {
  const channel = heights(Array.from(basin.data, v => v*10));
  for(let z=0;z<=2;z++) channel.data[z*5+2]=0.1;
  const flooded = buildWaterRegions(terrain, channel, [sea]);
  assert.equal(waterAt(terrain, channel, flooded, 2, 2), 'sea');
  channel.data[2]=1;
  channel.data[7]=1;
  const blocked = buildWaterRegions(terrain, channel, [sea]);
  assert.equal(waterAt(terrain, channel, blocked, 2, 2), null);
});

test('flooding crosses shared submerged edges, not merely opposite low cell corners', () => {
  // Triangle split TL/BL/TR, TR/BL/BR: TL and BR are disconnected at 5 m.
  const tiny = heights([0,10,10,0]);
  tiny.width=2; tiny.height=2;
  const area={size:[1,1] as [number,number],min_height:0,max_height:10};
  const result=buildWaterRegions(area,tiny,[sea]);
  assert.equal(waterAt(area,tiny,result,0.02,0.02),'sea');
  assert.equal(waterAt(area,tiny,result,0.98,0.98),'sea');
  assert.equal(waterAt(area,tiny,result,0.5,0.5),null);
});

test('derived geometry follows elevation and footprint overlap catches submerged triangle interiors', () => {
  const water=buildWaterRegions(terrain,basin,[lake]);
  assert.ok(water[0].positions.length>0);
  for(let i=1;i<water[0].positions.length;i+=3) assert.ok(Math.abs(water[0].positions[i]-5.025)<1e-5);
  assert.equal(waterOverlapsFootprint(terrain,basin,water,[[1.8,1.8],[2.2,1.8],[2.2,2.2],[1.8,2.2]]),'lake');
  assert.equal(waterOverlapsFootprint(terrain,basin,water,[[0,0],[0.5,0],[0.5,0.5],[0,0.5]]),null);
});

test('rejects multiple seas, polygon inputs, dry lakes and malformed sources', () => {
  assert.throws(()=>validateWaterSources([sea, { ...sea,id:'second' }],terrain.size),/one sea/);
  assert.throws(()=>validateWaterSources([{id:'water',definition:'water.sea',height:5,polygon:[[1,1],[2,1],[1,2]]}],terrain.size),/one sea/);
  assert.throws(()=>validateWaterSources([{...lake,source:[-1,5]}],terrain.size),/Invalid lake source/);
  assert.throws(()=>buildWaterRegions(terrain,basin,[{...lake,source:[0,0]}]),/must be below/);
  const map={name:'test',terrain:{...terrain,heightmap:'assets/a.exr',surface_map:'assets/a.png',surface_palette:['terrain.grass']},water:[{...lake,source:[0,0] as [number,number]}],roads:[],settlements:[],buildings:[],objects:[]};
  assert.throws(()=>validateDocument({map,heights:basin,surfaces:{width:4,height:4,data:new Uint8Array(16)}}),/source must be below/);
});
