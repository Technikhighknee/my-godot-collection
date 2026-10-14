import test from 'node:test';
import assert from 'node:assert/strict';
import {STUDY_STYLES,STUDY_MATERIALS}
  from '../tools/asset-procgen/web/texture-style-study.mjs';
import {textureStudyExportLayout,drawTextureStudyExport,
  textureStudyExportFilename}
  from '../tools/asset-procgen/web/texture-study-export.mjs';

function fixture(){
  const calls:{
    images:{source:unknown;x:number;y:number;width:number;height:number;smooth:boolean}[];
    labels:string[];rects:number;
  }={images:[],labels:[],rects:0};
  let smoothing=true;
  const ctx={
    fillStyle:'',font:'',textBaseline:'',
    set imageSmoothingEnabled(value:boolean){smoothing=value;},
    get imageSmoothingEnabled(){return smoothing;},
    imageSmoothingQuality:'high',
    fillRect(){calls.rects++;},
    fillText(text:string){calls.labels.push(text);},
    measureText(text:string){return {width:text.length*8};},
    drawImage(source:unknown,x:number,y:number,width:number,height:number){
      calls.images.push({source,x,y,width,height,smooth:smoothing});
    },
  };
  const output={width:0,height:0,getContext:()=>ctx};
  const cells=new Map<string,{canvas:HTMLCanvasElement;
    info:{textContent:string}}>();
  for(const material of STUDY_MATERIALS)
    for(const style of STUDY_STYLES){
      const canvas={width:384,height:384,source:material.id+'/'+style.id};
      cells.set(material.id+'/'+style.id,{
        canvas:canvas as unknown as HTMLCanvasElement,
        info:{textContent:'512 × 512 · material preview'},
      });
    }
  return {output,calls,cells};
}

test('full PNG layout includes every selected style even beyond scroll viewport',()=>{
  const layout=textureStudyExportLayout(STUDY_STYLES,STUDY_MATERIALS);
  assert.ok(layout.width>=2200&&layout.height>=1900);
  assert.ok(layout.width<4000&&layout.height<4000);
  const {output,calls,cells}=fixture();
  assert.deepEqual(drawTextureStudyExport(
    output as unknown as HTMLCanvasElement,{
      styles:STUDY_STYLES,materials:STUDY_MATERIALS,cells,
      view:'normal',profile:'beam',seed:28591,tiling:true,
    }),layout);
  assert.equal(output.width,layout.width);
  assert.equal(output.height,layout.height);
  assert.equal(calls.images.length,STUDY_STYLES.length*STUDY_MATERIALS.length);
  assert.equal(new Set(calls.images.map(i=>i.source)).size,calls.images.length);
  assert.ok(calls.images.every(i=>i.width===layout.imageSize&&
    i.height===layout.imageSize));
  assert.ok(calls.labels.some(s=>s.includes('Texture Style Study')));
  assert.ok(calls.labels.some(s=>s.includes('Master seed: 28591')));
  assert.ok(calls.labels.some(s=>s.includes('Tiling: 2 × 2')));
  assert.ok(calls.labels.some(s=>s.includes('NORMAL')));
  assert.ok(calls.labels.some(s=>s.includes('Long grain')));
  for(const material of STUDY_MATERIALS)
    assert.ok(calls.labels.includes(material.label));
  for(const style of STUDY_STYLES)
    assert.ok(calls.labels.includes(style.label));
  for(const image of calls.images){
    const style=(image.source as {source:string}).source.split('/')[1];
    if(style==='retro-3d-study')assert.equal(image.smooth,false,
      'Retro preview must use nearest neighbor sampling');
    else assert.equal(image.smooth,true);
  }
});

test('export only contains visible style columns while retaining current',()=>{
  const selected=STUDY_STYLES.filter(s=>
    ['current','naturalistic-study','watercolor-study'].includes(s.id));
  const fixtureState=fixture();
  const layout=drawTextureStudyExport(
    fixtureState.output as unknown as HTMLCanvasElement,{
      styles:selected,materials:STUDY_MATERIALS,cells:fixtureState.cells,
      view:'albedo',profile:'panel',seed:null,tiling:false,
    });
  assert.equal(fixtureState.calls.images.length,selected.length*
    STUDY_MATERIALS.length);
  assert.ok(layout.width<textureStudyExportLayout(
    STUDY_STYLES,STUDY_MATERIALS).width);
  assert.ok(fixtureState.calls.labels.some(s=>s.includes('Reference seeds')));
  assert.equal(textureStudyExportFilename({
    view:'albedo',seed:null,styles:selected,
  }),'1400-texture-style-study-albedo-reference-3-styles.png');
  assert.equal(textureStudyExportFilename({
    view:'normal',seed:28591,styles:selected,
  }),'1400-texture-style-study-normal-seed-28591-3-styles.png');
});

test('export refuses missing previews rather than silently drawing blanks',()=>{
  const fixtureState=fixture();
  fixtureState.cells.delete('roof-clay/retro-3d-study');
  assert.throws(()=>drawTextureStudyExport(
    fixtureState.output as unknown as HTMLCanvasElement,{
      styles:STUDY_STYLES,materials:STUDY_MATERIALS,
      cells:fixtureState.cells,
    }),/Missing rendered preview: roof-clay \/ retro-3d-study/);
  assert.equal(fixtureState.output.width,0);
  assert.equal(fixtureState.calls.images.length,0);
  assert.throws(()=>textureStudyExportLayout([],STUDY_MATERIALS),
    /at least one/);
  assert.throws(()=>textureStudyExportLayout(STUDY_STYLES,[]),
    /No materials/);
});
