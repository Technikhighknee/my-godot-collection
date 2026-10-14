import test from 'node:test';
import assert from 'node:assert/strict';
import {findGenerator,generateAsset}
  from '../tools/asset-procgen/web/generators.mjs';
import type {GeneratedImage} from '../tools/asset-procgen/web/generators.mjs';
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
  const state:{rgba:Uint8ClampedArray}={rgba:new Uint8ClampedArray(0)};
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
    ['hand-painted-study','retro-3d-study',
      'naturalistic-study','watercolor-study']);
  for(const material of cases){
    const generator=findGenerator(material.id);
    assert.ok(generator&&generator.kind==='image');
    assert.deepEqual(generator.studyGeneration?.styles,MATERIAL_STUDY_STYLES);
    const original=generateAsset(generator,{...material.seeds});
    assert.ok(!('sourceStyle' in original),
      'Legacy material recipe must remain unchanged');
    for(const style of MATERIAL_STUDY_STYLES){
      const asset:GeneratedImage=generator.studyGeneration!.generate(
        {...material.seeds},style);
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
    seams(normal.data,normal.width,normal.height);
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
    const seeds:Record<string,number>={...material.seeds};
    const changed={...seeds,[material.pigment]:seeds[material.pigment]!+1};
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
    {pattern:1,color:2},'unknown-style' as never),/style/);
});


test('shape reseeding rebuilds each material while color alone retains geometry',()=>{
  for(const material of cases)for(const style of MATERIAL_STUDY_STYLES){
    const profile=material.id==='timber-oak'?'panel':undefined;
    const original=makeStyledMaterialAsset(material.id,{...material.seeds},style);
    const source:Record<string,number>={...material.seeds};
    const reshaped=makeStyledMaterialAsset(material.id,{
      ...source,[material.shape]:source[material.shape]!+1,
    },style);
    const colorized=makeStyledMaterialAsset(material.id,{
      ...source,[material.pigment]:source[material.pigment]!+1,
    },style);
    const baseNormal=capture(original,'normal',profile).data;
    const changedNormal=capture(reshaped,'normal',profile).data;
    const colorNormal=capture(colorized,'normal',profile).data;
    assert.ok(difference(baseNormal,changedNormal)>.04,
      material.id+' '+style+' must regenerate actual surface relief');
    assert.deepEqual(baseNormal,colorNormal,
      material.id+' '+style+' must keep geometry independent of pigment');
  }
});


test('hand-painted rubble forms horizontal masonry courses, not paving cells',()=>{
  // Measure the spatial arrangement of the darkest quarter of the surface,
  // rather than depending on a particular hard-coded limestone palette.
  const asset=makeStyledMaterialAsset('stone-rubble',
    {layout:71803,mineral:30192,weather:58212},
    'hand-painted-study');
  const {data}=capture(asset,'albedo');
  const histogram=new Uint32Array(256);
  for(let i=0;i<data.length;i+=4){
    const level=data[i]!;
    histogram[level]=(histogram[level]??0)+1;
  }
  let threshold=0,seen=0;
  for(;threshold<255;threshold++){
    seen+=histogram[threshold]!;
    if(seen>=512*512*.25)break;
  }
  const rows=new Float64Array(512),columns=new Float64Array(512);
  for(let y=0;y<512;y++)for(let x=0;x<512;x++)
    if(data[(y*512+x)*4]!<=threshold){
      rows[y]=(rows[y]??0)+1;
      columns[x]=(columns[x]??0)+1;
    }
  const variation=(values:Float64Array)=>{
    let sum=0;
    for(const value of values)sum+=value;
    const mean=sum/values.length;
    let squared=0;
    for(const value of values)squared+=(value-mean)**2;
    return Math.sqrt(squared/values.length);
  };
  assert.ok(variation(rows)>variation(columns)*1.18,
    'Stone joints must predominantly follow laid horizontal courses');
});


test('naturalistic and watercolor rubble retain readable stones without inked joints',()=>{
  // Prevent the previous overly dark stone outlines from returning.
  // The two directions have different intentional pigment ranges, but
  // neither may lose the stone faces in a near-black joint network or
  // wash the entire material into a featureless uniform patch.
  for(const layout of [0,42,71803,88231])
    for(const style of ['naturalistic-study','watercolor-study'] as const){
      const asset=makeStyledMaterialAsset('stone-rubble',
        {layout,mineral:30192,weather:58212},style);
      const {data}=capture(asset,'albedo');
      const histogram=new Uint32Array(256);
      for(let i=0;i<data.length;i+=4){
        const level=data[i]!;
        histogram[level]=(histogram[level]??0)+1;
      }
      const percentile=(fraction:number)=>{
        const target=Math.ceil(data.length/4*fraction);
        let seen=0;
        for(let level=0;level<256;level++){
          seen+=histogram[level]??0;
          if(seen>=target)return level;
        }
        return 255;
      };
      const shadows=percentile(.10);
      const highlights=percentile(.90);
      assert.ok(shadows>(style==='naturalistic-study'?128:163),
        style+' must not draw black masonry joints at seed '+layout);
      assert.ok(highlights-shadows>19,
        style+' must preserve differentiated stone faces at seed '+layout);
    }
});

test('retro rubble reads as stone faces rather than a dark grout network',()=>{
  // The previous native 128px raster consumed about a third of the roof-
  // foundation preview with deep, wide mortar outlines. Test several
  // unrelated structure seeds to avoid overfitting one attractive layout.
  for(const layout of [0,42,71803,1337,88231]){
    const asset=makeStyledMaterialAsset('stone-rubble',
      {layout,mineral:30192,weather:58212},'retro-3d-study');
    const {data}=capture(asset,'albedo');
    let dark=0,veryLight=0;
    for(let i=0;i<data.length;i+=4){
      if(data[i]!<140)dark++;
      if(data[i]!>165)veryLight++;
    }
    const pixels=data.length/4;
    assert.ok(dark/pixels<.17,
      'Retro rubble grout must not dominate the image at seed '+layout);
    assert.ok(veryLight/pixels>.24,
      'Retro rubble must retain readable illuminated stone faces');
  }
});


test('rubble tiles without perceptual border bands in 2x2 repetition',()=>{
  // A previous seam weld made opposite border texels *identical*. It
  // passed ordinary seam tests, but created a uniform blurred stripe at
  // every 2x2 join. Compare boundary energy to regular image-neighbor
  // energy: neither a hard discontinuity nor a flattened stripe is valid.
  const boundaryEnergy=(data:Uint8ClampedArray)=>{
    let wrapX=0,wrapY=0,neighborX=0,neighborY=0;
    const width=512,height=512;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const pixel=data[(y*width+x)*4]!;
      if(x===0)
        wrapX+=Math.abs(pixel-data[(y*width+width-1)*4]!);
      else
        neighborX+=Math.abs(pixel-data[(y*width+x-1)*4]!);
      if(y===0)
        wrapY+=Math.abs(pixel-data[((height-1)*width+x)*4]!);
      else
        neighborY+=Math.abs(pixel-data[((y-1)*width+x)*4]!);
    }
    return [
      (wrapX/height)/(neighborX/(height*(width-1))),
      (wrapY/width)/(neighborY/(width*(height-1))),
    ];
  };
  for(const layout of [0,42,71803,88231]){
    for(const style of MATERIAL_STUDY_STYLES){
      const asset=makeStyledMaterialAsset('stone-rubble',
        {layout,mineral:30192,weather:58212},style);
      for(const view of ['albedo','normal','roughness'] as const){
        const {data}=capture(asset,view);
        for(const energy of boundaryEnergy(data)){
          assert.ok(energy>.08,
            'Do not mirror-weld '+view+' borders into a visible flat band');
          assert.ok(energy<2.2,
            '2x2 tiling must not introduce a hard '+view+' seam');
        }
      }
    }
  }
});
