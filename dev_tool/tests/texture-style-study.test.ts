import test from 'node:test';
import assert from 'node:assert/strict';
import {findGenerator,generateAsset}
  from '../tools/asset-procgen/web/generators.mjs';
import {STUDY_STYLES,STUDY_MATERIALS,applyTextureStudyStyle,
  studySeeds,reseedStudySeeds}
  from '../tools/asset-procgen/web/texture-style-study.mjs';

test('five real texture generators make a consistent non-persistent study board',()=>{
  assert.deepEqual(STUDY_STYLES.map(s=>s.id),[
    'current','classic-strategy-study','naturalistic-study',
    'hand-painted-study','retro-3d-study','watercolor-study',
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
  for(const material of STUDY_MATERIALS)for(const style of STUDY_STYLES){
    const n=applyTextureStudyStyle(material.id,
      style.id,'normal',normals);
    const r=applyTextureStudyStyle(material.id,
      style.id,'roughness',rough);
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


test('classic strategy study visibly repaints even flat material surfaces',()=>{
  const width=96,height=96;
  const pixels=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<pixels.length;i+=4)
    pixels.set([145,130,111,255],i);
  for(const material of STUDY_MATERIALS){
    const options={width,height,seed:7419};
    const left=applyTextureStudyStyle(material.id,'current','albedo',
      pixels,options);
    const right=applyTextureStudyStyle(material.id,
      'classic-strategy-study','albedo',pixels,options);
    let lo=255,hi=0,sum=0;
    for(let i=0;i<right.length;i+=4){
      lo=Math.min(lo,right[i]!);
      hi=Math.max(hi,right[i]!);
      sum+=Math.abs(right[i]!-left[i]!);
    }
    assert.ok(hi-lo>55,
      material.id+' must have large-scale painterly material detail');
    assert.ok(sum/(width*height)>12,
      material.id+' must be visibly different from the current material');
    assert.deepEqual(right,applyTextureStudyStyle(material.id,
      'classic-strategy-study','albedo',pixels,options));
    assert.deepEqual(left,pixels);
  }
});

test('every art direction has a reproducible distinct color language',()=>{
  const width=96,height=96;
  const source=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<source.length;i+=4)
    source.set([148,132,109,255],i);
  for(const material of STUDY_MATERIALS){
    const signatures=new Set<string>();
    for(const style of STUDY_STYLES){
      const options={width,height,seed:29181};
      const pixels=applyTextureStudyStyle(material.id,style.id,
        'albedo',source,options);
      const again=applyTextureStudyStyle(material.id,style.id,
        'albedo',source,options);
      assert.deepEqual(pixels,again,'Style must reproduce: '+style.id);
      assert.ok(pixels.every((v,i)=>i%4!==3||v===255));
      let a=0,b=0,c=0;
      for(let i=0;i<pixels.length;i+=4){
        a+=pixels[i]!;b+=pixels[i+1]!;c+=pixels[i+2]!;
      }
      const sig=[a,b,c].map(x=>Math.round(x/(width*height))).join(',');
      assert.ok(!signatures.has(sig),'Two styles have the same material palette: '+
        material.id+' '+style.id);
      signatures.add(sig);
    }
    assert.equal(signatures.size,STUDY_STYLES.length);
  }
});

test('retro study uses stable blocky texels and quantized colors',()=>{
  const width=96,height=96;
  const source=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4;
    source.set([80+x%27,105+y%31,150+(x+y)%37,255],i);
  }
  const retro=applyTextureStudyStyle('roof-clay','retro-3d-study','albedo',
    source,{width,height,seed:22});
  const block=3; // 96 / 32
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4;
    assert.equal(retro[i]%35,0);
    assert.equal(retro[i+1]!%35,0);
    assert.equal(retro[i+2]!%35,0);
    if(x%block!==0)assert.deepEqual(
      [...retro.slice(i,i+3)], [...retro.slice(i-4,i-1)]);
    if(y%block!==0)assert.deepEqual(
      [...retro.slice(i,i+3)],
      [...retro.slice(i-width*4,i-width*4+3)]);
  }
});

test('style previews validate pixel dimensions and do not mutate source',()=>{
  const source=new Uint8ClampedArray(5*3*4);
  for(let i=0;i<source.length;i+=4)
    source.set([144,138,120,255],i);
  const original=new Uint8ClampedArray(source);
  assert.throws(()=>applyTextureStudyStyle('roof-clay',
    'naturalistic-study','albedo',source,{width:3,height:3}),
    /dimensions/);
  for(const style of STUDY_STYLES)for(const material of STUDY_MATERIALS){
    const output=applyTextureStudyStyle(material.id,style.id,
      'albedo',source,{width:5,height:3,seed:123});
    assert.equal(output.length,source.length);
    assert.ok(output.every((v,i)=>i%4!==3||v===255));
    assert.deepEqual(source,original);
  }
});
