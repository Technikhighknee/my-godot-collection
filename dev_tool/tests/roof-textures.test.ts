import test from 'node:test';
import assert from 'node:assert/strict';
import {ROOF_TEXTURE_SIZE,ROOF_VIEWS,makeRoofAsset,paintRoofTexture}
  from '../tools/asset-procgen/web/roof-textures.mjs';

function capture(kind:'clay'|'thatch',seeds:{pattern:number;color:number},
  view='albedo'){
  let data:Uint8ClampedArray|null=null;
  const canvas={
    width:0,height:0,
    getContext(){return {
      createImageData:(width:number,height:number)=>({
        data:new Uint8ClampedArray(width*height*4),
      }),
      putImageData(image:{data:Uint8ClampedArray}){data=image.data;},
    };},
  };
  paintRoofTexture(canvas as unknown as HTMLCanvasElement,kind,seeds,view);
  assert.equal(canvas.width,ROOF_TEXTURE_SIZE);
  assert.equal(canvas.height,ROOF_TEXTURE_SIZE);
  assert.ok(data);
  return data;
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
