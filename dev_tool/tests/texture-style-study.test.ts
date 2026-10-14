import test from 'node:test';
import assert from 'node:assert/strict';
import {findGenerator,generateAsset}
  from '../tools/asset-procgen/web/generators.mjs';
import {STUDY_STYLES,STUDY_MATERIALS,applyTextureStudyStyle,
  studySeeds,reseedStudySeeds}
  from '../tools/asset-procgen/web/texture-style-study.mjs';

test('five real texture generators make a consistent non-persistent study board',()=>{
  assert.deepEqual(STUDY_STYLES.map(s=>s.id),[
    'current','classic-strategy-study',
  ]);
  assert.deepEqual(STUDY_MATERIALS.map(m=>m.id),[
    'roof-thatch','roof-clay','timber-oak','plaster-lime','stone-rubble',
  ]);
  for(const material of STUDY_MATERIALS){
    const def=findGenerator(material.id);
    assert.ok(def&&def.kind==='image');
    const seeds=studySeeds(def);
    assert.deepEqual(Object.keys(seeds),def.components.map(c=>c.id));
    assert.ok(Object.values(seeds).every(Number.isInteger));
    const asset=generateAsset(def,seeds);
    assert.equal(asset.kind,'image');
    assert.equal(asset.id,material.id);
    // Study recipes never introduce a new source style field into persisted
    // generators, so existing project sources and seed formats remain valid.
    assert.ok('sourceSeeds' in asset);
    assert.deepEqual(asset.sourceSeeds,seeds);
    const derived=reseedStudySeeds(def,12345);
    assert.deepEqual(derived,reseedStudySeeds(def,12345));
    assert.notDeepEqual(derived,seeds);
  }
});
test('material-specific albedo direction stays deterministic and keeps alpha',()=>{
  const original=new Uint8ClampedArray([
    80,70,62,255,151,143,132,196,211,181,149,0,246,235,221,255,
  ]);
  for(const material of STUDY_MATERIALS){
    const baseline=applyTextureStudyStyle(material.id,'current','albedo',
      original);
    assert.notEqual(baseline,original,'Reference must not mutate the input');
    assert.deepEqual(baseline,original,'Reference is byte-identical');
    const edited=applyTextureStudyStyle(material.id,
      'classic-strategy-study','albedo',original);
    assert.notDeepEqual(edited,original,'Draft needs an observable visual change');
    assert.deepEqual(edited,applyTextureStudyStyle(material.id,
      'classic-strategy-study','albedo',original));
    for(let i=3;i<original.length;i+=4)
      assert.equal(edited[i],original[i],'Transparent edges must be retained');
  }
  assert.deepEqual(original,new Uint8ClampedArray([
    80,70,62,255,151,143,132,196,211,181,149,0,246,235,221,255,
  ]),'Style previews must not mutate generator output');
});
test('normal and roughness study passes retain physically valid channels',()=>{
  const normals=new Uint8ClampedArray([108,145,252,255,150,115,250,128]);
  const rough=new Uint8ClampedArray([221,221,221,255,242,242,242,128]);
  for(const material of STUDY_MATERIALS){
    const n=applyTextureStudyStyle(material.id,
      'classic-strategy-study','normal',normals);
    const r=applyTextureStudyStyle(material.id,
      'classic-strategy-study','roughness',rough);
    for(let i=0;i<n.length;i+=4){
      assert.ok(n[i+2]>=128,'Tangent-space normal must still point outwards');
      assert.equal(n[i+3],normals[i+3]);
      assert.equal(r[i],r[i+1]);
      assert.equal(r[i],r[i+2]);
      assert.equal(r[i+3],rough[i+3]);
    }
  }
});
test('study rejects unsupported IDs, view types and malformed seed inputs',()=>{
  const rgba=new Uint8ClampedArray(4);
  assert.throws(()=>applyTextureStudyStyle('bogus' as never,'current','albedo',rgba),
    /material/);
  assert.throws(()=>applyTextureStudyStyle('stone-rubble','bogus' as never,'albedo',rgba),
    /style/);
  assert.throws(()=>applyTextureStudyStyle('stone-rubble','current','height' as never,rgba),
    /view/);
  assert.throws(()=>applyTextureStudyStyle('stone-rubble','current',
    'albedo',new Uint8ClampedArray(3)),/RGBA/);
  const def=findGenerator('plaster-lime')!;
  assert.throws(()=>reseedStudySeeds(def,-1),/seed/);
  assert.throws(()=>reseedStudySeeds(def,0x100000000),/seed/);
});
