import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_BUILDING_OPTIONS,validateBuildingOptions,generateBuildingFamily}
  from '../tools/asset-procgen/web/building.mjs';
import {findGenerator,generateAsset}
  from '../tools/asset-procgen/web/generators.mjs';

const seeds={structure:19043,material:62191};
const signature=o=>o.map(v=>[
  v.side,v.type,v.level,v.center,v.width,v.bottom,v.top,
].join(':'));
const allParts=mesh=>mesh.parts.flatMap(part=>[part]);

test('three levels share one procedural family and are deterministic',()=>{
  const definition=findGenerator('timber-building');
  assert.ok(definition);
  assert.equal(definition.kind,'model');
  assert.deepEqual(definition.defaultOptions,DEFAULT_BUILDING_OPTIONS);
  const sizes=[];
  for(let level=1;level<=3;level++){
    const a=generateAsset(definition,seeds,DEFAULT_BUILDING_OPTIONS,level);
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
      assert.ok(known.has(signature([opening] as never[])[0]),
        'Interior cannot invent an opening: '+JSON.stringify(opening));
      assert.equal(opening.level,0,'Detached interior shell is ground floor only');
    }
    assert.deepEqual(signature(interiorOpenings),
      signature(exteriorOpenings.filter(o=>o.level===0)));
    assert.equal(plan.doors.length,1);
    assert.equal(plan.doors[0].side,'front');
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
