import test from 'node:test';
import assert from 'node:assert/strict';
import {CLAY_GENERATIVE_STYLES,makeRoofAsset,paintRoofTexture}
  from '../tools/asset-procgen/web/roof-textures.mjs';
import {generateStyledClay}
  from '../tools/asset-procgen/web/clay-style-generation.mjs';

const seeds={pattern:90317,color:43091};
type Channel='albedo'|'normal'|'roughness';
type ClayStyle='current'|'hand-painted-study'|'retro-3d-study';

function paint(style:ClayStyle,view:Channel,values=seeds){
  const result:{pixels:Uint8ClampedArray|null}={pixels:null};
  const canvas={width:0,height:0,
    getContext(){return {
      createImageData:(w:number,h:number)=>({data:new Uint8ClampedArray(w*h*4)}),
      putImageData:(image:{data:Uint8ClampedArray})=>{result.pixels=image.data;},
    };},
  };
  const asset=makeRoofAsset('clay',values,style==='current'?
    {}:{style});
  asset.paint(canvas as unknown as HTMLCanvasElement,view);
  assert.equal(canvas.width,512);
  assert.equal(canvas.height,512);
  assert.ok(result.pixels);
  return result.pixels;
}
function fractionDifferent(a:Uint8ClampedArray,b:Uint8ClampedArray){
  assert.equal(a.length,b.length);
  let count=0;
  for(let i=0;i<a.length;i+=4)if(a[i]!==b[i])count++;
  return count/(a.length/4);
}
function seamsAreTileable(image:Uint8ClampedArray){
  const value=(x:number,y:number)=>image[(y*512+x)*4]!;
  let u=0,v=0,adjU=0,adjV=0;
  for(let y=0;y<512;y++)for(let x=0;x<512;x++){
    const p=value(x,y);
    if(x===0)u+=Math.abs(p-value(511,y));
    else adjU+=Math.abs(p-value(x-1,y));
    if(y===0)v+=Math.abs(p-value(x,511));
    else adjV+=Math.abs(p-value(x,y-1));
  }
  const averageU=adjU/(512*511);
  const averageV=adjV/(512*511);
  assert.ok(u/512<averageU*2.5,'U seam must be indistinguishable from tiles');
  assert.ok(v/512<averageV*2.5,'V seam must be indistinguishable from tiles');
}

test('generator-level clay styles retain the exact legacy default',()=>{
  assert.deepEqual(CLAY_GENERATIVE_STYLES,
    ['hand-painted-study','retro-3d-study']);
  const legacy=paint('current','albedo');
  let pixels:Uint8ClampedArray|null=null;
  const canvas={width:0,height:0,
    getContext(){return {
      createImageData:(w:number,h:number)=>({data:new Uint8ClampedArray(w*h*4)}),
      putImageData:(i:{data:Uint8ClampedArray})=>{pixels=i.data;},
    };},
  };
  paintRoofTexture(canvas as unknown as HTMLCanvasElement,'clay',seeds,'albedo');
  assert.deepEqual(pixels,legacy);
  assert.equal(makeRoofAsset('clay',seeds).sourceStyle,undefined);
  assert.deepEqual(makeRoofAsset('clay',seeds).sourceSeeds,seeds);
  assert.throws(()=>paintRoofTexture({} as HTMLCanvasElement,
    'thatch',seeds,'albedo','hand-painted-study'),/Unsupported roof/);
  assert.throws(()=>paintRoofTexture({} as HTMLCanvasElement,
    'clay',seeds,'albedo','invalid'),/Unsupported roof/);
});

test('styles create different actual tile shapes with their own PBR normals',()=>{
  const current=paint('current','albedo');
  const normalCurrent=paint('current','normal');
  const other=new Map<ClayStyle,Uint8ClampedArray>();
  for(const style of CLAY_GENERATIVE_STYLES){
    const type=style as ClayStyle;
    const albedo=paint(type,'albedo');
    const normal=paint(type,'normal');
    const rough=paint(type,'roughness');
    other.set(type,albedo);
    assert.ok(fractionDifferent(current,albedo)>.75,
      style+' must rebuild the painted material, not recolor a few texels');
    assert.ok(fractionDifferent(normalCurrent,normal)>.65,
      style+' must change the underlying bevels and tile shapes');
    seamsAreTileable(albedo);
    for(let i=0;i<normal.length;i+=4){
      assert.equal(albedo[i+3],255);
      assert.equal(normal[i+3],255);
      assert.ok(normal[i+2]>=128,'Normal should face outwards');
      assert.equal(rough[i],rough[i+1]);
      assert.equal(rough[i],rough[i+2]);
      assert.equal(rough[i+3],255);
    }
    const asset=makeRoofAsset('clay',seeds,{style});
    assert.equal(asset.sourceStyle,style);
    assert.deepEqual(asset.sourceSeeds,seeds);
    assert.deepEqual(paint(type,'albedo'),albedo);
  }
  assert.ok(fractionDifferent(other.get('hand-painted-study')!,
    other.get('retro-3d-study')!)>.75);
});

test('each style separates tile structure and pigment seeds',()=>{
  for(const style of CLAY_GENERATIVE_STYLES){
    const a=generateStyledClay(seeds,style);
    const recolored=generateStyledClay({...seeds,color:43092},style);
    const rearranged=generateStyledClay({...seeds,pattern:90318},style);
    assert.deepEqual(a.height,recolored.height,
      'A color-only reseed must preserve tile layout and normal relief');
    assert.notDeepEqual(a.albedo,recolored.albedo);
    assert.notDeepEqual(a.height,rearranged.height);
    assert.equal(a.albedo.length,512*512*3);
    assert.equal(a.height.length,512*512);
    assert.equal(a.roughness.length,512*512);
  }
  assert.throws(()=>generateStyledClay(seeds,'unknown' as never),
    /Unsupported/);
  assert.throws(()=>generateStyledClay({...seeds,pattern:-1},
    'retro-3d-study'),/seed/);
});

test('retro uses discrete texels from its own low-resolution shape raster',()=>{
  const retro=paint('retro-3d-study','albedo');
  const normal=paint('retro-3d-study','normal');
  const value=(data:Uint8ClampedArray,x:number,y:number,c=0)=>
    data[(y*512+x)*4+c]!;
  for(let y=0;y<512;y+=4)for(let x=0;x<512;x+=4){
    for(const c of [0,1,2]){
      assert.equal(value(retro,x,y,c),value(retro,x+3,y+3,c));
      assert.equal(value(normal,x,y,c),value(normal,x+3,y+3,c));
    }
  }
});
