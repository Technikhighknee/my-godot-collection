import test from 'node:test';
import assert from 'node:assert/strict';
import {findGenerator,generateAsset}
  from '../tools/asset-procgen/web/generators.mjs';
import {MATERIAL_STUDY_STYLES,makeStyledMaterialAsset}
  from '../tools/asset-procgen/web/material-style-generation.mjs';

const cases=[
  {id:'roof-thatch',seeds:{pattern:18174,color:23512},shape:'pattern',pigment:'color'},
  {id:'timber-oak',seeds:{grain:37821,color:19257},shape:'grain',pigment:'color'},
  {id:'plaster-lime',seeds:{structure:47519,pigment:20468,wear:90571},
    shape:'structure',pigment:'pigment'},
  {id:'stone-rubble',seeds:{layout:71803,mineral:30192,weather:58212},
    shape:'layout',pigment:'mineral'},
] as const;
type Channel='albedo'|'normal'|'roughness';

function capture(asset:{paint:(canvas:HTMLCanvasElement,view?:string,
  profile?:string)=>unknown},view:Channel,profile?:string){
  const state={rgba:new Uint8ClampedArray(0)};
  const canvas={width:0,height:0,
    getContext(){return{
      createImageData:(w:number,h:number)=>({data:new Uint8ClampedArray(w*h*4)}),
      putImageData:(image:{data:Uint8ClampedArray})=>{
        state.rgba=image.data;
      },
    };},
  };
  asset.paint(canvas as unknown as HTMLCanvasElement,view,profile);
  assert.ok(canvas.width>0&&canvas.height>0);
  assert.equal(state.rgba.length,canvas.width*canvas.height*4);
  return {...canvas,data:state.rgba};
}
function difference(a:Uint8ClampedArray,b:Uint8ClampedArray){
  assert.equal(a.length,b.length);
  let count=0;
  for(let i=0;i<a.length;i+=16)if(a[i]!==b[i])count++;
  return count/(a.length/16);
}
function seams(data:Uint8ClampedArray,width:number,height:number){
  const sample=(x:number,y:number)=>data[(y*width+x)*4]!;
  let su=0,sv=0,au=0,av=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const pixel=sample(x,y);
    if(x===0)su+=Math.abs(pixel-sample(width-1,y));
    else au+=Math.abs(pixel-sample(x-1,y));
    if(y===0)sv+=Math.abs(pixel-sample(x,height-1));
    else av+=Math.abs(pixel-sample(x,y-1));
  }
  assert.ok(su/height<=au/(height*(width-1))*2.5,
    'Left/right seam should be continuous');
  assert.ok(sv/width<=av/(width*(height-1))*2.5,
    'Top/bottom seam should be continuous');
}
test('every study material has two native visual grammars without changing defaults',()=>{
  assert.deepEqual(MATERIAL_STUDY_STYLES,
    ['hand-painted-study','retro-3d-study']);
  for(const material of cases){
    const generator=findGenerator(material.id);
    assert.ok(generator&&generator.kind==='image');
    assert.deepEqual(generator.studyGeneration?.styles,MATERIAL_STUDY_STYLES);
    const original=generateAsset(generator,{...material.seeds});
    assert.ok(!('sourceStyle' in original),
      'Legacy material recipe must remain unchanged');
    for(const style of MATERIAL_STUDY_STYLES){
      const asset=generator.studyGeneration!.generate({...material.seeds},style);
      assert.equal(asset.kind,'image');
      assert.equal(asset.id,material.id);
      assert.ok('sourceStyle' in asset);
      assert.equal(asset.sourceStyle,style);
      assert.ok('sourceSeeds' in asset);
      assert.deepEqual(asset.sourceSeeds,material.seeds);
    }
  }
});
test('new material styles generate matching RGB, height normals and roughness',()=>{
  for(const material of cases)for(const style of MATERIAL_STUDY_STYLES){
    const asset=makeStyledMaterialAsset(material.id,{...material.seeds},style);
    const profile=material.id==='timber-oak'?'panel':undefined;
    const albedo=capture(asset,'albedo',profile);
    const normal=capture(asset,'normal',profile);
    const roughness=capture(asset,'roughness',profile);
    assert.equal(albedo.width,512);assert.equal(albedo.height,512);
    assert.equal(normal.width,512);assert.equal(roughness.width,512);
    let change=0,direction=0;
    for(let i=0;i<albedo.data.length;i+=4){
      assert.equal(albedo.data[i+3],255);
      assert.equal(normal.data[i+3],255);
      assert.ok(normal.data[i+2]!>=128,'Normal must point outward');
      assert.equal(roughness.data[i+3],255);
      assert.equal(roughness.data[i],roughness.data[i+1]);
      assert.equal(roughness.data[i],roughness.data[i+2]);
      if(albedo.data[i]!==albedo.data[i+1])change++;
      if(normal.data[i]!==128||normal.data[i+1]!==128)direction++;
    }
    assert.ok(change>5000,'Material needs a distinct pigment palette');
    assert.ok(direction>5000,'Material must generate relief, not flat RGB');
    seams(albedo.data,albedo.width,albedo.height);
    seams(roughness.data,roughness.width,roughness.height);
    assert.ok(difference(albedo.data,capture(asset,'albedo',profile).data)===0,
      'Same recipe must reproduce exactly');
    if(style==='retro-3d-study'){
      for(let y=0;y<512;y+=4)for(let x=0;x<512;x+=4){
        const p=(y*512+x)*4,q=((y+3)*512+(x+3))*4;
        for(let c=0;c<3;c++){
          assert.equal(albedo.data[p+c],albedo.data[q+c]);
          assert.equal(normal.data[p+c],normal.data[q+c]);
        }
      }
    }
  }
});
test('pigment reseeding does not alter the native material relief',()=>{
  for(const material of cases){
    const style='hand-painted-study';
    const a=makeStyledMaterialAsset(material.id,{...material.seeds},style);
    const changed={...material.seeds,
      [material.pigment]:material.seeds[material.pigment]+1};
    const b=makeStyledMaterialAsset(material.id,changed,style);
    const profile=material.id==='timber-oak'?'panel':undefined;
    const normalA=capture(a,'normal',profile);
    const normalB=capture(b,'normal',profile);
    assert.deepEqual(normalA.data,normalB.data,
      'Recoloring must preserve '+material.id+' material structure');
    assert.ok(difference(capture(a,'albedo',profile).data,
      capture(b,'albedo',profile).data)>.03,
      'Changing the pigment seed must change '+material.id+' color');
  }
});
test('all three oak cuts preserve native shapes and dimensions',()=>{
  const asset=makeStyledMaterialAsset('timber-oak',
    {grain:37821,color:19257},'retro-3d-study');
  for(const [profile,height] of [
    ['beam',2048],['panel',512],['end',512],
  ] as const){
    const image=capture(asset,'albedo',profile);
    assert.equal(image.width,512);
    assert.equal(image.height,height);
  }
  assert.throws(()=>capture(asset,'albedo','nope'),/profile/);
  assert.throws(()=>makeStyledMaterialAsset('stone-rubble',
    {layout:-1,mineral:5,weather:6},'retro-3d-study'),/seed/);
  assert.throws(()=>makeStyledMaterialAsset('roof-thatch',
    {pattern:1,color:2},'watercolor-study' as never),/style/);
});
