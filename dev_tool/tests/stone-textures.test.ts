import test from 'node:test';
import assert from 'node:assert/strict';
import {makeStoneAsset,STONE_TEXTURE_SIZE,STONE_VIEWS}
  from '../tools/asset-procgen/web/stone-textures.mjs';

const seeds={layout:71803,mineral:30192,weather:58212};
function mockCanvas(){
  let pixels:Uint8ClampedArray|undefined;
  const canvas={width:0,height:0,
    getContext(){return {
      createImageData:(w:number,h:number)=>({
        data:new Uint8ClampedArray(w*h*4)}),
      putImageData:(image:{data:Uint8ClampedArray})=>{pixels=image.data;},
    };},
  };
  return {canvas,pixels:()=>{assert.ok(pixels);return pixels;}};
}
function render(source=seeds,view='albedo'){
  const mock=mockCanvas();
  makeStoneAsset(source).paint(mock.canvas as unknown as HTMLCanvasElement,view);
  assert.equal(mock.canvas.width,STONE_TEXTURE_SIZE);
  assert.equal(mock.canvas.height,STONE_TEXTURE_SIZE);
  return mock.pixels();
}

test('masonry is an opaque seed-reproducible PBR material',()=>{
  assert.equal(STONE_TEXTURE_SIZE,512);
  assert.deepEqual(STONE_VIEWS,['albedo','normal','roughness']);
  const asset=makeStoneAsset(seeds);
  assert.equal(asset.id,'stone-rubble');
  assert.deepEqual(asset.sourceSeeds,seeds);
  const canvas=mockCanvas();
  asset.paint(canvas.canvas as unknown as HTMLCanvasElement,'albedo');
  const albedo=canvas.pixels();
  asset.paint(canvas.canvas as unknown as HTMLCanvasElement,'normal');
  const normal=canvas.pixels();
  asset.paint(canvas.canvas as unknown as HTMLCanvasElement,'roughness');
  const roughness=canvas.pixels();
  assert.deepEqual(albedo,render());
  assert.notDeepEqual(albedo,normal);
  assert.notDeepEqual(albedo,roughness);
  for(let p=0;p<albedo.length;p+=4){
    assert.equal(albedo[p+3],255);
    assert.equal(normal[p+3],255);
    assert.equal(roughness[p+3],255);
    assert.ok(normal[p+2]>=128,'Stone normals must face outwards');
    assert.equal(roughness[p],roughness[p+1]);
    assert.equal(roughness[p],roughness[p+2]);
  }
  assert.throws(()=>asset.paint({} as HTMLCanvasElement,'height'),/map/);
  assert.throws(()=>makeStoneAsset({...seeds,layout:-1}),/seed/);
  assert.throws(()=>makeStoneAsset({...seeds,mineral:0x100000000}),/seed/);
  assert.throws(()=>makeStoneAsset({...seeds,weather:NaN}),/seed/);
});

test('irregular rubble stones have readable recessed joints, bevels and no tile seams',()=>{
  const d=render(),size=STONE_TEXTURE_SIZE;
  const sample=(x:number,y:number)=>d[(y*size+x)*4]!;
  let sum=0,min=255,max=0,across=0,along=0,seamU=0,seamV=0;
  let dark=0,light=0;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const v=sample(x,y);
    sum+=v;min=Math.min(min,v);max=Math.max(max,v);
    if(v<120)dark++;
    if(v>170)light++;
    if(x)across+=Math.abs(v-sample(x-1,y));
    if(y)along+=Math.abs(v-sample(x,y-1));
    if(x===0)seamU+=Math.abs(v-sample(size-1,y));
    if(y===0)seamV+=Math.abs(v-sample(x,size-1));
  }
  const n=size*size;
  across/=size*(size-1);along/=size*(size-1);
  assert.ok(max-min>90,'Individual stone and mortar should read separately');
  assert.ok(sum/n>112&&sum/n<180,'Use a credible grey-buff mineral palette');
  assert.ok(dark/n>.04&&light/n>.04,
    'Recessed mortar and raised stones must both remain visible');
  assert.ok(seamU/size<across*2.5,'No horizontal tile edge');
  assert.ok(seamV/size<along*2.5,'No vertical tile edge');
  assert.ok(across/along>.65&&across/along<1.5,
    'Irregular stone must not look like strongly directional floorboards');
});

test('layout, mineral and weather seeds vary independently',()=>{
  const original=render();
  for(const key of ['layout','mineral','weather'] as const){
    const variant=render({...seeds,[key]:seeds[key]+1});
    let differences=0;
    for(let i=0;i<original.length;i+=32)
      if(original[i]!==variant[i])differences++;
    assert.ok(differences>1000,'Seed must change the material: '+key);
  }
});
