// Stylized hand-applied lime plaster. No baked scene lighting or fake bricks.
// Periodic height and pigment fields produce matching reusable PBR channels.
export const PLASTER_TEXTURE_SIZE=512;
export const PLASTER_VIEWS=Object.freeze(['albedo','normal','roughness']);
const SIZE=PLASTER_TEXTURE_SIZE;
const clamp=(x,lo=0,hi=1)=>Math.max(lo,Math.min(hi,x));
const mix=(a,b,t)=>a+(b-a)*t;
const smooth=t=>t*t*(3-2*t);
const fract=x=>x-Math.floor(x);
const wrap=n=>(n%SIZE+SIZE)%SIZE;
function hash(x,y,seed){
  let n=(Math.imul(x,374761393)^Math.imul(y,668265263)^(seed>>>0))>>>0;
  n=Math.imul(n^(n>>>13),1274126177);
  return ((n^(n>>>16))>>>0)/4294967296;
}
function noise(x,y,columns,rows,seed){
  const u=x*columns/SIZE,v=y*rows/SIZE;
  const ix=Math.floor(u),iy=Math.floor(v);
  const tx=smooth(fract(u)),ty=smooth(fract(v));
  const sample=(a,b)=>hash((a%columns+columns)%columns,
    (b%rows+rows)%rows,seed);
  return mix(mix(sample(ix,iy),sample(ix+1,iy),tx),
    mix(sample(ix,iy+1),sample(ix+1,iy+1),tx),ty);
}
function generatePlaster(seeds){
  const structure=seeds.structure>>>0,pigment=seeds.pigment>>>0;
  const wear=seeds.wear>>>0;
  const height=new Float32Array(SIZE*SIZE);
  const albedo=new Float32Array(SIZE*SIZE*3);
  const roughness=new Float32Array(SIZE*SIZE);
  const batch=(hash(1,2,pigment)-.5)*.035;
  const cream=(hash(3,4,pigment)-.5)*.021;

  // Three scales of lime aggregate. The large tonal shapes stay quieter
  // than the hand-applied plaster swathes painted below.
  for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
    const p=y*SIZE+x,i=p*3;
    const broad=noise(x,y,4,5,structure^0x5d127a93)-.5;
    const plaster=noise(x,y,13,12,structure^0xb9021a64)-.5;
    const edge=noise(x,y,31,27,structure^0x314c72b5)-.5;
    const aggregate=noise(x,y,87,83,structure^0xb8493251)-.5;
    const grit=hash(x,y,structure^0x164aa387)-.5;
    const wash=noise(x,y,7,9,pigment^0x931a61e3)-.5;
    const grains=noise(x,y,53,49,pigment^0x02d47c59)-.5;
    const age=noise(x,y,15,17,wear^0xa159eb34)-.5;
    const dark=Math.max(0,age*.67+plaster*.4-.13);
    const tone=broad*.046+plaster*.032+edge*.020+
      wash*.036+grains*.014+aggregate*.029+
      grit*.020-dark*.046;
    height[p]=.49+broad*.042+plaster*.034+edge*.026+
      aggregate*.024+grit*.013;
    albedo[i]=clamp(.868+batch+tone,.62,.97);
    albedo[i+1]=clamp(.824+batch*.81+cream+tone*.89,.57,.95);
    albedo[i+2]=clamp(.720+batch*.70+cream*.8+tone*.75,.46,.88);
    roughness[p]=clamp(.885+aggregate*.055+grit*.029+dark*.040,.80,.98);
  }

  // Hand-troweled plaster forms overlapping irregular flat patches, not
  // obvious brush strokes. Broken silhouettes are large enough to read on
  // a medieval game facade, yet the surface stays calm at a distance.
  let state=(structure^0x19c6d147)>>>0;
  const random=()=>{
    state=(state+0x6d2b79f5)>>>0;
    let z=state;
    z=Math.imul(z^(z>>>15),z|1);
    z^=z+Math.imul(z^(z>>>7),z|61);
    return ((z^(z>>>14))>>>0)/4294967296;
  };
  for(let patch=0;patch<370;patch++){
    const cx=random()*SIZE,cy=random()*SIZE;
    const rx=9+random()*26,ry=5+random()*23;
    const angle=random()*Math.PI*2,ca=Math.cos(angle),sa=Math.sin(angle);
    const phase=random()*Math.PI*2,phase2=random()*Math.PI*2;
    const tone=(random()<.52?-1:1)*(.018+random()*.028);
    const raised=(random()<.46?-1:1)*(.010+random()*.022);
    const radius=Math.ceil(Math.max(rx,ry)*1.2);
    for(let oy=-radius;oy<=radius;oy++)for(let ox=-radius;ox<=radius;ox++){
      const along=(ca*ox+sa*oy)/rx;
      const cross=(-sa*ox+ca*oy)/ry;
      const distance=Math.hypot(along,cross);
      if(distance>1.2)continue;
      const theta=Math.atan2(cross,along);
      const outline=1+.10*Math.sin(theta*3+phase)+
        .075*Math.sin(theta*7+phase2)+
        .045*Math.sin(theta*11-phase);
      if(distance>=outline)continue;
      const p=wrap(Math.floor(cy)+oy)*SIZE+
        wrap(Math.floor(cx)+ox),i=p*3;
      const edge=clamp((outline-distance)/.15);
      const opacity=smooth(edge)*.80;
      const rim=Math.exp(-Math.pow((outline-distance-.12)/.10,2));
      const fade=.85+.15*hash(ox,oy,structure^patch);
      for(let c=0;c<3;c++)
        albedo[i+c]=clamp(albedo[i+c]+
          tone*opacity*fade*[1,.90,.77][c],.45,.99);
      height[p]+=raised*(opacity*.60+rim*.36);
      roughness[p]=clamp(roughness[p]+opacity*.016,.78,.99);
    }
  }

  // Tiny sand inclusions and occasional shallow lost plaster chips. These
  // create silhouettes at game viewing distance without fake stone outlines.
  state=(wear^0x7603a5d1)>>>0;
  for(let fleck=0;fleck<950;fleck++){
    const x=Math.floor(random()*SIZE),y=Math.floor(random()*SIZE);
    const radius=random()<.89?1:2+random()*2;
    const shade=(random()<.72?-1:1)*(.011+random()*.034);
    for(let dy=-Math.ceil(radius);dy<=Math.ceil(radius);dy++)
      for(let dx=-Math.ceil(radius);dx<=Math.ceil(radius);dx++){
        const distance=Math.hypot(dx,dy)/radius;
        if(distance>=1)continue;
        const p=wrap(y+dy)*SIZE+wrap(x+dx),i=p*3;
        const mask=(1-smooth(distance))*.8;
        for(let c=0;c<3;c++)
          albedo[i+c]=clamp(albedo[i+c]+shade*mask*[1,.88,.68][c]);
        height[p]-=mask*.018;
        roughness[p]=clamp(roughness[p]+mask*.041,.75,.99);
      }
  }
  return {height,albedo,roughness};
}
export function makePlasterAsset(seeds){
  for(const key of ['structure','pigment','wear'])
    if(!Number.isInteger(seeds?.[key])||seeds[key]<0||seeds[key]>0xffffffff)
      throw Error('Invalid plaster seed: '+key);
  const recipe={structure:seeds.structure,pigment:seeds.pigment,wear:seeds.wear};
  // Cache this recipe's height/color maps for all three inspector channels.
  let maps=null;
  return {
    id:'plaster-lime',kind:'image',width:SIZE,height:SIZE,
    channels:'RGBA',views:PLASTER_VIEWS,sourceSeeds:recipe,
    paint(canvas,view='albedo'){
      if(!PLASTER_VIEWS.includes(view))throw Error('Unknown plaster channel');
      if(!maps)maps=generatePlaster(recipe);
      canvas.width=SIZE;canvas.height=SIZE;
      const ctx=canvas.getContext('2d');
      if(!ctx)throw Error('2D canvas context required');
      const image=ctx.createImageData(SIZE,SIZE);
      for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
        const p=y*SIZE+x,i=p*4;
        if(view==='albedo'){
          for(let c=0;c<3;c++)
            image.data[i+c]=Math.round(255*maps.albedo[p*3+c]);
        }else if(view==='roughness'){
          const v=Math.round(maps.roughness[p]*255);
          image.data[i]=v;image.data[i+1]=v;image.data[i+2]=v;
        }else{
          const sample=(x,y)=>maps.height[wrap(y)*SIZE+wrap(x)];
          const dx=(sample(x+1,y)-sample(x-1,y))*3;
          const dy=(sample(x,y+1)-sample(x,y-1))*3;
          const len=Math.hypot(dx,dy,1);
          image.data[i]=Math.round(127.5*(1-dx/len));
          image.data[i+1]=Math.round(127.5*(1-dy/len));
          image.data[i+2]=Math.round(127.5*(1+1/len));
        }
        image.data[i+3]=255;
      }
      ctx.putImageData(image,0,0);
    },
  };
}
