// Texture style comparison (experimental, never persisted to asset recipes).
// Left column: untouched material generators. Right: intentionally distinct
// material-specific early-PC-strategy *painted diffuse* art study. Unlike the
// previous minimal RGB correction, it creates seeded pigment fields, coarse
// hand-painted structure and directional fibers per material.
// This is deliberately not a second production texture generator yet.
export const STUDY_STYLES=Object.freeze([
  Object.freeze({id:'current',label:'Current generators'}),
  Object.freeze({id:'classic-strategy-study',
    label:'Classic PC strategy · painted study'}),
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
      palette=[163,91,64];contrast=1.52;opacity=.33;
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
  for(let p=0;p<count;p++){
    const i=p*4;
    if(view==='albedo'){
      const x=p%width,y=Math.floor(p/width);
      const color=paintedAlbedo(id,x,y,data,seed,width,height);
      pixels[i]=color[0];pixels[i+1]=color[1];pixels[i+2]=color[2];
    }else if(view==='normal'){
      const factor=RELIEF[id],x=(data[i]/127.5-1)*factor;
      const y=(data[i+1]/127.5-1)*factor;
      const z=Math.max(0,data[i+2]/127.5-1);
      const len=Math.hypot(x,y,z)||1;
      pixels[i]=clamp((x/len+1)*127.5);
      pixels[i+1]=clamp((y/len+1)*127.5);
      pixels[i+2]=clamp((z/len+1)*127.5);
    }else{
      const value=clamp(data[i]+ROUGHNESS[id]);
      pixels[i]=value;pixels[i+1]=value;pixels[i+2]=value;
    }
    // Alpha is preserved. Existing seeds still define the source geometry.
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
