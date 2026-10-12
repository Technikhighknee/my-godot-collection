import test from 'node:test';
import assert from 'node:assert/strict';
import {generateOakSprig,paintOakSprig,OAK_SPRIG_SIZE}
  from '../tools/asset-procgen/web/oak-sprig.mjs';

test('single oak spray grows reproducible finite 3D paths and blades',()=>{
  assert.equal(OAK_SPRIG_SIZE,768);
  for(const structureSeed of [0,1,19461,4294967295]){
    const spray=generateOakSprig({structureSeed,leafSeed:21749});
    assert.deepEqual(spray,generateOakSprig({structureSeed,leafSeed:21749}));
    assert.equal(spray.paths.length,4);
    assert.equal(spray.leaves.length,11);
    for(const path of spray.paths){
      assert.ok(path.radius>0);
      assert.ok(path.points.length>=12);
      for(const point of path.points)
        assert.ok(point.length===3&&point.every(Number.isFinite));
    }
    for(const leaf of spray.leaves){
      for(const vector of [leaf.attach,leaf.base,leaf.forward,
        leaf.side,leaf.normal]){
        assert.equal(vector.length,3);
        assert.ok(vector.every(Number.isFinite));
      }
      assert.ok(leaf.size>.2&&leaf.size<.5);
      assert.ok(Number.isInteger(leaf.profileSeed));
      assert.ok(leaf.profileSeed>=0&&leaf.profileSeed<=0xffffffff);
    }
  }
});
test('structure and leaf-appearance seeds vary independently',()=>{
  const baseline=generateOakSprig({structureSeed:19461,leafSeed:21749});
  const leafVariation=generateOakSprig({
    structureSeed:19461,leafSeed:21750});
  const twigVariation=generateOakSprig({
    structureSeed:19462,leafSeed:21749});
  assert.deepEqual(leafVariation.paths,baseline.paths,
    'Changing appearance cannot change twig geometry');
  assert.notDeepEqual(leafVariation.leaves,baseline.leaves);
  assert.notDeepEqual(twigVariation.paths,baseline.paths);
  assert.deepEqual(
    twigVariation.leaves.map(l=>[l.profileSeed,l.shade,l.age,l.size]),
    baseline.leaves.map(l=>[l.profileSeed,l.shade,l.age,l.size]),
    'Changing twig geometry preserves generated leaf profiles and color');
  assert.deepEqual(generateOakSprig(),baseline);
});
test('spray seeds are validated at both unsigned 32-bit boundaries',()=>{
  for(const bad of [-1,4294967296,NaN,Infinity,1.5]){
    assert.throws(()=>generateOakSprig({structureSeed:bad}));
    assert.throws(()=>generateOakSprig({leafSeed:bad}));
  }
});
test('isolated 3D twig bakes all leaves to transparent RGBA Canvas',()=>{
  const calls={gradient:0,fill:0,stroke:0,clip:0,save:0,restore:0,clear:0,
    transforms:[] as number[][]};
  const gradient={addColorStop(_t:number,_color:string){}};
  const context=new Proxy({} as CanvasRenderingContext2D,{
    get(_target,key){
      if(key==='createLinearGradient')
        return ()=>{calls.gradient++;return gradient;};
      if(key==='transform')
        return (...args:number[])=>{calls.transforms.push(args);};
      if(key==='save')return ()=>{calls.save++;};
      if(key==='restore')return ()=>{calls.restore++;};
      if(key==='fill')return ()=>{calls.fill++;};
      if(key==='stroke')return ()=>{calls.stroke++;};
      if(key==='clip')return ()=>{calls.clip++;};
      if(key==='clearRect')return ()=>{calls.clear++;};
      return ()=>{};
    },
    set(){return true;},
  });
  const canvas={width:0,height:0,getContext:(type:string)=>{
    assert.equal(type,'2d');return context;
  }} as unknown as HTMLCanvasElement;
  const source=generateOakSprig();
  const snapshot=structuredClone(source);
  assert.deepEqual(paintOakSprig(canvas,source),
    {size:768,leaves:11,branches:4});
  assert.deepEqual(source,snapshot,'Painting must not mutate 3D geometry');
  assert.equal(canvas.width,768);
  assert.equal(canvas.height,768);
  assert.equal(calls.clear,1,'The output has a transparent starting canvas');
  assert.equal(calls.gradient,11,'One shaded blade per leaf');
  assert.equal(calls.clip,11,'Grain is clipped to each lamina');
  assert.ok(calls.stroke>850,'Visible stems, veins and fine texture');
  assert.ok(calls.fill>=22);
  assert.equal(calls.save,calls.restore);
  assert.equal(calls.transforms.length,1);
  assert.ok(calls.transforms[0]!.every(Number.isFinite));
  assert.throws(()=>paintOakSprig(null as never,source));
});
