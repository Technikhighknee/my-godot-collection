// Deterministic, seamless mature Quercus robur bark albedo.
// Fissures, surface granularity and pigmentation are independent components.
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
// Integer lattice periods make the noise repeat across both tile borders.
function noise(u, v, nx, ny, seed) {
  const x = u * nx, y = v * ny;
  const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
  const x0 = mod(ix, nx), y0 = mod(iy, ny), x1 = (x0 + 1) % nx, y1 = (y0 + 1) % ny;
  const a = hash(x0, y0, seed), b = hash(x1, y0, seed);
  const c = hash(x0, y1, seed), d = hash(x1, y1, seed);
  const lower = a + (b - a) * fx, upper = c + (d - c) * fx;
  return (lower + (upper - lower) * fy) * 2 - 1;
}
// Each age class shares the same seeded spatial composition, but mature
// cork has larger plates and deeper separations than living young twigs.
export const OAK_BARK_PROFILES=Object.freeze(['trunk','limb','young']);
const PROFILES=Object.freeze({
  trunk:Object.freeze({bands:10,depth:.72,fracture:.52,grain:.115,
    tone:33,variation:25,base:[117,111,100]}),
  limb:Object.freeze({bands:13,depth:.43,fracture:.31,grain:.086,
    tone:25,variation:20,base:[124,116,103]}),
  young:Object.freeze({bands:17,depth:.095,fracture:.08,grain:.042,
    tone:14,variation:12,base:[130,119,106]}),
});
function getProfile(name){
  if(!Object.hasOwn(PROFILES,name))
    throw Error('Unknown oak bark profile: '+name);
  return PROFILES[name];
}
// Curved, broken cross cuts inside the larger plates. This is periodic
// in v; the cuts are not regularly spaced horizontal grid lines.
function makePlateCuts(seed,bands){
  return Array.from({length:bands},(_,col)=>{
    const count=2+Math.floor(hash(col,93,seed)*4);
    return Array.from({length:count},(_,i)=>({
      y:fract((i+.25+hash(col,i+137,seed)*.7)/count),
      slope:(hash(col,i+71,seed)-.5)*.065,
      strength:.36+.60*hash(col,i+19,seed),
      width:.003+hash(col,i+59,seed)*.006,
    }));
  });
}
function transverseCuts(v,across,cuts){
  let fracture=0;
  for(const cut of cuts){
    const center=cut.y+cut.slope*(across-.5);
    const d=Math.abs(fract(v-center+.5)-.5);
    fracture=Math.max(fracture,cut.strength*(1-
      smooth((d-cut.width*.35)/(cut.width*2.5))));
  }
  return fracture;
}
/**
 * Synthesize a periodic bark height field with explicit macro, meso and
 * micro scales. Albedo is pigment-led, not a baked lighting pass.
 * profile: mature trunk, middle-aged limb, or young twig.
 */
export function generateOakBark({structureSeed=19641,surfaceSeed=48507,
  colorSeed=21749,size=OAK_BARK_SIZE,profile='trunk'}={}){
  validSeed(structureSeed);validSeed(surfaceSeed);validSeed(colorSeed);
  if(!Number.isInteger(size)||size<32||size>OAK_BARK_SIZE)
    throw Error('Invalid oak bark resolution');
  const settings=getProfile(profile);
  const pixels=new Uint8ClampedArray(size*size*4);
  const heightField=new Float32Array(size*size);
  const cuts=makePlateCuts(structureSeed,settings.bands);
  const palette=settings.base.map((base,i)=>
    base+(hash(i+3,i+11,colorSeed)-.5)*13);
  for(let y=0;y<size;y++){
    const v=y/size;
    for(let x=0;x<size;x++){
      const u=x/size,p=y*size+x,i=p*4;
      // MACRO: vertical plates with meandering margins, interrupted by
      // occasional branch/split ridges. All frequency domains tile exactly.
      const meander=.026*noise(u,v,3,4,structureSeed^0x3135b849)
        +.011*noise(u,v,7,11,structureSeed^0x512bb71a)
        +.004*noise(u,v,17,19,structureSeed^0xa75bd94f);
      const stripe=fract((u+meander)*settings.bands);
      const column=mod(Math.floor((u+meander)*settings.bands),
        settings.bands);
      const edge=Math.min(stripe,1-stripe);
      const breadth=clamp(.10+.034*noise(u,v,9,15,
        structureSeed^0x2bde4987),.065,.15);
      const primary=1-smooth((edge-breadth*.38)/(breadth*.8));
      const splitFlow=.035*noise(u,v,12,5,structureSeed^0x7057e2ab);
      const split=Math.abs(stripe-.5-splitFlow);
      const splitMask=Math.max(0,noise(u,v,6,7,
        structureSeed^0x149ab801)-.13);
      const secondary=(1-smooth((split-.026)/.11))*
        smooth(.02,.25,splitMask)*.57;
      const fissure=clamp(Math.max(primary,secondary),0,1);
      const plateau=smooth(.055,.29,edge);
      const plateUndulation=.14*noise(u,v,11,14,
        structureSeed^0x6ecad42b)
        +.07*noise(u,v,20,27,structureSeed^0xd831fa41);
      // MESO: oblique, interrupted cracks and worn, irregular plate edges.
      const crossDrift=.009*noise(u,v,8,15,
        structureSeed^0x7152e189);
      const transverse=transverseCuts(fract(v+crossDrift),stripe,
        cuts[column]);
      const flake=.12*noise(u,v,34,55,
        structureSeed^0x42e7f35d)
        +.045*noise(u,v,61,71,structureSeed^0xae291b03);
      const erosion=1-smooth(.17,.48,edge);
      // MICRO: supporting cork granularity, not black fiber stripes.
      const cork=.65*noise(u,v,70,87,surfaceSeed^0x132fed40)
        +.24*noise(u,v,153,176,surfaceSeed^0x8931a96b)
        +.11*noise(u,v,289,311,surfaceSeed^0x28ba701e);
      const grit=noise(u,v,389,401,surfaceSeed^0x9117ab32);
      const relief=clamp(
        .56+settings.depth*(plateau*.25-fissure*.54
          -transverse*settings.fracture*.33
          +plateUndulation*.7+flake*(.6+erosion*.3))
        +settings.grain*(cork+.13*grit),0,1);
      heightField[p]=relief;
      const colorVariation=.55*noise(u,v,8,13,
        colorSeed^0x730aec31)+.25*noise(u,v,24,37,
        colorSeed^0x8a17e365);
      const patina=noise(u,v,43,52,colorSeed^0x2a18c3de);
      const pigment=settings.variation*colorVariation+
        patina*settings.variation*.4;
      // Deliberately restrained cavity coloration; the normal and AO
      // maps now carry the bulk of the fissure perception.
      const shade=-(fissure*.12+transverse*.045)*
        settings.tone+plateau*settings.tone*.09;
      pixels[i]=clamp(palette[0]+pigment+shade,30,223);
      pixels[i+1]=clamp(palette[1]+pigment*.91+shade*.95,27,217);
      pixels[i+2]=clamp(palette[2]+pigment*.79+shade*.87,25,209);
      pixels[i+3]=255;
    }
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
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const index=y*width+x,i=index*4,h=heightField[index];
    const dx=(at(x+1,y)-at(x-1,y))*.5;
    const dy=(at(x,y+1)-at(x,y-1))*.5;
    // Canvas rows go down; the OpenGL normal convention uses +Y.
    // Flip the v derivative so the uploaded normal is not DirectX style.
    const nx=-dx*4.5,ny=dy*4.5,nz=1;
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
