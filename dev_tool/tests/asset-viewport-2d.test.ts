import test from 'node:test';
import assert from 'node:assert/strict';
import {imageFitScale,validateImageAsset}
  from '../tools/asset-procgen/web/viewport-2d.mjs';

test('image fit is bounded, never enlarges pixels, and handles unusual aspect ratios',()=>{
  assert.equal(imageFitScale(1024,1024,512,768),.5);
  assert.equal(imageFitScale(256,256,1500,1500),1);
  assert.equal(imageFitScale(2048,256,512,1024),.25);
  assert.equal(imageFitScale(256,2048,1024,512),.25);
  assert.equal(imageFitScale(4096,4096,1,1),.05);
  for(const invalid of [0,-1,NaN,Infinity])
    assert.throws(()=>imageFitScale(256,256,invalid,500));
});
test('2D viewport validates payloads before touching the visible canvas',()=>{
  const asset={id:'test',kind:'image',width:1024,height:1024,
    channels:'RGBA',tiles:16,paint(){return null;}};
  assert.equal(validateImageAsset(asset),asset);
  for(const bad of [null,{}, {...asset,width:0}, {...asset,height:5000},
    {...asset,width:Infinity},{...asset,height:1.5},
    {...asset,paint:null},{...asset,tiles:0},{...asset,kind:'model'}])
    assert.throws(()=>validateImageAsset(bad));
});
