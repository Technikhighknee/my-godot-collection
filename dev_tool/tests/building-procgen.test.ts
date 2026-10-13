import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_BUILDING_OPTIONS,validateBuildingOptions,generateBuildingFamily}
  from '../tools/asset-procgen/web/building.mjs';
import {findGenerator,generateAsset}
  from '../tools/asset-procgen/web/generators.mjs';
import type {BuildingOpening,BuildingMesh}
  from '../tools/asset-procgen/web/building.mjs';
import {buildingSurfaceKind}
  from '../tools/asset-procgen/web/building-materials.mjs';

const seeds={structure:19043,material:62191};
const signature=(o:BuildingOpening[])=>o.map(v=>[
  v.side,v.type,v.level,v.center,v.width,v.bottom,v.top,
].join(':'));
const allParts=(mesh:BuildingMesh)=>mesh.parts;

test('three levels share one procedural family and are deterministic',()=>{
  const definition=findGenerator('timber-building');
  assert.ok(definition);
  assert.equal(definition.kind,'model');
  assert.deepEqual(definition.defaultOptions,DEFAULT_BUILDING_OPTIONS);
  const sizes=[];
  for(let level=1;level<=3;level++){
    const a:ReturnType<typeof generateBuildingFamily>=
      generateAsset(definition,seeds,DEFAULT_BUILDING_OPTIONS,level);
    const b=generateBuildingFamily(seeds,DEFAULT_BUILDING_OPTIONS,level);
    assert.deepEqual(a,b);
    assert.equal(a.building.level,level);
    assert.equal(a.kind,'model');
    assert.ok(a.building.exterior.triangles>2000);
    assert.ok(a.building.exterior.triangles<16000,'Building stays game-sized');
    assert.equal(a.building.interior!==null,true);
    sizes.push(a.building.plan.width);
  }
  assert.deepEqual(sizes,[9,10,11]);
});

test('interior windows and doors are a strict subset of exterior openings',()=>{
  for(const level of [1,2,3]){
    const model=generateBuildingFamily(seeds,DEFAULT_BUILDING_OPTIONS,level);
    const {plan,exteriorOpenings,interiorOpenings}=model.building;
    const known=new Set(signature(exteriorOpenings));
    for(const opening of interiorOpenings){
      assert.ok(known.has(signature([opening])[0]),
        'Interior cannot invent an opening: '+JSON.stringify(opening));
      assert.equal(opening.level,0,'Detached interior shell is ground floor only');
    }
    assert.deepEqual(signature(interiorOpenings),
      signature(exteriorOpenings.filter(o=>o.level===0)));
    const expectedSides=level===1?['front']:['front','right'];
    assert.deepEqual(plan.doors.map(door=>door.side),expectedSides,
      'The side door must be present precisely when the service wing exists');
    assert.ok(plan.doors.every(door=>door.level===0),
      'All doors lead to a generated ground-floor room');
    assert.ok(plan.doors.every(door=>interiorOpenings.includes(door)),
      'Both the street entrance and the annex connection must remain accessible');
    assert.ok(!interiorOpenings.some(o=>o.type==='window'&&o.side==='front'&&Math.abs(o.center)<.76));
    assert.ok(model.building.interior!.triangles>200);
  }
});

test('model meshes stay finite, indexed and within a compact envelope',()=>{
  for(const level of [1,2,3]){
    const output=generateBuildingFamily(seeds,DEFAULT_BUILDING_OPTIONS,level);
    for(const mesh of [output.building.exterior,output.building.interior!]){
      assert.ok(mesh.parts.length>3);
      assert.ok(mesh.bounds.max.every((hi,i)=>hi>mesh.bounds.min[i]));
      let triangles=0;
      for(const part of allParts(mesh)){
        assert.equal(part.positions.length,part.normals.length);
        assert.equal(part.uvs.length,part.positions.length/3*2);
        assert.ok(part.uvs.every(Number.isFinite));
        assert.equal(part.positions.length%3,0);
        assert.equal(part.indices.length%3,0);
        assert.ok(part.positions.every(Number.isFinite));
        assert.ok(part.normals.every(Number.isFinite));
        assert.ok(part.indices.every(i=>i<part.positions.length/3));
        triangles+=part.indices.length/3;
      }
      assert.equal(triangles,mesh.triangles);
    }
    assert.ok(output.building.exterior.bounds.max[1]<25);
  }
});

test('interior can be disabled without affecting exterior geometry',()=>{
  const withShell=generateBuildingFamily(seeds,DEFAULT_BUILDING_OPTIONS,2);
  const none=generateBuildingFamily(seeds,{...DEFAULT_BUILDING_OPTIONS,
    interior:'none'},2);
  assert.equal(none.building.interior,null);
  assert.deepEqual(none.building.interiorOpenings,[]);
  assert.deepEqual(none.building.exterior,withShell.building.exterior);
  assert.deepEqual(none.building.exteriorOpenings,withShell.building.exteriorOpenings);
});

test('invalid family options and levels fail explicitly',()=>{
  assert.throws(()=>generateBuildingFamily(seeds,DEFAULT_BUILDING_OPTIONS,4),
    /level/);
  assert.throws(()=>validateBuildingOptions({...DEFAULT_BUILDING_OPTIONS,width:35}),
    /width/);
  assert.throws(()=>validateBuildingOptions({...DEFAULT_BUILDING_OPTIONS,
    interior:'furnished'}),/Interior/);
  assert.throws(()=>validateBuildingOptions({...DEFAULT_BUILDING_OPTIONS,
    furniture:true}),/options/);
  assert.throws(()=>validateBuildingOptions({...DEFAULT_BUILDING_OPTIONS,
    roofPitch:NaN}),/roofPitch/);
});

test('seeded facade variation changes the exterior while preserving openings',()=>{
  const a=generateBuildingFamily({structure:1,material:7});
  const b=generateBuildingFamily({structure:2,material:7});
  assert.notDeepEqual(a.building.plan.windows.map(x=>x.center),
    b.building.plan.windows.map(x=>x.center));
  for(const model of [a,b]){
    const exterior=new Set(signature(model.building.exteriorOpenings));
    assert.ok(signature(model.building.interiorOpenings).every(x=>exterior.has(x)));
  }
  const recolored=generateBuildingFamily({structure:1,material:9});
  assert.deepEqual(a.building.exterior,recolored.building.exterior,
    'Changing a model material seed must not silently create a different roof texture');
  assert.deepEqual(a.building.exteriorOpenings,recolored.building.exteriorOpenings);
});

test('evolving building levels have architectural character, not just scaled boxes',()=>{
  const levels=[1,2,3].map(level=>
    generateBuildingFamily(seeds,DEFAULT_BUILDING_OPTIONS,level).building);
  const materials=(mesh:BuildingMesh)=>new Set(mesh.parts.map(part=>part.material));
  for(const level of levels){
    const used=materials(level.exterior);
    for(const name of ['timber','plasterWarm','stone','glass',level.level===1?'roofThatch':'roofClay'])
      assert.ok(used.has(name),'Expected architectural material '+name);
    assert.ok(level.exterior.parts.every(part=>part.uvs.length===
      part.positions.length/3*2));
  }
  assert.equal(levels[0].plan.wing,null,'First level is a simple core volume');
  assert.ok(levels[1].plan.wing,'Upgrades can add architectural volumes');
  assert.ok(levels[2].plan.wing);
  assert.ok(levels[2].plan.jetty>levels[1].plan.jetty);
  assert.ok(levels[2].exterior.triangles>levels[0].exterior.triangles);
  assert.ok(!materials(levels[0].interior!).has('gallery'));
  assert.ok(materials(levels[2].interior!).has('gallery'),
    'An established building should have structural interior circulation');
  assert.ok(levels[2].interior!.bounds.max[1]>levels[0].interior!.bounds.max[1]);
});

test('attached wing never blocks a facade window or invents an interior one',()=>{
  for(const level of [2,3]){
    const model=generateBuildingFamily(seeds,DEFAULT_BUILDING_OPTIONS,level);
    const plan=model.building.plan,wing=plan.wing!;
    assert.ok(!plan.windows.some(o=>o.side==='right'&&o.level<=1&&
      Math.abs(-o.center-wing.z)<wing.depth/2+.56));
    assert.equal(plan.doors.filter(o=>o.side==='right').length,1);
    assert.equal(model.building.interiorOpenings.length,
      plan.openings.filter(o=>o.level===0).length);
    assert.ok(model.building.interior!.parts.some(part=>
      part.material==='innerTimber'));
  }
});

test('authoring materials provide consistent wood, plaster and roof surfaces',()=>{
  assert.equal(buildingSurfaceKind('plasterIvory'),'plaster');
  assert.equal(buildingSurfaceKind('interior'),'plaster');
  assert.equal(buildingSurfaceKind('innerTimber'),'wood');
  assert.equal(buildingSurfaceKind('innerTrim'),'wood');
  assert.equal(buildingSurfaceKind('gallery'),'wood');
  assert.equal(buildingSurfaceKind('roofUnderlay'),'roof');
  assert.equal(buildingSurfaceKind('tileMoss'),'roof');
  assert.equal(buildingSurfaceKind('interiorPlinth'),'stone');
  assert.equal(buildingSurfaceKind('metal'),null);
});
