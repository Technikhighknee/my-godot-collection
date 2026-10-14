// Texture style comparison (experimental, never persisted to asset recipes).
// Left column: untouched material generators. Right: intentionally distinct
// material-specific early-PC-strategy *painted diffuse* art study. Unlike the
// previous minimal RGB correction, it creates seeded pigment fields, coarse
// hand-painted structure and directional fibers per material.
// This is deliberately not a second production texture generator yet.
export const STUDY_STYLES=Object.freeze([
  Object.freeze({id:'current',label:'Current',description:'Unchanged generator output'}),
  Object.freeze({id:'classic-strategy-study',label:'Classic PC Strategy',
    description:'Painted color, rough pigment and clearly readable details'}),
  Object.freeze({id:'naturalistic-study',label:'Naturalistic',
    description:'Subdued mineral pigments, stains and weathering'}),
  Object.freeze({id:'hand-painted-study',label:'Hand-Painted Fantasy',
    description:'Bold illustrated shapes, simplified colors and contrast'}),
  Object.freeze({id:'retro-3d-study',label:'Retro 3D',
    description:'Chunky texels, ordered dithering and limited color depth'}),
  Object.freeze({id:'watercolor-study',label:'Watercolor',
    description:'Translucent pigment washes and soft granulation'}),
]);
export const STUDY_MATERIALS=Object.freeze([
  Object.freeze({id:'roof-thatch',label:'Thatch',group:'Roof',profile:null}),
  Object.freeze({id:'roof-clay',label:'Clay roof',group:'Roof',profile:null}),
  Object.freeze({id:'timber-oak',label:'Oak timber',group:'Timber',profile:'panel'}),
  Object.freeze({id:'plaster-lime',label:'Lime plaster',group:'Facade',profile:null}),
  Object.freeze({id:'stone-rubble',label:'Rubble stone',group:'Foundation',profile:null}),
]);
const clamp=n=>Math.max(0,Math.min(255,n));
const mix=(a,b,t)=>a+(b-a)*t;
const smooth=t=>t*t*(3-2*t);
const wrap=(v,count)=>(v%count+count)%count;
function hash(x,y,salt){
  let n=(Math.imul(x,374761393)^Math.imul(y,668265263)^(salt>>>0))>>>0;
  n=Math.imul(n^(n>>>13),1274126177);
  return ((n^(n>>>16))>>>0)/4294967296;
}
// Wrapped noise means all added pigment, marks and stains tile cleanly.
function field(x,y,width,height,nx,ny,salt){
  const u=x*nx/width,v=y*ny/height;
  const ix=Math.floor(u),iy=Math.floor(v);
  const tx=smooth(u-ix),ty=smooth(v-iy);
  const sample=(cx,cy)=>hash(wrap(cx,nx),wrap(cy,ny),salt);
  return mix(mix(sample(ix,iy),sample(ix+1,iy),tx),
    mix(sample(ix,iy+1),sample(ix+1,iy+1),tx),ty)-.5;
}
// Each material has its own painterly interpretation of an established
// structural source. These are intentionally NOT universal style knobs.
function paintedAlbedo(id,x,y,source,styleSeed,width,height){
  const i=(y*width+x)*4;
  const rgb=[source[i],source[i+1],source[i+2]];
  const mean=(rgb[0]+rgb[1]+rgb[2])/3;
  const macro=field(x,y,width,height,6,7,styleSeed^0xa45182e3);
  const medium=field(x,y,width,height,22,21,styleSeed^0x29bd1b53);
  const small=field(x,y,width,height,69,63,styleSeed^0xe23d0e14);
  const dust=hash(x,y,styleSeed^0xb52cad43)-.5;
  let palette,tone,contrast,opacity,detail;
  switch(id){
    case 'roof-thatch':{
      palette=[164,134,76];contrast=1.38;opacity=.32;
      const drift=field(x,y,width,height,9,6,styleSeed^0xf13732c0);
      const straw=Math.sin(2*Math.PI*(x*82/width+drift*.52));
      const blades=field(x,y,width,height,95,14,styleSeed^0x9ab32e14);
      const courses=field(x,y,width,height,7,19,styleSeed^0x31ca2185);
      tone=macro*39+medium*20+small*14+straw*8+
        blades*28+courses*24+dust*4;
      detail=[1.06,1.0,.65];break;
    }
    case 'roof-clay':{
      palette=[166,112,92];contrast=1.36;opacity=.30;
      const kiln=field(x,y,width,height,11,10,styleSeed^0x32e1b179);
      const oxidized=field(x,y,width,height,17,25,styleSeed^0x8e439d2b);
      const chipped=field(x,y,width,height,75,66,styleSeed^0x90bc8a11);
      tone=macro*31+medium*17+kiln*43+oxidized*20+
        small*10+chipped*15+dust*7;
      detail=[1.15,.79,.63];break;
    }
    case 'timber-oak':{
      palette=[126,85,51];contrast=1.62;opacity=.33;
      // Long fibers, bruised patches and hand-carved darker grooves.
      const sway=field(x,y,width,height,9,6,styleSeed^0x438a2f2b);
      const fibers=field(x+sway*18,y,width,height,87,5,
        styleSeed^0xf0316aba);
      const cut=field(x+sway*11,y,width,height,36,4,
        styleSeed^0x781a1e2f);
      const split=Math.max(0,-fibers-.19);
      tone=macro*33+medium*13+fibers*45+cut*23+
        small*10+dust*4-split*45;
      detail=[1.11,.84,.60];break;
    }
    case 'plaster-lime':{
      palette=[230,213,172];contrast=1.18;opacity=.48;
      // Wide, semi-flat brush/trowel patches rather than grey fine noise.
      const strokes=field(x,y,width,height,15,12,styleSeed^0x2761a9da);
      const patch=Math.round(strokes*7)/7;
      const aggregate=field(x,y,width,height,93,87,
        styleSeed^0x763b24cb);
      tone=macro*25+medium*12+patch*37+
        aggregate*11+dust*6;
      detail=[1,.95,.82];break;
    }
    case 'stone-rubble':{
      palette=[166,150,119];contrast=1.63;opacity=.30;
      const fleck=field(x,y,width,height,45,52,styleSeed^0xab23915e);
      const grit=field(x,y,width,height,112,109,styleSeed^0x4b7a209e);
      // Emphasize actual source mortar rather than drawing a second,
      // unrelated stone pattern on top of the existing course layout.
      const joint=Math.max(0,145-mean);
      tone=macro*29+medium*17+fleck*26+grit*12+
        small*13+dust*5-joint*.55;
      detail=[1.01,.96,.78];break;
    }
    default:throw Error('Unknown study material: '+id);
  }
  return rgb.map((value,c)=>{
    const corrected=mean+(value-mean)*1.25;
    const painted=mix(corrected,palette[c],opacity);
    return clamp((painted-128)*contrast+128+
      tone*detail[c]);
  });
}

// These reference palettes deliberately describe DIFFERENT materials, not a
// universal warmth/saturation slider. All shapes still come from the shared
// source generator; style changes here are for art-direction comparison.
const MATERIAL_ART=Object.freeze({
  'roof-thatch':{natural:[139,128,93],fantasy:[214,165,65],
    retro:[156,138,84],wash:[194,170,111],grain:1.14},
  'roof-clay':{natural:[147,91,73],fantasy:[221,126,113],
    retro:[169,92,66],wash:[204,133,112],grain:1.18},
  'timber-oak':{natural:[108,86,68],fantasy:[172,97,44],
    retro:[118,82,56],wash:[163,115,83],grain:1.3},
  'plaster-lime':{natural:[205,196,170],fantasy:[246,213,139],
    retro:[197,178,140],wash:[235,222,188],grain:.72},
  'stone-rubble':{natural:[143,143,131],fantasy:[156,153,174],
    retro:[143,132,112],wash:[178,174,164],grain:.9},
});
const dot=(x,y,seed)=>hash(x,y,seed)-.5;
function naturalAlbedo(id,x,y,src,width,height,seed){
  const p=(y*width+x)*4,palette=MATERIAL_ART[id].natural;
  const macro=field(x,y,width,height,5,6,seed^0xf731ac25);
  const mid=field(x,y,width,height,19,21,seed^0xb936c144);
  const mineral=field(x,y,width,height,87,81,seed^0x292af38b);
  const vertical=field(x,y,width,height,12,4,seed^0xca3987bc);
  // Different natural weathering for different physical substances.
  const stain=id==='roof-thatch'?Math.max(0,macro+mid*.5)*42:
    id==='roof-clay'?Math.max(0,mid+mineral*.4)*59:
    id==='timber-oak'?(vertical*.4+mid*.55)*43:
    id==='plaster-lime'?Math.max(0,macro+.24)*31:
    Math.max(0,macro+mid*.7)*53;
  const intensity=[1.04,.95,.91,.82,1.12][
    ['roof-thatch','roof-clay','timber-oak','plaster-lime','stone-rubble'].indexOf(id)];
  return [0,1,2].map(c=>clamp(
    mix(src[p+c],palette[c],.48)+
    (macro*46+mid*25+mineral*14+vertical*16)*intensity-
    stain*[.9,.95,1.06][c]));
}
function fantasyAlbedo(id,x,y,src,width,height,seed){
  const p=(y*width+x)*4,palette=MATERIAL_ART[id].fantasy;
  const large=field(x,y,width,height,6,8,seed^0x65a10f3c);
  const block=field(x,y,width,height,17,19,seed^0xad26916f);
  const stroke=field(x,y,width,height,
    id==='timber-oak'?70:32,id==='timber-oak'?6:27,
    seed^0x3ce16a4d);
  const sourceLuma=.299*src[p]+.587*src[p+1]+.114*src[p+2];
  // Fewer, broader tonal levels mimic deliberately illustrated shapes.
  const bands=Math.round((sourceLuma+large*42+block*31)/42)*42;
  const edge=(sourceLuma-bands)*.28;
  const shade=large*74+block*42+stroke*17+edge;
  const emphasis=id==='plaster-lime'?.65:id==='stone-rubble'?1.2:1;
  return [0,1,2].map(c=>{
    const base=mix(src[p+c],palette[c],.50);
    const channel=[1,.82,.58][c];
    return clamp((base-128)*1.35+128+shade*channel*emphasis);
  });
}
function watercolorAlbedo(id,x,y,src,width,height,seed){
  const p=(y*width+x)*4,palette=MATERIAL_ART[id].wash;
  const wash1=field(x,y,width,height,5,5,seed^0x8fe34c15);
  const wash2=field(x,y,width,height,11,13,seed^0x932b841c);
  const wash3=field(x,y,width,height,24,19,seed^0xb913427d);
  const granule=field(x,y,width,height,90,88,seed^0x14b83b62);
  const paper=dot(x,y,seed^0xac15e831);
  const pool=Math.max(0,Math.abs(wash2)-.22);
  const pigment=wash1*52+wash2*30+wash3*18+granule*13+
    paper*6-pool*30;
  const materialOpacity=id==='plaster-lime'?.70:
    id==='stone-rubble'?.52:.60;
  return [0,1,2].map(c=>clamp(
    mix(src[p+c],palette[c],materialOpacity)+
    pigment*[1,.83,.71][c]+(c===2?wash1*9:0)));
}
const BAYER4=Object.freeze([
  0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5,
]);
// Here the source is sampled in chunky material texels. Dithering is applied
// per chunky pixel (not screen-space), so zoom and repeat are deterministic.
function retroPixel(id,x,y,src,width,height,seed,block){
  const tx=Math.floor(x/block),ty=Math.floor(y/block);
  const sx=Math.min(width-1,tx*block+Math.floor(block/2));
  const sy=Math.min(height-1,ty*block+Math.floor(block/2));
  const p=(sy*width+sx)*4,palette=MATERIAL_ART[id].retro;
  const low=field(tx,ty,Math.ceil(width/block),Math.ceil(height/block),
    7,7,seed^0x8f27a9e3);
  const dither=BAYER4[(ty%4)*4+tx%4]/15-.5;
  const level=35;
  const res=[];
  for(let c=0;c<3;c++){
    const pigment=mix(src[p+c],palette[c],.40)+low*31;
    res.push(clamp(Math.round((pigment+dither*level*.55)/level)*level));
  }
  return res;
}
const STYLE_NORMAL=Object.freeze({
  'classic-strategy-study':1.28,
  'naturalistic-study':1.08,
  'hand-painted-study':.53,
  'retro-3d-study':.40,
  'watercolor-study':.20,
});
const STYLE_ROUGHNESS=Object.freeze({
  'classic-strategy-study':-4,
  'naturalistic-study':4,
  'hand-painted-study':7,
  'retro-3d-study':9,
  'watercolor-study':13,
});

const RELIEF=Object.freeze({
  'roof-thatch':1.28,'roof-clay':1.36,'timber-oak':1.39,
  'plaster-lime':1.12,'stone-rubble':1.32,
});
const ROUGHNESS=Object.freeze({
  'roof-thatch':5,'roof-clay':-8,'timber-oak':-7,
  'plaster-lime':2,'stone-rubble':-6,
});
export function applyTextureStudyStyle(id,style,view,data,options={}){
  if(!STUDY_MATERIALS.some(material=>material.id===id))
    throw Error('Unknown study material: '+id);
  if(!STUDY_STYLES.some(item=>item.id===style))
    throw Error('Unknown study style: '+style);
  if(!['albedo','normal','roughness'].includes(view))
    throw Error('Unknown material view: '+view);
  if(!(data instanceof Uint8ClampedArray)||data.length%4!==0)
    throw Error('RGBA source pixels required');
  const pixels=new Uint8ClampedArray(data);
  if(style==='current')return pixels;
  const count=data.length/4;
  const width=options.width??Math.round(Math.sqrt(count));
  const height=options.height??(count/width);
  if(!Number.isInteger(width)||!Number.isInteger(height)||
    width<1||height<1||width*height!==count)
    throw Error('Invalid texture dimensions');
  const seed=(options.seed??0x7a39d4b1)>>>0;
  const block=Math.max(1,Math.floor(Math.min(width,height)/32));
  for(let p=0;p<count;p++){
    const i=p*4,x=p%width,y=Math.floor(p/width);
    if(view==='albedo'){
      let color;
      switch(style){
        case 'classic-strategy-study':
          color=paintedAlbedo(id,x,y,data,seed,width,height);break;
        case 'naturalistic-study':
          color=naturalAlbedo(id,x,y,data,width,height,seed);break;
        case 'hand-painted-study':
          color=fantasyAlbedo(id,x,y,data,width,height,seed);break;
        case 'retro-3d-study':
          color=retroPixel(id,x,y,data,width,height,seed,block);break;
        case 'watercolor-study':
          color=watercolorAlbedo(id,x,y,data,width,height,seed);break;
      }
      pixels[i]=color[0];pixels[i+1]=color[1];pixels[i+2]=color[2];
    }else if(view==='normal'){
      // Correct tangent-space normal: scaling XY then renormalizing never
      // flips the surface backface. Retro normals share the chunky texels.
      const sx=style==='retro-3d-study'?
        Math.min(width-1,Math.floor(x/block)*block+Math.floor(block/2)):x;
      const sy=style==='retro-3d-study'?
        Math.min(height-1,Math.floor(y/block)*block+Math.floor(block/2)):y;
      const index=(sy*width+sx)*4;
      const factor=style==='classic-strategy-study'?RELIEF[id]:
        STYLE_NORMAL[style]*MATERIAL_ART[id].grain;
      const nx=(data[index]/127.5-1)*factor;
      const ny=(data[index+1]/127.5-1)*factor;
      const nz=Math.max(0,data[index+2]/127.5-1);
      const len=Math.hypot(nx,ny,nz)||1;
      pixels[i]=clamp((nx/len+1)*127.5);
      pixels[i+1]=clamp((ny/len+1)*127.5);
      pixels[i+2]=clamp((nz/len+1)*127.5);
    }else{
      const sx=style==='retro-3d-study'?
        Math.min(width-1,Math.floor(x/block)*block+Math.floor(block/2)):x;
      const sy=style==='retro-3d-study'?
        Math.min(height-1,Math.floor(y/block)*block+Math.floor(block/2)):y;
      const sample=data[(sy*width+sx)*4];
      const offset=style==='classic-strategy-study'?ROUGHNESS[id]:
        STYLE_ROUGHNESS[style];
      let value=clamp(sample+offset);
      if(style==='retro-3d-study')value=clamp(Math.round(value/32)*32);
      if(style==='watercolor-study')value=clamp(Math.round(value/16)*16);
      pixels[i]=value;pixels[i+1]=value;pixels[i+2]=value;
    }
    // Preserve alpha; never overwrite persisted texture recipes.
  }
  return pixels;
}
export function studySeeds(definition){
  if(!STUDY_MATERIALS.some(item=>item.id===definition?.id))
    throw Error('Not a study material');
  return Object.fromEntries(definition.components.map(c=>
    [c.id,c.initialSeed]));
}
export function reseedStudySeeds(definition,masterSeed){
  if(!Number.isInteger(masterSeed)||masterSeed<0||masterSeed>0xffffffff)
    throw Error('Invalid comparison master seed');
  const original=studySeeds(definition);
  // Independent but stable component variation; different generators use
  // their own semantic seed names and never share accidental random state.
  return Object.fromEntries(Object.keys(original).map((key,i)=>{
    let n=(masterSeed^original[key]^Math.imul(i+1,0x9e3779b1))>>>0;
    n=Math.imul(n^(n>>>16),0x85ebca6b)>>>0;
    n=Math.imul(n^(n>>>13),0xc2b2ae35)>>>0;
    return [key,(n^(n>>>16))>>>0];
  }));
}
