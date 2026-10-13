import test from 'node:test';
import assert from 'node:assert/strict';
import {ROOF_TEXTURE_SIZE,ROOF_VIEWS,makeRoofAsset,paintRoofTexture}
  from '../tools/asset-procgen/web/roof-textures.mjs';

function capture(kind:'clay'|'thatch',seeds:{pattern:number;color:number},
  view='albedo'){
  const result:{data:Uint8ClampedArray|null}={data:null};
  const canvas={
    width:0,height:0,
    getContext(){return {
      createImageData:(width:number,height:number)=>({
        data:new Uint8ClampedArray(width*height*4),
      }),
      putImageData(image:{data:Uint8ClampedArray}){result.data=image.data;},
    };},
  };
  paintRoofTexture(canvas as unknown as HTMLCanvasElement,kind,seeds,view);
  assert.equal(canvas.width,ROOF_TEXTURE_SIZE);
  assert.equal(canvas.height,ROOF_TEXTURE_SIZE);
  assert.ok(result.data);
  return result.data;
}
test('roof materials are project-independent repeatable image generators',()=>{
  assert.deepEqual(ROOF_VIEWS,['albedo','normal','roughness']);
  for(const kind of ['clay','thatch'] as const){
    const seeds={pattern:19,color:23};
    const a=capture(kind,seeds);
    const b=capture(kind,seeds);
    assert.deepEqual(a,b,'Seeds must produce byte-identical roof textures');
    assert.notDeepEqual(a,capture(kind,{pattern:99,color:23}));
    assert.notDeepEqual(a,capture(kind,{pattern:19,color:99}));
    assert.equal(makeRoofAsset(kind,seeds).kind,'image');
    const distinct=new Set<number>();
    for(let i=0;i<a.length;i+=4){
      assert.equal(a[i+3],255);
      distinct.add(a[i]);
    }
    assert.ok(distinct.size>25,'Texture cannot be a flat color');
  }
});
test('roof normal and roughness maps are derived from the same pattern',()=>{
  const seeds={pattern:421,color:837};
  for(const kind of ['clay','thatch'] as const){
    const normal=capture(kind,seeds,'normal');
    const roughness=capture(kind,seeds,'roughness');
    assert.notDeepEqual(normal,roughness);
    for(let i=0;i<normal.length;i+=4){
      assert.equal(normal[i+3],255);
      assert.equal(roughness[i+3],255);
      assert.ok(normal[i+2]>=128,'Normal map must face outwards');
    }
  }
  assert.throws(()=>makeRoofAsset('unknown' as 'clay',{pattern:1,color:2})
    .paint({getContext(){return null;}} as unknown as HTMLCanvasElement),
    /Unsupported|Unknown/);
});


test('thatch is a seamless, fine-grained fiber material without horizontal courses',()=>{
  const size=ROOF_TEXTURE_SIZE;
  const albedo=capture('thatch',{pattern:421,color:837});
  const pixel=(x:number,y:number)=>albedo[(y*size+x)*4];
  let across=0,down=0,leftSeam=0,topSeam=0;
  const rowMeans:number[]=[];
  for(let y=0;y<size;y++){
    let row=0;
    for(let x=0;x<size;x++){
      const value=pixel(x,y);
      row+=value;
      if(x>0)across+=Math.abs(value-pixel(x-1,y));
      if(y>0)down+=Math.abs(value-pixel(x,y-1));
    }
    rowMeans.push(row/size);
    leftSeam+=Math.abs(pixel(0,y)-pixel(size-1,y));
    topSeam+=Math.abs(pixel(y,0)-pixel(y,size-1));
  }
  const meanAcross=across/(size*(size-1));
  const meanDown=down/(size*(size-1));
  assert.ok(meanAcross>meanDown*2,
    'Long downhill fibers should have finer crosswise detail');
  assert.ok(Math.max(...rowMeans)-Math.min(...rowMeans)<14,
    'The old broad, uniform horizontal thatch courses must not return');
  assert.ok(leftSeam/size<meanAcross*2.5,'U must tile without a hard join');
  assert.ok(topSeam/size<meanDown*2.5,'V must tile without a hard join');
  const other=capture('thatch',{pattern:422,color:837});
  assert.notDeepEqual(capture('thatch',{pattern:421,color:837},'normal'),
    capture('thatch',{pattern:422,color:837},'normal'));
  assert.notDeepEqual(capture('thatch',{pattern:421,color:837},'roughness'),
    capture('thatch',{pattern:422,color:837},'roughness'));
  assert.notDeepEqual(albedo,other);
});


test('clay tiles form weathered seamless courses, not flat brick blocks',()=>{
  const seeds={pattern:421,color:837};
  const albedo=capture('clay',seeds,'albedo');
  const normal=capture('clay',seeds,'normal');
  const roughness=capture('clay',seeds,'roughness');
  const size=ROOF_TEXTURE_SIZE;
  // The material must have fine color/height/roughness structure even inside
  // a single tile, not only a different flat fill for each repeating rectangle.
  for(const channel of [albedo,normal,roughness]){
    const samples:number[]=[];
    for(let y=30;y<45;y++)for(let x=13;x<31;x++)
      samples.push(channel[(y*size+x)*4]);
    assert.ok(Math.max(...samples)-Math.min(...samples)>12,
      'Ceramic surface is missing local material detail');
  }
  let seamU=0,seamV=0,neighborU=0,neighborV=0;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const here=albedo[(y*size+x)*4];
    if(x===0)seamU+=Math.abs(here-albedo[(y*size+size-1)*4]);
    else neighborU+=Math.abs(here-albedo[(y*size+x-1)*4]);
    if(y===0)seamV+=Math.abs(here-albedo[((size-1)*size+x)*4]);
    else neighborV+=Math.abs(here-albedo[((y-1)*size+x)*4]);
  }
  const regularU=neighborU/(size*(size-1)),regularV=neighborV/(size*(size-1));
  assert.ok(seamU/size<regularU*2.5,'Visible seam across U repetition');
  assert.ok(seamV/size<regularV*2.5,'Visible seam across V repetition');
  assert.notDeepEqual(normal,capture('clay',{...seeds,pattern:422},'normal'));
  assert.notDeepEqual(roughness,capture('clay',{...seeds,color:838},'roughness'));
});
