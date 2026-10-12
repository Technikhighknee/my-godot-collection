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

// Aged bark is an eroded skin, not a set of uniform painted strokes.
// The depth and pigmentation of every opening derive from the same
// irregular surface, with a smaller scale of flakes and weathered grain.
export const OAK_BARK_PROFILES=Object.freeze(['trunk','limb','young']);
const PROFILES=Object.freeze({
  trunk:Object.freeze({count:20,width:.0090,depth:.36,lip:.070,
    grain:.028,shade:56,variation:25,base:[151,148,140]}),
  limb:Object.freeze({count:14,width:.0079,depth:.22,lip:.045,
    grain:.023,shade:44,variation:22,base:[146,141,132]}),
  young:Object.freeze({count:6,width:.0050,depth:.065,lip:.015,
    grain:.014,shade:18,variation:16,base:[145,139,130]}),
});
function getProfile(name){
  if(!Object.hasOwn(PROFILES,name))
    throw Error('Unknown oak bark profile: '+name);
  return PROFILES[name];
}
const lerp=(a,b,t)=>a+(b-a)*t;
function catmull(a,b,c,d,t){
  return b+.5*t*(c-a+t*(2*a-5*b+4*c-d+
    t*(3*(b-c)+d-a)));
}
// Irregular, sometimes interrupted weathering fractures. Their paths
// are seeded splines with independent left/right erosion; their edges
// are further displaced by two octaves of 2-D periodic noise.
// Consequently a fissure can widen, split, vanish and reappear without
// looking like the same straight brush stamp repeated around a cylinder.
function weatheredOpenings(size,seed,profile){
  const cavities=new Float32Array(size*size);
  const shoulders=new Float32Array(size*size);
  const rough=noiseField(size,43,79,seed^0x6135a3cb);
  const micro=noiseField(size,137,161,seed^0x742cbe11);
  const seed2=seed^0x6d85e93a;
  function draw(id,x0,y0,length,width,depth,angle,secondary=false){
    const steps=Math.max(6,Math.ceil(length*23));
    const drift=[0],widths=[],weight=[];
    for(let k=0;k<=steps+2;k++){
      if(k>0)drift.push(drift[k-1]+
        (hash(id*31+k,113,seed)-.5)*.018);
      widths.push(.46+1.08*hash(id*19+k,211,seed));
      weight.push(.35+.65*hash(id*23+k,337,seed));
    }
    function path(t){
      const n=clamp(t*steps,0,steps),i=Math.floor(n),f=n-i;
      const index=k=>clamp(k,0,steps+2);
      const d=catmull(drift[index(i-1)],drift[index(i)],
        drift[index(i+1)],drift[index(i+2)],f);
      return x0+angle*t*length+d;
    }
    function envelope(t,values){
      const n=clamp(t*steps,0,steps),i=Math.floor(n),f=smooth(n-i);
      return lerp(values[i],values[Math.min(i+1,steps+2)],f);
    }
    const k0=Math.floor(y0*size),k1=Math.ceil((y0+length)*size);
    const holeAt=.25+.52*hash(id,419,seed);
    const hasBreak=!secondary&&hash(id,421,seed)>.37;
    for(let row=k0;row<=k1;row++){
      const t=(row+.5-y0*size)/(length*size);
      if(t<0||t>1)continue;
      const taper=smooth(Math.min(t/.075,(1-t)/.11));
      const widthLocal=width*envelope(t,widths)*(.35+.65*taper);
      const gap=hasBreak?(1-.92*Math.exp(-Math.pow((t-holeAt)/.025,2))):1;
      const strength=depth*envelope(t,weight)*taper*gap;
      if(strength<.008)continue;
      const cx=path(t)*size,cy=mod(row,size);
      const radius=Math.max(.58,widthLocal*size),range=Math.ceil(radius*2.8);
      for(let x=Math.floor(cx)-range;x<=Math.floor(cx)+range;x++){
        const xx=mod(x,size),p=cy*size+xx;
        const side=x+.5<cx?-1:1;
        // Two-scale erosion distorts each bank independently;
        // larger flakes notch the lip rather than creating a clean V.
        const edge=1+rough[p]*.33+micro[p]*.12+
          side*.11*Math.sin(t*19+id*4.13);
        const d=Math.abs(x+.5-cx)/(radius*Math.max(.44,edge));
        if(d>=2.2)continue;
        const core=(1-smooth((d-.37)/.72));
        const flakes=.90+.13*rough[p]-.17*Math.abs(micro[p]);
        const lip=Math.max(0,1-Math.abs(d-1.18)/.71)*
          (.72+.28*rough[p]);
        cavities[p]=Math.max(cavities[p],strength*core*
          Math.max(.48,flakes));
        shoulders[p]=Math.max(shoulders[p],strength*lip);
      }
    }
    if(!secondary&&hash(id,503,seed)>.57){
      const t=.24+.48*hash(id,509,seed);
      const dir=hash(id,521,seed)>.5?1:-1;
      draw(id+1300,path(t),y0+length*t,
        length*(.18+.22*hash(id,527,seed)),width*.48,
        depth*.59,angle+dir*(.18+.25*hash(id,541,seed)),true);
    }
  }
  for(let i=0;i<profile.count;i++){
    const x0=hash(i+11,23,seed2),y0=hash(i+37,41,seed2);
    const length=.13+.74*Math.pow(hash(i+53,59,seed),.93);
    const width=profile.width*(.75+.8*hash(i+71,83,seed));
    const depth=.6+.4*hash(i+97,101,seed);
    const angle=(hash(i+109,107,seed)-.5)*.19;
    draw(i,x0,y0,length,width,depth,angle);
  }
  return {cavities,shoulders};
}
// Eroded cork plates: a weak second-order crack network based on warped,
// elongated irregular cells. It adds realistic cross-breaks and splintered
// edges without imposing rows of evenly spaced horizontal/vertical marks.
function plateErosion(size,seed){
  // The meso-scale cell network does not need full albedo resolution.
  // Tileable bilinear expansion keeps the 1024px material responsive.
  const n=Math.min(size,512);
  const nx=21,ny=11,points=new Float32Array(nx*ny*2);
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
    const index=(y*nx+x)*2;
    points[index]=.12+.76*hash(x,y,seed^0x297a39ab);
    points[index+1]=.12+.76*hash(x,y,seed^0x13ca577f);
  }
  const warpX=noiseField(n,9,13,seed^0x23df1a91);
  const warpY=noiseField(n,13,9,seed^0x648a2dcf);
  const breakup=noiseField(n,31,29,seed^0x8b147bb1);
  const field=new Float32Array(n*n);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const p=y*n+x;
    const u=x*nx/n+warpX[p]*.48;
    const v=y*ny/n+warpY[p]*.35;
    const cx=Math.floor(u),cy=Math.floor(v);
    let first=1e9,second=1e9;
    for(let by=-1;by<=1;by++)for(let bx=-1;bx<=1;bx++){
      const ix=cx+bx,iy=cy+by;
      const base=(mod(iy,ny)*nx+mod(ix,nx))*2;
      const dx=u-(ix+points[base]),dy=v-(iy+points[base+1]);
      const dist=dx*dx+dy*dy;
      if(dist<first){second=first;first=dist;}
      else if(dist<second)second=dist;
    }
    const distance=Math.sqrt(second)-Math.sqrt(first);
    const edge=1-smooth((distance-.019)/.16);
    // Most plate boundaries are faint. Broken passages are patches of
    // edges, selected by low-frequency erosion rather than a fixed grid.
    const wear=smooth((breakup[p]+.17)/.62);
    field[p]=edge*wear;
  }
  if(n===size)return field;
  const out=new Float32Array(size*size);
  for(let y=0;y<size;y++){
    const sy=y*n/size,y0=Math.floor(sy),y1=(y0+1)%n,fy=sy-y0;
    for(let x=0;x<size;x++){
      const sx=x*n/size,x0=Math.floor(sx),x1=(x0+1)%n,fx=sx-x0;
      const low=lerp(field[y0*n+x0],field[y0*n+x1],fx);
      const high=lerp(field[y1*n+x0],field[y1*n+x1],fx);
      out[y*size+x]=lerp(low,high,fy);
    }
  }
  return out;
}

export function generateOakBark({structureSeed=19641,surfaceSeed=48507,
  colorSeed=21749,size=OAK_BARK_SIZE,profile='trunk'}={}){
  validSeed(structureSeed);validSeed(surfaceSeed);validSeed(colorSeed);
  if(!Number.isInteger(size)||size<32||size>OAK_BARK_SIZE)
    throw Error('Invalid oak bark resolution');
  const settings=getProfile(profile);
  const {cavities,shoulders}=weatheredOpenings(size,structureSeed,settings);
  const erodedPlates=plateErosion(size,structureSeed);
  const pixels=new Uint8ClampedArray(size*size*4);
  const heightField=new Float32Array(size*size);
  // Irregular bark plates and cork microtopography are subordinate to
  // occasional deep breaks. The orientation is anisotropic but there is
  // no regularly spaced ridge grid.
  const broad=noiseField(size,7,9,structureSeed^0x4e6f1291);
  const plate=noiseField(size,21,33,surfaceSeed^0x132fed40);
  const fiber=noiseField(size,51,13,surfaceSeed^0x8931a96b);
  const grain=noiseField(size,117,137,surfaceSeed^0x28ba701e);
  const tiny=noiseField(size,289,307,surfaceSeed^0x51471b03);
  const speckle=noiseField(size,431,419,surfaceSeed^0x9b147af3);
  const colorA=noiseField(size,9,13,colorSeed^0x730aec31);
  const colorB=noiseField(size,35,43,colorSeed^0x8a17e365);
  const colorC=noiseField(size,137,149,colorSeed^0x2a18c3de);
  // Lichen and pale dusty weathering occur in small, disconnected
  // islands rather than as a global green tint.
  const lichenCloud=noiseField(size,11,15,colorSeed^0x1763ad71);
  const lichenEdges=noiseField(size,41,45,colorSeed^0x6973abf1);
  const crackDirt=noiseField(size,83,101,colorSeed^0x33f12a51);
  const pigmentGrain=noiseField(size,241,257,colorSeed^0x17ed813b);
  const palette=settings.base.map((base,i)=>
    base+(hash(i+3,i+11,colorSeed)-.5)*8);
  for(let p=0;p<size*size;p++){
    const i=p*4,cavity=cavities[p],lip=shoulders[p];
    const skin=.030*broad[p]+settings.grain*(
      .41*plate[p]+.18*fiber[p]+.23*grain[p]+
      .12*tiny[p]+.06*speckle[p]);
    const h=clamp(.60+skin-settings.depth*cavity+
      settings.lip*lip-settings.depth*.135*erodedPlates[p],0,1);
    heightField[p]=h;
    const pigment=settings.variation*(.36*colorA[p]+
      .23*colorB[p]+.19*colorC[p]+.08*grain[p]+
      .14*pigmentGrain[p]);
    const lichen=smooth((lichenCloud[p]*.68+
      lichenEdges[p]*.32-.27)/.31);
    const exposed=clamp(cavity*(.93+.12*crackDirt[p]),0,1);
    const scale=(.7*grain[p]+.3*speckle[p]);
    const flake=smooth((Math.abs(scale)-.12)/.37);
    const tone=pigment+flake*(7+4*plate[p])-
      settings.shade*exposed+settings.shade*.085*lip-
      settings.shade*.19*erodedPlates[p];
    // A hint of mossy green/grey and dark weathering; no black
    // centreline or fake precomputed lighting is baked into albedo.
    pixels[i]=clamp(palette[0]+tone+lichen*2,28,225);
    pixels[i+1]=clamp(palette[1]+tone*.95+lichen*11,25,220);
    pixels[i+2]=clamp(palette[2]+tone*.88+lichen*8,23,217);
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
