import test from 'node:test';
import assert from 'node:assert/strict';
import {makePlasterAsset,PLASTER_TEXTURE_SIZE,PLASTER_VIEWS}
  from '../tools/asset-procgen/web/plaster-textures.mjs';

const seeds={structure:47519,pigment:20468,wear:90571};
function capture(recipe=seeds,view='albedo'){
  const asset=makePlasterAsset(recipe);
  const output:{pixels:Uint8ClampedArray|undefined}={pixels:undefined};
  const canvas={width:0,height:0,
    getContext(){return {
      createImageData:(w:number,h:number)=>({data:new Uint8ClampedArray(w*h*4)}),
      putImageData:(image:{data:Uint8ClampedArray})=>{output.pixels=image.data;},
    };},
  };
  asset.paint(canvas as unknown as HTMLCanvasElement,view);
  assert.equal(canvas.width,512);
  assert.equal(canvas.height,512);
  assert.ok(output.pixels);
  return output.pixels;
}
test('lime plaster is a reusable seeded RGBA material with coherent maps',()=>{
  assert.equal(PLASTER_TEXTURE_SIZE,512);
  assert.deepEqual(PLASTER_VIEWS,['albedo','normal','roughness']);
  const material=makePlasterAsset(seeds);
  assert.equal(material.id,'plaster-lime');
  assert.deepEqual(material.sourceSeeds,seeds);
  const albedo=capture(),normal=capture(seeds,'normal'),
    rough=capture(seeds,'roughness');
  assert.deepEqual(albedo,capture());
  assert.notDeepEqual(albedo,normal);
  assert.notDeepEqual(albedo,rough);
  assert.notDeepEqual(albedo,capture({...seeds,structure:47520}));
  assert.notDeepEqual(albedo,capture({...seeds,pigment:20469}));
  assert.notDeepEqual(albedo,capture({...seeds,wear:90572}));
  for(let p=0;p<albedo.length;p+=4){
    assert.equal(albedo[p+3],255);
    assert.equal(normal[p+3],255);
    assert.equal(rough[p+3],255);
    assert.ok(normal[p+2]>=128,'Normals face outward');
    assert.equal(rough[p],rough[p+1]);
    assert.equal(rough[p+1],rough[p+2]);
  }
  assert.throws(()=>makePlasterAsset({...seeds,wear:-1}),/seed/);
  assert.throws(()=>makePlasterAsset({...seeds,pigment:0x100000000}),/seed/);
  assert.throws(()=>material.paint({} as HTMLCanvasElement,'height'),/channel/);
});
test('plaster has readable warm mid-frequency structure and seamless edges',()=>{
  const d=capture(),size=PLASTER_TEXTURE_SIZE;
  const value=(x:number,y:number)=>d[(y*size+x)*4];
  let sum=0,min=255,max=0,du=0,dv=0,seamU=0,seamV=0;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=(y*size+x)*4,v=d[i]!;
    assert.ok(d[i]>=d[i+1]!&&d[i+1]!>=d[i+2]!,
      'Pigment remains a warm lime/sand palette');
    sum+=v;min=Math.min(min,v);max=Math.max(max,v);
    if(x)du+=Math.abs(v-value(x-1,y));
    if(y)dv+=Math.abs(v-value(x,y-1));
    if(x===0)seamU+=Math.abs(v-value(size-1,y));
    if(y===0)seamV+=Math.abs(v-value(x,size-1));
  }
  du/=size*(size-1);dv/=size*(size-1);
  assert.ok(sum/size**2>170,'Plaster must stay fairly light');
  assert.ok(max-min>=25,'Putz darf nicht wie glatte Farbe wirken');
  assert.ok(seamU/size<du*2.5,'No vertical tile seam');
  assert.ok(seamV/size<dv*2.5,'No horizontal tile seam');
});
