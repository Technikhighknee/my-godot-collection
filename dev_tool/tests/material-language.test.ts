import test from 'node:test';
import assert from 'node:assert/strict';
import {MATERIAL_SEED_ROLES,materialSeedStreams,
  materialElementTraits,materialElementWear}
  from '../tools/asset-procgen/web/material-language.mjs';
import {makeRoofAsset}
  from '../tools/asset-procgen/web/roof-textures.mjs';
import {generateStyledClay}
  from '../tools/asset-procgen/web/clay-style-generation.mjs';

test('five material families describe deterministic, independent seed roles',()=>{
  assert.deepEqual(Object.keys(MATERIAL_SEED_ROLES).sort(),
    ['plaster-lime','roof-clay','roof-thatch','stone-rubble','timber-oak']);
  const roof={pattern:90317,color:43091};
  const first=materialSeedStreams('roof-clay',roof);
  assert.deepEqual(first,materialSeedStreams('roof-clay',{...roof}));
  assert.equal(first.form,roof.pattern);
  assert.equal(first.pigment,roof.color);
  assert.equal(first.aging,
    materialSeedStreams('roof-clay',{...roof,color:43092}).aging,
    'Recoloring must not alter the source of weathering');
  const masonry={layout:71803,mineral:30192,weather:58212};
  const a=materialSeedStreams('stone-rubble',masonry);
  assert.deepEqual(a,{form:71803,pigment:30192,aging:58212});
  assert.equal(materialSeedStreams('stone-rubble',
    {...masonry,weather:1}).aging,1);
  assert.throws(()=>materialSeedStreams('stone-rubble',
    {...masonry,weather:-1}),/Seed/);
  assert.throws(()=>materialSeedStreams('unknown' as never,roof),
    /Unknown material/);
});

test('periodic element features keep pigment, geometry and aging separate',()=>{
  const seeds={form:4721,pigment:8112,aging:9103};
  const get=(stream:typeof seeds)=>
    materialElementTraits(2,3,7,8,stream);
  const original=get(seeds);
  assert.deepEqual(original,materialElementTraits(2+7,3-8,7,8,seeds));
  assert.deepEqual(original,materialElementTraits(2-14,3+16,7,8,seeds));
  assert.deepEqual(original,get({...seeds}));
  const recolored=get({...seeds,pigment:8113});
  assert.notEqual(recolored.variation,original.variation);
  assert.equal(recolored.form,original.form);
  assert.equal(recolored.fracture,original.fracture);
  assert.equal(recolored.chipped,original.chipped);
  assert.equal(recolored.age,original.age);
  assert.equal(recolored.deposits,original.deposits);
  const reshaped=get({...seeds,form:4722});
  assert.notEqual(reshaped.form,original.form);
  assert.notEqual(reshaped.fracture,original.fracture);
  assert.equal(reshaped.variation,original.variation);
  assert.equal(reshaped.age,original.age);
  const weathered=get({...seeds,aging:9104});
  assert.notEqual(weathered.age,original.age);
  assert.notEqual(weathered.deposits,original.deposits);
  assert.equal(weathered.form,original.form);
  assert.equal(weathered.variation,original.variation);
  assert.equal(weathered.fracture,original.fracture);
  assert.throws(()=>get({form:1,pigment:2,aging:3})&&
    materialElementTraits(1,1,0,8,seeds),/positive integers/);
});

test('element damage masks are local and independent of tint',()=>{
  const seeds={form:4721,pigment:8112,aging:9103};
  const detail=materialElementTraits(2,3,7,8,seeds);
  for(const [x,y] of [[0,0],[.5,.5],[.9,.8],[1,1]]){
    const a=materialElementWear(detail,x,y);
    const recolored=materialElementWear(materialElementTraits(
      2,3,7,8,{...seeds,pigment:8113}),x,y);
    assert.deepEqual(a,recolored);
    for(const value of Object.values(a))
      assert.ok(Number.isFinite(value)&&value>=0&&value<=1);
  }
  const wet=materialElementWear(
    {...detail,deposits:1,age:1},.04,.93);
  const dry=materialElementWear(
    {...detail,deposits:1,age:1},.5,.08);
  assert.ok(wet.moisture>dry.moisture,
    'Deposits should build up near exposed lower edges');
  const cracked=materialElementWear(
    {...detail,fracture:1,fracturePosition:.5,fractureSkew:0},.5,.5);
  assert.ok(cracked.crack>.5,'Rare seeded cracks need a real crack mask');
});

test('color reseeding cannot move physical clay damage in native studies',()=>{
  for(const style of ['naturalistic-study','watercolor-study'] as const){
    const a=generateStyledClay({pattern:90317,color:43091},style);
    const b=generateStyledClay({pattern:90317,color:43092},style);
    const c=generateStyledClay({pattern:90318,color:43091},style);
    assert.deepEqual(a.height,b.height,
      'Changes in pigment must not change chipped clay relief');
    assert.notDeepEqual(a.albedo,b.albedo,
      'Changes in pigment should recolor the roof');
    assert.notDeepEqual(a.height,c.height,
      'A new shape seed should change the roof silhouette');
    const current=makeRoofAsset('clay',{pattern:90317,color:43091});
    assert.ok(current.kind==='image','Original roof is still available');
  }
});
