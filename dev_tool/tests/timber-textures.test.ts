import test from 'node:test';
import assert from 'node:assert/strict';
import {TIMBER_TEXTURE_SIZE,TIMBER_VIEWS,TIMBER_PROFILES,makeTimberAsset,paintTimberTexture}
  from '../tools/asset-procgen/web/timber-textures.mjs';

function capture(seeds:{grain:number;color:number},view='albedo',profile='beam'){
  const result:{bytes:Uint8ClampedArray|null}={bytes:null};
  const canvas={
    width:0,height:0,
    getContext(){return {
      createImageData:(w:number,h:number)=>({
        data:new Uint8ClampedArray(w*h*4)}),
      putImageData(image:{data:Uint8ClampedArray}){result.bytes=image.data;},
    };},
  };
  paintTimberTexture(canvas as unknown as HTMLCanvasElement,seeds,view,profile);
  assert.equal(canvas.width,512);
  assert.equal(canvas.height,512);
  assert.ok(result.bytes);
  return result.bytes;
}
test('timber creates deterministic independent PBR textures',()=>{
  assert.equal(TIMBER_TEXTURE_SIZE,512);
  assert.deepEqual(TIMBER_VIEWS,['albedo','normal','roughness']);
  assert.deepEqual(TIMBER_PROFILES,['beam','end','panel']);
  const seeds={grain:37821,color:19257};
  const albedo=capture(seeds);
  assert.deepEqual(albedo,capture(seeds));
  assert.notDeepEqual(albedo,capture({...seeds,grain:37822}));
  assert.notDeepEqual(albedo,capture({...seeds,color:19258}));
  assert.equal(makeTimberAsset(seeds).kind,'image');
  const normal=capture(seeds,'normal'),rough=capture(seeds,'roughness');
  assert.notDeepEqual(albedo,normal);
  assert.notDeepEqual(normal,rough);
  assert.notDeepEqual(normal,capture({...seeds,grain:37822},'normal'));
  for(let i=0;i<normal.length;i+=4){
    assert.equal(normal[i+3],255);
    assert.equal(rough[i+3],255);
    assert.ok(normal[i+2]>=128,'Normal must face outwards');
  }
  assert.throws(()=>capture({grain:-1,color:0}),/seed/);
  assert.throws(()=>capture(seeds,'height'),/channel/);
});
test('timber grain follows V and repeats without a hard border',()=>{
  const size=TIMBER_TEXTURE_SIZE;
  const a=capture({grain:37821,color:19257});
  const at=(x:number,y:number)=>a[(y*size+x)*4];
  let across=0,along=0,seamU=0,seamV=0;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    if(x)across+=Math.abs(at(x,y)-at(x-1,y));
    if(y)along+=Math.abs(at(x,y)-at(x,y-1));
    if(!x)seamU+=Math.abs(at(0,y)-at(size-1,y));
    if(!y)seamV+=Math.abs(at(x,0)-at(x,size-1));
  }
  across/=size*(size-1);
  along/=size*(size-1);
  assert.ok(across>along*2,'Wood grain must run along V, not across beams');
  assert.ok(seamU/size<across*2.5,'U seam must remain unobtrusive');
  assert.ok(seamV/size<along*2.5,'V seam must remain unobtrusive');
});


test('shared wood source has different crosscut and broad-face PBR profiles',()=>{
  const seeds={grain:37821,color:19257};
  const asset=makeTimberAsset(seeds);
  assert.deepEqual(asset.profiles,['beam','end','panel']);
  const colors=TIMBER_PROFILES.map(profile=>capture(seeds,'albedo',profile));
  const normals=TIMBER_PROFILES.map(profile=>capture(seeds,'normal',profile));
  const roughness=TIMBER_PROFILES.map(profile=>capture(seeds,'roughness',profile));
  for(let i=0;i<colors.length;i++){
    assert.deepEqual(colors[i],capture(seeds,'albedo',TIMBER_PROFILES[i]));
    assert.notDeepEqual(normals[i],roughness[i]);
    assert.notDeepEqual(normals[i],colors[i]);
  }
  assert.notDeepEqual(colors[0],colors[1],'Ends must show cut growth rings');
  assert.notDeepEqual(colors[0],colors[2],'Broad wood must have a different figure');
  assert.notDeepEqual(colors[1],colors[2]);
  assert.throws(()=>capture(seeds,'albedo','invalid'),/profile/);
  const profiles=new Set(asset.profiles);
  assert.equal(profiles.size,3,'Fixed small profile set, never one texture per beam');
});
