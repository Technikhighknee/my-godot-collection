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
// Real fissures are finite, branching grooves with physical width, depth
// and raised shoulders. They are NOT frequency bands painted on the albedo.
// The same network is used by height, normal, AO and pigmentation.
export const OAK_BARK_PROFILES=Object.freeze(['trunk','limb','young']);
const PROFILES=Object.freeze({
  trunk:Object.freeze({cracks:21,depth:.44,width:.0029,lip:.075,
    grain:.026,albedoContrast:27,variation:19,base:[135,131,124]}),
  limb:Object.freeze({cracks:17,depth:.29,width:.0022,lip:.052,
    grain:.019,albedoContrast:22,variation:17,base:[140,131,119]}),
  young:Object.freeze({cracks:11,depth:.105,width:.00115,lip:.018,
    grain:.013,albedoContrast:10,variation:14,base:[141,132,120]}),
});
function getProfile(name){
  if(!Object.hasOwn(PROFILES,name))
    throw Error('Unknown oak bark profile: '+name);
  return PROFILES[name];
}
function crackNetwork(size,seed,settings){
  const fissures=new Float32Array(size*size);
  const lips=new Float32Array(size*size);
  // Strokes wrap on both axes. Even branching cracks that cross the
  // image boundary continue cleanly on the opposite tile.
  function stamp(u,v,radius,depth){
    if(depth<=.005)return;
    const cx=fract(u)*size,cy=fract(v)*size;
    const r=Math.max(.62,radius*size),reach=Math.ceil(r*2.4);
    const x0=Math.floor(cx),y0=Math.floor(cy);
    for(let dy=-reach;dy<=reach;dy++)for(let dx=-reach;dx<=reach;dx++){
      const distance=Math.hypot(x0+dx+.5-cx,y0+dy+.5-cy);
      if(distance>r*2.35)continue;
      const i=mod(y0+dy,size)*size+mod(x0+dx,size);
      // A thin, sunken incision with irregular shoulders instead of
      // a Gaussian stripe. Lip outside the core supports the normal map.
      const incision=1-smooth((distance-r*.18)/(r*.94));
      const ring=Math.max(0,1-Math.abs(distance-r*1.38)/(r*.85));
      if(incision>0)fissures[i]=Math.max(fissures[i],incision*depth);
      if(ring>0)lips[i]=Math.max(lips[i],ring*depth);
    }
  }
  const spatialSeed=seed^0x8c32813d;
  const step=1/(size*1.15);
  function path(id,startU,startV,length,angle,widthScale,depthScale,branch=false){
    const phase=TAU*hash(id,17,seed);
    const wave=TAU*hash(id,31,seed);
    const incline=angle; // horizontal drift per unit distance along the bark
    const amplitude=(branch?.008:.017)*(0.6+hash(id,57,seed));
    const fineAmplitude=branch?.0019:.0037;
    const gaps=Array.from({length:branch?0:1+Math.floor(hash(id,91,seed)*2)},(_,j)=>({
      position:length*(.22+.55*hash(id,j+250,seed)),
      halfWidth:.007+.012*hash(id,j+314,seed),
    }));
    const coords=t=>{
      const v=startV+t;
      const x=startU+incline*t+
        amplitude*(Math.sin(TAU*(1.35*t)+phase)-Math.sin(phase))+
        fineAmplitude*(Math.sin(TAU*(5.7*t)+wave)-Math.sin(wave));
      return [x,v];
    };
    for(let t=0;t<=length;t+=step){
      const [x,v]=coords(t);
      const taper=smooth(t/.025)*smooth((length-t)/.033);
      const gap=gaps.reduce((mult,g)=>mult*
        smooth(Math.abs(t-g.position)/(g.halfWidth*1.55)),1);
      const wobble=noise(fract(x),fract(v),17,31,seed^0xa133d319);
      const depth=depthScale*taper*gap*(.81+.19*wobble);
      const radius=settings.width*widthScale*(.80+
        .20*noise(fract(x),fract(v),23,37,seed^0x57b6a289));
      stamp(x,v,radius,depth);
    }
    // Explicit tributaries share the parent incision for a stretch,
    // then diverge. They sometimes reconnect with another fissure.
    if(!branch&&hash(id,409,seed)>.22){
      const originT=length*(.27+.44*hash(id,503,seed));
      const [originX,originV]=coords(originT);
      const direction=hash(id,607,seed)>.5?1:-1;
      path(id+2000,originX,originV,.07+.23*hash(id,703,seed),
        incline+direction*(.095+.18*hash(id,811,seed)),
        widthScale*.64,depthScale*.71,true);
    }
  }
  for(let i=0;i<settings.cracks;i++){
    // Irregular lateral spacing: not an evenly divided circumference.
    const u=hash(i+19,47,spatialSeed);
    const v=hash(i+47,23,spatialSeed);
    const len=.22+.69*hash(i+71,69,seed);
    const slope=(hash(i+87,83,seed)-.5)*.18;
    const width=.66+.68*hash(i+103,97,seed);
    const depth=.65+.35*hash(i+127,131,seed);
    path(i,u,v,len,slope,width,depth);
  }
  return {fissures,lips};
}
/**
 * Surface relief organized around topological fissures, not color stripes.
 * Independent structure, surface and pigmentation seeds stay compatible
 * with the existing model, inspector and PBR-material interfaces.
 */
export function generateOakBark({structureSeed=19641,surfaceSeed=48507,
  colorSeed=21749,size=OAK_BARK_SIZE,profile='trunk'}={}){
  validSeed(structureSeed);validSeed(surfaceSeed);validSeed(colorSeed);
  if(!Number.isInteger(size)||size<32||size>OAK_BARK_SIZE)
    throw Error('Invalid oak bark resolution');
  const settings=getProfile(profile);
  const {fissures,lips}=crackNetwork(size,structureSeed,settings);
  const pixels=new Uint8ClampedArray(size*size*4);
  const heightField=new Float32Array(size*size);
  const palette=settings.base.map((c,i)=>c+
    (hash(i+3,i+11,colorSeed)-.5)*9);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const u=x/size,v=y/size,p=y*size+x,i=p*4;
    const crack=fissures[p];
    const shoulder=lips[p];
    const macro=noise(u,v,7,11,structureSeed^0x4e6f1291);
    const surface=.64*noise(u,v,54,73,surfaceSeed^0x132fed40)+
      .27*noise(u,v,143,179,surfaceSeed^0x8931a96b)+
      .09*noise(u,v,281,307,surfaceSeed^0x28ba701e);
    // Deep cuts are subtractive from an otherwise quiet cork surface;
    // the positive shoulder breaks up their edges in tangent lighting.
    const relief=clamp(.57+.052*macro+settings.grain*surface-
      settings.depth*crack+settings.lip*shoulder,0,1);
    heightField[p]=relief;
    const pigment=settings.variation*(
      .56*noise(u,v,9,13,colorSeed^0x730aec31)+
      .29*noise(u,v,27,39,colorSeed^0x8a17e365)+
      .15*noise(u,v,49,61,colorSeed^0x2a18c3de));
    // The thin dark groove follows the actual 3D incision, not an
    // unrelated hand-painted stripe; light shading remains in PBR.
    const shade=-settings.albedoContrast*crack+
      settings.albedoContrast*.065*shoulder;
    pixels[i]=clamp(palette[0]+pigment+shade,30,223);
    pixels[i+1]=clamp(palette[1]+pigment*.94+shade*.93,27,217);
    pixels[i+2]=clamp(palette[2]+pigment*.89+shade*.86,25,209);
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
