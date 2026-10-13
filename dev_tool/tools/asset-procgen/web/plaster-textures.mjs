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
  // One shared warm mineral palette. Pigment seed changes the particular
  // batch of lime/sand, not the identity of the material.
  const batch=(hash(1,2,pigment)-.5)*.036;
  const cream=(hash(3,4,pigment)-.5)*.019;
  for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
    const p=y*SIZE+x,i=p*3;
    // Gentle spatula undulations and a granular, imperfect lime surface.
    // All sampled frequencies are periodic to prevent seams on walls.
    const broad=noise(x,y,4,5,structure^0x5d127a93)-.5;
    const sweep=noise(x,y,11,9,structure^0xb9021a64)-.5;
    const sweep2=noise(x,y,17,14,structure^0x314c72b5)-.5;
    const warp=noise(x,y,8,7,structure^0xe034c21a)-.5;
    const aggregate=noise(x+warp*9,y,51,47,structure^0xb8493251)-.5;
    const fine=noise(x,y,113,109,structure^0x7e139ea5)-.5;
    const pore=hash(x,y,structure^0x164aa387)-.5;
    const wash=noise(x,y,6,8,pigment^0x931a61e3)-.5;
    const variation=noise(x,y,24,21,pigment^0x02d47c59)-.5;
    const age=noise(x,y,12,15,wear^0xa159eb34)-.5;
    const grit=hash(x,y,wear^0xbc381e09);
    const exposed=Math.max(0,age*.6+variation*.5-.13);
    const speck=grit>.986?(grit-.986)*3.4:0;
    const raised=(sweep*.045+sweep2*.023+broad*.067+
      aggregate*.025+fine*.012+pore*.006);
    height[p]=.49+raised-speck*.014;
    // Larger soft pigment shifts, smaller trowel patches and slight
    // individual mineral inclusions, not chaotic photo-like grain.
    const tone=broad*.035+sweep*.029+sweep2*.017+
      wash*.036+variation*.020+aggregate*.026+
      fine*.012+pore*.012-exposed*.030-speck*.19;
    albedo[i]=clamp(.851+batch+tone,.64,.96);
    albedo[i+1]=clamp(.812+batch*.81+cream+tone*.91,.58,.94);
    albedo[i+2]=clamp(.719+batch*.70+cream*.8+tone*.77,.48,.88);
    roughness[p]=clamp(.884+aggregate*.043+
      fine*.025+exposed*.039+speck*.08,.78,.98);
  }
  // Very light, broken tool impressions: short, shallow scraped crescents
  // rather than painted cracks or random hard lines on the facade.
  let state=(structure^0x19c6d147)>>>0;
  const random=()=>{
    state=(state+0x6d2b79f5)>>>0;
    let z=state;
    z=Math.imul(z^(z>>>15),z|1);
    z^=z+Math.imul(z^(z>>>7),z|61);
    return ((z^(z>>>14))>>>0)/4294967296;
  };
  for(let mark=0;mark<48;mark++){
    const cx=random()*SIZE,cy=random()*SIZE;
    const angle=random()*Math.PI*2;
    const length=12+random()*64;
    const amplitude=1+random()*3.2;
    const opacity=.2+random()*.65;
    for(let j=0;j<Math.ceil(length);j++){
      const t=j/length,edge=Math.sin(Math.PI*t)**2;
      const along=(t-.5)*length,side=Math.sin(t*Math.PI)*amplitude;
      const px=wrap(Math.floor(cx+Math.cos(angle)*along-
        Math.sin(angle)*side));
      const py=wrap(Math.floor(cy+Math.sin(angle)*along+
        Math.cos(angle)*side));
      const p=py*SIZE+px,i=p*3;
      const strength=edge*opacity;
      height[p]+=.009*strength;
      albedo[i]+=.008*strength;
      albedo[i+1]+=.007*strength;
      albedo[i+2]+=.006*strength;
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
