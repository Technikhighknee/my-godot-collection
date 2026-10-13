// Tileable hewn timber material: grain runs along V, without board joins.
export const TIMBER_TEXTURE_SIZE=512;
export const TIMBER_VIEWS=Object.freeze(['albedo','normal','roughness']);
const SIZE=TIMBER_TEXTURE_SIZE;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a+(b-a)*t;
const wrap=n=>(n%SIZE+SIZE)%SIZE;
const fract=x=>x-Math.floor(x);
const smooth=t=>t*t*(3-2*t);
function hash(x,y,seed){
  let n=(Math.imul(x,374761393)^Math.imul(y,668265263)^seed)>>>0;
  n=Math.imul(n^(n>>>13),1274126177);
  return ((n^(n>>>16))>>>0)/4294967296;
}
function noise(x,y,nx,ny,seed){
  const u=x*nx/SIZE,v=y*ny/SIZE;
  const a=Math.floor(u),b=Math.floor(v),fx=smooth(fract(u)),fy=smooth(fract(v));
  const h=(i,j)=>hash((i%nx+nx)%nx,(j%ny+ny)%ny,seed);
  return mix(mix(h(a,b),h(a+1,b),fx),mix(h(a,b+1),h(a+1,b+1),fx),fy);
}
function generateTimber(seeds){
  const pattern=seeds.grain>>>0,color=seeds.color>>>0;
  const albedo=new Float32Array(SIZE*SIZE*3);
  const height=new Float32Array(SIZE*SIZE);
  const roughness=new Float32Array(SIZE*SIZE);
  // Sparse, elongated knots distort the grain instead of stamping circles.
  const knots=[];
  for(let i=0;i<8;i++){
    const x=hash(i,0,pattern^0x1f26c8a2)*SIZE;
    const y=hash(i,1,pattern^0x629bf38c)*SIZE;
    const strength=hash(i,2,pattern^0x91a47322);
    if(strength<.35)continue;
    knots.push({x,y,rx:6+strength*7,ry:14+strength*15,
      strength:.45+strength*.55});
  }
  for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
    const p=y*SIZE+x;
    const broad=noise(x,y,7,5,color^0x125a33af)-.5;
    const tide=noise(x,y,18,9,pattern^0x62726a19)-.5;
    const drift=noise(x,y,13,5,pattern^0xc125af90)-.5;
    const warpedX=x+drift*12+Math.sin(y/SIZE*Math.PI*4)*1.8;
    let knotDepth=0,knotPigment=0,knotBend=0;
    for(const k of knots){
      const dx=((x-k.x+SIZE*1.5)%SIZE)-SIZE*.5;
      const dy=((y-k.y+SIZE*1.5)%SIZE)-SIZE*.5;
      const radius=Math.hypot(dx/k.rx,dy/k.ry);
      if(radius<3.4){
        knotBend+=dx*Math.exp(-radius*radius*.55)*k.strength*.9;
        const eye=Math.exp(-Math.pow(radius/.47,2))*k.strength;
        const ring=Math.exp(-Math.pow((radius-1)/.17,2))*k.strength;
        knotDepth+=ring*.055-eye*.10;
        knotPigment+=ring*.07+eye*.18;
      }
    }
    const fiberX=warpedX+knotBend;
    const long=noise(fiberX,y,57,5,pattern^0x714852df)-.5;
    const fine=noise(fiberX,y,119,13,pattern^0x2de391a6)-.5;
    const fleck=noise(fiberX,y,101,36,pattern^0x7260b7d4)-.5;
    const micro=hash(x,y,pattern^0xaed1437b)-.5;
    const phase=(fiberX/SIZE*39+long*.47+tide*.13)*Math.PI*2;
    const grain=Math.sin(phase)*.55+Math.sin(phase*1.89+fine*2.0)*.19+
      long*.82+fine*.28;
    const split=Math.max(0,-grain-.71)*.52;
    const surface=grain*.042+fine*.027+fleck*.013+micro*.007+
      tide*.023+knotDepth-split*.13;
    height[p]=.30+surface;
    const age=noise(x,y,15,14,color^0x1497eb2d)-.5;
    const stain=Math.max(0,-age-.10)*.07;
    const tone=grain*.073+long*.047+fine*.027+broad*.070+
      age*.036+micro*.012-knotPigment*.52-split*.11-stain;
    // Warm, dry, weathered oak, matching the roof texture palette.
    albedo[p*3]=clamp(.35+tone,.12,.57);
    albedo[p*3+1]=clamp(.257+tone*.77,.08,.44);
    albedo[p*3+2]=clamp(.173+tone*.61,.05,.34);
    roughness[p]=clamp(.84+split*.17+knotPigment*.25+
      fleck*.07+micro*.024-age*.045,.65,.99);
  }
  return {albedo,height,roughness};
}
let cache=null;
function material(seeds){
  if(!cache||cache.grain!==seeds.grain||cache.color!==seeds.color)
    cache={grain:seeds.grain,color:seeds.color,data:generateTimber(seeds)};
  return cache.data;
}
export function paintTimberTexture(canvas,seeds,view='albedo'){
  if(!TIMBER_VIEWS.includes(view))throw Error('Unknown timber texture channel');
  for(const key of ['grain','color'])if(!Number.isInteger(seeds?.[key])||
    seeds[key]<0||seeds[key]>0xffffffff)throw Error('Invalid timber seed: '+key);
  canvas.width=SIZE;canvas.height=SIZE;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw Error('2D canvas context required');
  const image=ctx.createImageData(SIZE,SIZE),d=image.data,m=material(seeds);
  for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
    const p=y*SIZE+x,i=p*4;
    if(view==='albedo'){
      for(let channel=0;channel<3;channel++)
        d[i+channel]=Math.round(255*m.albedo[p*3+channel]);
    }else if(view==='roughness'){
      const rough=Math.round(255*m.roughness[p]);
      d[i]=rough;d[i+1]=rough;d[i+2]=rough;
    }else{
      const dx=(m.height[y*SIZE+wrap(x+1)]-m.height[y*SIZE+wrap(x-1)])*3;
      const dy=(m.height[wrap(y+1)*SIZE+x]-m.height[wrap(y-1)*SIZE+x])*3;
      const length=Math.hypot(dx,dy,1);
      d[i]=Math.round(127.5*(1-dx/length));
      d[i+1]=Math.round(127.5*(1-dy/length));
      d[i+2]=Math.round(127.5*(1+1/length));
    }
    d[i+3]=255;
  }
  ctx.putImageData(image,0,0);
}
export function makeTimberAsset(seeds){
  return {id:'timber-oak',kind:'image',width:SIZE,height:SIZE,
    channels:'RGBA',views:TIMBER_VIEWS,
    sourceSeeds:{grain:seeds.grain,color:seeds.color},
    paint:(canvas,view='albedo')=>paintTimberTexture(canvas,seeds,view)};
}
