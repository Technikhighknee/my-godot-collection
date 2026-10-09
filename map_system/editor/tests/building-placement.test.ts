import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadMap } from '../src/io/map-io.ts';
import { RoadStore } from '../src/editing/road-store.ts';
import { createEditorServer } from '../src/server.ts';
import { footprint, validatePlacementDefinitions, checkBuildingPlacement } from '../web/building-placement.mjs';

const catalog = validatePlacementDefinitions({buildings:[
  {id:'building.house',footprint:[8,10],requires_build_area:true,max_slope:20,entrance:[0,-5],max_road_distance:25},
  {id:'building.free',footprint:[8,10],requires_build_area:false,max_slope:80},
]});
const house = catalog.buildings[0]!;
function scene() {
  return {
    map: {
      terrain:{size:[100,100],min_height:0,max_height:100},
      roads:[{id:'road1',width:3,points:[[10,25],[90,25]]}],
      water:[{id:'lake',definition:'water.lake',height:45,source:[100,100]}],
      settlements:[{id:'town',build_areas:[[[10,10],[90,10],[90,90],[10,90]]]}],
      buildings:[],
    },
    height:{width:3,height:3,data:new Float32Array([0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.2])},
    definitions:catalog,
  };
}
const entity=(position:[number,number],id='house1',definition='building.house',rotation=0)=>({id,definition,position,rotation});

test('building definitions reject unknown keys, invalid dimensions and incomplete road rules',()=>{
  assert.equal(validatePlacementDefinitions(catalog).buildings.length,2);
  for(const value of [
    {buildings:[{id:'x',footprint:[0,4]}]},
    {buildings:[{id:'x',footprint:[3,4],max_slope:90}]},
    {buildings:[{id:'x',footprint:[3,4],max_road_distance:5}]},
    {buildings:[{id:'x',footprint:[3,4],entrance:[1,2],typo:2}]},
    {buildings:[{id:'x',footprint:[3,4]},{id:'x',footprint:[3,4]}]},
  ]) assert.throws(()=>validatePlacementDefinitions(value),/Invalid/);
});

test('footprints follow Godot clockwise degrees, rotate all four corners',()=>{
  assert.deepEqual(footprint({id:'any',footprint:[4,6]},[10,10],0),[[8,7],[12,7],[12,13],[8,13]]);
  const rotated=footprint({id:'any',footprint:[4,6]},[10,10],90);
  assert.ok(Math.abs(rotated[0][0]-7)<1e-9 && Math.abs(rotated[0][1]-12)<1e-9);
});

test('inside build area, water, road, neighbour, slope and road-distance checks',()=>{
  const doc=scene();
  assert.equal(checkBuildingPlacement(doc,house,entity([40,40])).valid,true);
  assert.equal(checkBuildingPlacement(doc,house,entity([8,40])).reason,'outside_build_area');
  assert.equal(checkBuildingPlacement(doc,house,entity([85,85])).reason,'overlaps_water');
  assert.equal(checkBuildingPlacement(doc,house,entity([40,27])).reason,'overlaps_road');
  assert.equal(checkBuildingPlacement(doc,house,entity([42,42],'house2'),[entity([40,40])]).reason,'overlaps_building');
  assert.equal(checkBuildingPlacement(doc,house,entity([40,78])).reason,'road_too_far');
  assert.equal(checkBuildingPlacement(doc,undefined,entity([40,40])).reason,'unknown_definition');
  const slope=scene(); slope.height.data[1]=1; slope.height.data[2]=1;
  assert.equal(checkBuildingPlacement(slope,house,entity([40,40])).reason,'terrain_too_steep');
  const outside=checkBuildingPlacement(doc,catalog.buildings[1],entity([1,1],'free','building.free',90));
  assert.equal(outside.reason,'outside_map');
});

test('concave settlement edge cannot be crossed with corners still inside',()=>{
  const doc=scene();doc.map.roads=[];
  doc.map.settlements[0].build_areas=[[[10,10],[90,10],[90,25],[45,25],[45,70],[90,70],[90,90],[10,90]]];
  const crossing=checkBuildingPlacement(doc,{id:'test',footprint:[65,12],requires_build_area:true},entity([50,50]));
  assert.equal(crossing.reason,'outside_build_area');
});

test('save rejects invalid building placements and preserves original document',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'m6-building-'));
  try {
    const doc=await loadMap('../godot/coastal_relief.map.json');
    const copy=join(folder,'map.json');await writeFile(copy,JSON.stringify(doc.map));
    // No build areas in sample; a new building requiring build area is rejected.
    const store=await RoadStore.open(copy,doc,catalog);
    const revision=store.getRevision();
    await assert.rejects(()=>store.saveDocument({roads:doc.map.roads,buildings:[entity([40,40])]},revision),/outside_build_area/);
    assert.equal(store.getRevision(),revision);
    assert.deepEqual(JSON.parse(await readFile(copy,'utf8')).buildings,doc.map.buildings);
    await assert.rejects(()=>store.saveDocument({roads:doc.map.roads,buildings:[entity([40,40],'u','not.in.catalog')]},revision),/unknown_definition/);
    // A definition explicitly opting out of build areas still can be placed.
    const updated=await store.saveDocument({roads:doc.map.roads,buildings:[entity([5,5],'free','building.free')]},revision);
    assert.notEqual(updated,revision);
  } finally {await rm(folder,{recursive:true,force:true});}
});

test('API serves placement catalog; rejects invalid placements via PUT without writing',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'m6-http-'));
  const doc=await loadMap('../godot/coastal_relief.map.json');const file=join(folder,'map.json');
  await writeFile(file,JSON.stringify(doc.map));
  const store=await RoadStore.open(file,doc,catalog);
  const server=createEditorServer(doc,store,catalog);
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const addr=server.address();assert.ok(addr && typeof addr!=='string');
    const base=`http://127.0.0.1:${addr.port}`;
    assert.deepEqual(await (await fetch(base+'/api/placement-definitions')).json(),catalog);
    assert.equal((await fetch(base+'/building-placement.mjs')).status,200);
    const revision=store.getRevision();
    const bad=await fetch(base+'/api/document',{method:'PUT',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({revision,roads:doc.map.roads,buildings:[entity([40,40])]})});
    assert.equal(bad.status,400);assert.match((await bad.json()).error,/outside_build_area/);
    assert.equal(store.getRevision(),revision);
  } finally {
    await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
    await rm(folder,{recursive:true,force:true});
  }
});


test('environment edits revalidate existing buildings, unrelated unknown markers are retained',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'m6-env-'));
  try {
    const doc=await loadMap('../godot/coastal_relief.map.json');
    const file=join(folder,'map.json');await writeFile(file,JSON.stringify(doc.map));
    const store=await RoadStore.open(file,doc,catalog);let revision=store.getRevision();
    const building=entity([5,5],'free','building.free');
    revision=await store.saveDocument({roads:doc.map.roads,buildings:[building]},revision);
    const newRoad={id:'blocks_free',definition:'road.path',width:3,points:[[0,5],[10,5]] as [number,number][]};
    await assert.rejects(()=>store.saveDocument({roads:[...doc.map.roads,newRoad]},revision),/overlaps_road/);
    assert.equal(JSON.parse(await readFile(file,'utf8')).roads.length,doc.map.roads.length);
    // Simulate a legacy document opened with an unknown definition already present.
    const legacyMap=JSON.parse(await readFile(file,'utf8'));
    legacyMap.buildings=[{...building,id:'legacy',definition:'not.defined'}];
    await writeFile(file,JSON.stringify(legacyMap));
    const legacyDoc={...doc,map:legacyMap};
    const legacyStore=await RoadStore.open(file,legacyDoc,catalog);
    // Unrelated edits must not silently drop legacy records.
    await legacyStore.saveDocument({roads:legacyMap.roads,objects:[{id:'tree1',definition:'object.tree',position:[30,30],rotation:0}]},legacyStore.getRevision());
    assert.equal(JSON.parse(await readFile(file,'utf8')).buildings[0].definition,'not.defined');
  } finally {await rm(folder,{recursive:true,force:true});}
});
