// Deterministic, seamless oak bark PBR source material.
// Broken areas, cork relief and pigment are independently seeded.
// Periodic noise keeps both image edges continuous without baked directionality.
export const OAK_BARK_SIZE = 1024;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const fract = v => v - Math.floor(v);
function validSeed(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw Error('Oak bark seed must be an unsigned 32-bit integer');
  return seed;
}
function hash(x, y, seed) {
  let a = (Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(y | 0, 0x85ebca77) ^ seed) >>> 0;
  a ^= a >>> 16;
  a = Math.imul(a, 0x7feb352d) >>> 0;
  a ^= a >>> 15;
  a = Math.imul(a, 0x846ca68b) >>> 0;
  return ((a ^ a >>> 16) >>> 0) / 4294967295;
}
const mod = (x, n) => ((x % n) + n) % n;
// Cache an octave's periodic lattice before rasterizing it. Computing
// four 32-bit hashes per pixel, per octave made the 1024px material set
// needlessly stall the browser for tens of seconds.
function noiseField(size,nx,ny,seed){
  const lattice=new Float32Array(nx*ny);
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)
    lattice[y*nx+x]=hash(x,y,seed);
  const field=new Float32Array(size*size);
  const rowX=Array.from({length:size},(_,x)=>{
    const v=x*nx/size,ix=Math.floor(v);
    return {ix,ix1:(ix+1)%nx,fx:smooth(v-ix)};
  });
  for(let y=0;y<size;y++){
    const v=y*ny/size,iy=Math.floor(v);
    const row0=iy*nx,row1=((iy+1)%ny)*nx,fy=smooth(v-iy);
    for(let x=0;x<size;x++){
      const {ix,ix1,fx}=rowX[x];
      const bottom=lattice[row0+ix]+
        (lattice[row0+ix1]-lattice[row0+ix])*fx;
      const top=lattice[row1+ix]+
        (lattice[row1+ix1]-lattice[row1+ix])*fx;
      field[y*size+x]=(bottom+(top-bottom)*fy)*2-1;
    }
  }
  return field;
}

// Quercus-inspired game bark: continuous quiet cork skin interrupted by
// sparse, broad, broken-up weathered openings. This is a material effect;
// growth geometry, wood UVs and branch intersections are not modified.
export const OAK_BARK_PROFILES=Object.freeze(['trunk','limb','young']);
const PROFILES=Object.freeze({
  trunk:Object.freeze({openings:17,width:.018,depth:.30,raised:.049,
    grain:.019,shade:23,variation:21,base:[129,122,110]}),
  limb:Object.freeze({openings:13,width:.013,depth:.19,raised:.033,
    grain:.016,shade:16,variation:19,base:[134,125,111]}),
  young:Object.freeze({openings:5,width:.007,depth:.062,raised:.013,
    grain:.012,shade:6,variation:15,base:[137,129,116]}),
});
function getProfile(name){
  if(!Object.hasOwn(PROFILES,name))
    throw Error('Unknown oak bark profile: '+name);
  return PROFILES[name];
}
// Draw an irregular, finite patch rather than tracing a thin curve.
// A mostly flat split interior, rounded broken shoulders, tapered ends
// and intermittent eroded flanks make the result read as damaged bark,
// not a dark painted line. Coordinates wrap in both texture dimensions.
function fracturedSurface(size,seed,settings){
  const gouge=new Float32Array(size*size);
  const shoulders=new Float32Array(size*size);
  const seed2=seed^0x7eab3615;
  function patch(id,startU,startV,length,halfWidth,strength,slope,
    branch=false){
    const phase=TAU*hash(id,11,seed),phase2=TAU*hash(id,27,seed);
    const freq=1.6+1.7*hash(id,37,seed);
    const drift=.004+.009*hash(id,49,seed);
    function pathU(t){
      return startU+slope*t+drift*(
        Math.sin(TAU*freq*t+phase)-Math.sin(phase))+
        .003*(Math.sin(TAU*6.2*t+phase2)-Math.sin(phase2));
    }
    const rowStart=Math.floor(startV*size);
    const rowEnd=Math.ceil((startV+length)*size);
    for(let row=rowStart;row<=rowEnd;row++){
      const t=(row+.5-startV*size)/(length*size);
      if(t<0||t>1)continue;
      const taper=smooth(Math.min(t/.13,(1-t)/.17));
      const segmented=.81+.13*Math.sin(TAU*(2.7*t)+phase2)+
        .06*Math.sin(TAU*(8.5*t)+phase);
      const radius=Math.max(.75,halfWidth*size*
        (.25+.75*taper)*Math.max(.40,segmented));
      const center=pathU(t)*size;
      const depth=strength*(.31+.69*taper)*
        (.84+.16*Math.sin(TAU*3.4*t+phase));
      const centerX=Math.floor(center);
      const xRadius=Math.ceil(radius*2.1);
      const iy=mod(row,size);
      for(let x=centerX-xRadius;x<=centerX+xRadius;x++){
        const lateral=Math.abs((x+.5-center)/radius);
        if(lateral>1.95)continue;
        const xx=mod(x,size),i=iy*size+xx;
        // An uneven edge, broad interior and narrow lifted margin.
        const erode=.94+.095*Math.sin(TAU*(4.8*t)+phase+
          .23*Math.sin(lateral*3))+ .06*Math.sin(TAU*14.3*t+phase2);
        const d=lateral/Math.max(.72,erode);
        const core=1-smooth((d-.17)/.93);
        const rim=Math.max(0,1-Math.abs(d-1.27)/.60);
        gouge[i]=Math.max(gouge[i],depth*core);
        shoulders[i]=Math.max(shoulders[i],depth*rim);
      }
    }
    // Only some openings split; their tributaries are also broad and
    // shallow, and connect to the parent's actual damaged area.
    if(!branch&&hash(id,101,seed)>.55){
      const t=.25+.40*hash(id,115,seed);
      const direction=hash(id,133,seed)>.5?1:-1;
      patch(id+10000,pathU(t),startV+length*t,
        length*(.21+.20*hash(id,143,seed)),
        halfWidth*.61,strength*.57,
        slope+direction*(.20+.23*hash(id,151,seed)),true);
    }
  }
  for(let i=0;i<settings.openings;i++){
    const startU=hash(i+17,19,seed2);
    const startV=hash(i+43,31,seed2);
    const length=.085+.24*hash(i+61,41,seed);
    const halfWidth=settings.width*(.65+.75*hash(i+73,53,seed));
    const strength=.55+.45*hash(i+89,67,seed);
    const slope=(hash(i+103,79,seed)-.5)*.20;
    patch(i,startU,startV,length,halfWidth,strength,slope);
  }
  return {gouge,shoulders};
}
/**
 * The relief is predominantly intact bark, with locally broken surface.
 * All maps are derived from one deterministic scalar height field.
 */
export function generateOakBark({structureSeed=19641,surfaceSeed=48507,
  colorSeed=21749,size=OAK_BARK_SIZE,profile='trunk'}={}){
  validSeed(structureSeed);validSeed(surfaceSeed);validSeed(colorSeed);
  if(!Number.isInteger(size)||size<32||size>OAK_BARK_SIZE)
    throw Error('Invalid oak bark resolution');
  const settings=getProfile(profile);
  const {gouge,shoulders}=fracturedSurface(size,structureSeed,settings);
  const pixels=new Uint8ClampedArray(size*size*4);
  const heightField=new Float32Array(size*size);
  const palette=settings.base.map((base,i)=>
    base+(hash(i+3,i+11,colorSeed)-.5)*10);
  const large=noiseField(size,5,7,structureSeed^0x4e6f1291);
  const corkA=noiseField(size,23,33,surfaceSeed^0x132fed40);
  const corkB=noiseField(size,73,85,surfaceSeed^0x8931a96b);
  const corkC=noiseField(size,189,197,surfaceSeed^0x28ba701e);
  const colorA=noiseField(size,7,9,colorSeed^0x730aec31);
  const colorB=noiseField(size,19,27,colorSeed^0x8a17e365);
  const colorC=noiseField(size,48,54,colorSeed^0x2a18c3de);
  const weatherA=noiseField(size,9,15,colorSeed^0x1d4c7f31);
  const weatherB=noiseField(size,143,157,colorSeed^0x782d41e5);
  for(let p=0;p<size*size;p++){
    const i=p*4;
    const small=.58*corkA[p]+.30*corkB[p]+.12*corkC[p];
    // Broad but restrained cork undulation prevents plastic smoothness.
    // Stronger relief exists only where the original skin has opened.
    const cavity=gouge[p],lip=shoulders[p];
    const relief=clamp(.61+.033*large[p]+settings.grain*small-
      settings.depth*cavity+settings.raised*lip,0,1);
    heightField[p]=relief;
    const pigment=settings.variation*(
      .47*colorA[p]+.35*colorB[p]+.18*colorC[p]);
    const weathering=.45*weatherA[p]+.19*weatherB[p];
    // Only a modest tonal shift marks an opening; no black strokes,
    // fake directional shadows or baked specular highlights.
    const tint=pigment+weathering*settings.variation*.18-
      settings.shade*cavity+settings.shade*.09*lip;
    pixels[i]=clamp(palette[0]+tint,28,225);
    pixels[i+1]=clamp(palette[1]+tint*.93,25,220);
    pixels[i+2]=clamp(palette[2]+tint*.84,23,217);
    pixels[i+3]=255;
  }
  return {width:size,height:size,pixels,heightField,profile};
}

export function paintOakBark(canvas, seeds = {}) {
  if (!canvas || typeof canvas.getContext !== 'function')
    throw Error('Invalid oak bark canvas');
  const image = generateOakBark(seeds);
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw Error('Canvas 2D unavailable for oak bark');
  const data = ctx.createImageData(image.width, image.height);
  data.data.set(image.pixels);
  ctx.putImageData(data, 0, 0);
  return {width: image.width, height: image.height, channels: 'RGBA', seamless: true};
}

/**
 * Cohesive material output. All maps come from the SAME generated relief.
 * Normal is OpenGL (+Y) tangent-space, with circular derivatives at edges.
 * Occlusion is a local cavity approximation, not scene/world-space AO.
 * Arrays are tightly packed, opaque RGBA to feed both Canvas and WebGL.
 */
export function generateOakBarkMaterial(options={}){
  const {width,height,pixels:albedo,heightField}=generateOakBark(options);
  const normal=new Uint8ClampedArray(albedo.length);
  const roughness=new Uint8ClampedArray(albedo.length);
  const ao=new Uint8ClampedArray(albedo.length);
  const heightMap=new Uint8ClampedArray(albedo.length);
  const at=(x,y)=>heightField[((y+height)%height)*width+
    ((x+width)%width)];
  // Scale derivatives by the texture's resolution: the same physical
  // gouge should produce comparable lighting at 64px and at 1024px.
  const normalStrength=Math.min(width,height)*.046;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const index=y*width+x,i=index*4,h=heightField[index];
    const dx=(at(x+1,y)-at(x-1,y))*.5;
    const dy=(at(x,y+1)-at(x,y-1))*.5;
    // Canvas rows go down; the OpenGL normal convention uses +Y.
    // Flip the v derivative so the uploaded normal is not DirectX style.
    const nx=-dx*normalStrength,ny=dy*normalStrength,nz=1;
    const length=Math.hypot(nx,ny,nz);
    normal[i]=Math.round((nx/length*.5+.5)*255);
    normal[i+1]=Math.round((ny/length*.5+.5)*255);
    normal[i+2]=Math.round((nz/length*.5+.5)*255);
    normal[i+3]=255;
    const rough=clamp(.80+(h-.5)*.12+Math.abs(dx+dy)*.20,.67,.96);
    const roughByte=Math.round(rough*255);
    roughness[i]=roughness[i+1]=roughness[i+2]=roughByte;
    roughness[i+3]=255;
    const nearby=(at(x-3,y)+at(x+3,y)+at(x,y-3)+at(x,y+3)+
      at(x-7,y)+at(x+7,y)+at(x,y-7)+at(x,y+7))*.125;
    const cavity=Math.max(0,nearby-h);
    const occlusion=clamp(1-cavity*1.55-
      Math.max(0,.36-h)*.36,.53,1);
    const aoByte=Math.round(occlusion*255);
    ao[i]=ao[i+1]=ao[i+2]=aoByte;
    ao[i+3]=255;
    const hByte=Math.round(h*255);
    heightMap[i]=heightMap[i+1]=heightMap[i+2]=hByte;
    heightMap[i+3]=255;
  }
  return {width,height,albedo,normal,roughness,ao,heightMap,
    heightField,normalConvention:'opengl',profile:options.profile??'trunk'};
}
export function generateOakBarkMaterialSet(options={}){
  const result={};
  for(const profile of OAK_BARK_PROFILES)
    result[profile]=generateOakBarkMaterial({...options,profile});
  return result;
}
export const OAK_BARK_MAPS=Object.freeze([
  'albedo','normal','roughness','ao','height',
]);
export function paintGeneratedOakBarkMap(canvas,material,map='albedo'){
  if(!canvas||typeof canvas.getContext!=='function')
    throw Error('Invalid oak bark canvas');
  if(!OAK_BARK_MAPS.includes(map))throw Error('Unknown bark material map');
  // The public inspector view is named 'height', but 'height' in the
  // material contract is always the image dimension, not a pixel array.
  const pixels=material?.[map==='height'?'heightMap':map];
  if(!material||!Number.isInteger(material.width)||
    !Number.isInteger(material.height)||material.width<1||
    material.height<1||!(pixels instanceof Uint8ClampedArray)||
    pixels.length!==material.width*material.height*4)
    throw Error('Invalid bark material');
  canvas.width=material.width;canvas.height=material.height;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw Error('Canvas 2D unavailable for oak bark');
  const image=ctx.createImageData(material.width,material.height);
  image.data.set(pixels);
  ctx.putImageData(image,0,0);
  return {width:material.width,height:material.height,map,seamless:true};
}
export function paintOakBarkMap(canvas,options={},map='albedo'){
  if(!OAK_BARK_MAPS.includes(map))throw Error('Unknown bark material map');
  return paintGeneratedOakBarkMap(canvas,generateOakBarkMaterial(options),map);
}
