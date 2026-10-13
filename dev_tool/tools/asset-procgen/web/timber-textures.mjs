// Tileable hewn timber material: grain runs along V, without board joins.
export const TIMBER_TEXTURE_SIZE=512;
export const TIMBER_VIEWS=Object.freeze(['albedo','normal','roughness']);
export const TIMBER_PROFILES=Object.freeze(['beam','end','panel']);
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
  // Knots distort surrounding fibers rather than being pasted onto planks.
  const knots=[];
  for(let i=0;i<10;i++){
    const strength=hash(i,2,pattern^0x91a47322);
    if(strength<.36)continue;
    knots.push({x:hash(i,0,pattern^0x1f26c8a2)*SIZE,
      y:hash(i,1,pattern^0x629bf38c)*SIZE,
      rx:7+strength*10,ry:14+strength*23,strength});
  }
  const shortest=(a,b)=>((a-b+SIZE*1.5)%SIZE)-SIZE*.5;
  for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
    const p=y*SIZE+x,idx=p*3;
    const large=noise(x,y,6,4,pattern^0xe9812c37)-.5;
    const drift=noise(x,y,13,5,pattern^0x5b319eac)-.5;
    const sway=noise(x,y,23,7,pattern^0x63e274f0)-.5;
    let warp=large*19+drift*10+sway*2.5;
    let eye=0,ring=0,swirl=0;
    for(const knot of knots){
      const dx=shortest(x,knot.x),dy=shortest(y,knot.y);
      const u=dx/knot.rx,v=dy/knot.ry;
      const rad=Math.hypot(u,v);
      if(rad>3.0)continue;
      const fall=Math.exp(-rad*rad*.65);
      warp+=Math.sign(dx||1)*knot.rx*.63*fall*knot.strength;
      swirl+=fall*.45*Math.sin(Math.atan2(v,u)*2)*knot.strength;
      eye+=Math.exp(-rad*rad*8.5)*knot.strength;
      ring+=Math.exp(-Math.pow((rad-.93)/.22,2))*knot.strength;
    }
    const wx=x+warp;
    // Long, irregular anisotropic bands instead of identical sine stripes.
    const band=noise(wx,y,54,5,pattern^0x714852df)-.5;
    const timber=noise(wx,y,29,4,pattern^0x384dcab1)-.5;
    const fine=noise(wx,y,112,9,pattern^0x2de391a6)-.5;
    const pores=noise(wx,y,153,24,pattern^0x7260b7d4)-.5;
    const cross=noise(x,y,21,17,color^0xb8c2153a)-.5;
    const wash=noise(x,y,10,9,color^0x125a33af)-.5;
    const worn=noise(x,y,37,16,color^0x93792d71)-.5;
    const micro=hash(x,y,pattern^0xaed1437b)-.5;
    const darkFiber=Math.max(0,-band-.075);
    const splinter=Math.max(0,-fine-.25)*Math.max(0,-timber+.3);
    const splitMask=Math.max(0,-fine-.40)*Math.max(0,-timber+.12);
    const check=Math.pow(clamp(splitMask*5,0,1),2)*.42;
    height[p]=.30+band*.032+timber*.035+fine*.045+pores*.009+
      swirl*.014-eye*.10+ring*.045-check*.057+micro*.004;
    const colorTone=band*.060+timber*.075+fine*.046+wash*.058+
      worn*.035+cross*.022+micro*.013-swirl*.035-eye*.20-ring*.07-
      check*.10-darkFiber*.035-splinter*.024;
    // Diffuse material pigment; shading is left to the normal map.
    albedo[idx]=clamp(.365+colorTone,.125,.60);
    albedo[idx+1]=clamp(.271+colorTone*.78,.080,.49);
    albedo[idx+2]=clamp(.181+colorTone*.62,.052,.35);
    roughness[p]=clamp(.81+check*.23+eye*.12+
      pores*.07+micro*.036+worn*.05,.63,.98);
  }
  // Broken fibers, drying checks and shallow hand-hewn tool marks.
  // All rasterized strokes wrap at both image edges to remain tileable.
  let state=(pattern^0xa19fc811)>>>0;
  const random=()=>{
    state=(state+0x6d2b79f5)>>>0;
    let z=state;
    z=Math.imul(z^(z>>>15),z|1);
    z^=z+Math.imul(z^(z>>>7),z|61);
    return ((z^(z>>>14))>>>0)/4294967296;
  };
  function stroke(x,y,len,dx,dy,width,strength,rise,red,green,blue,rough){
    const steps=Math.ceil(len);
    const bow=(random()-.5)*3.5;
    for(let step=0;step<steps;step++){
      const t=step/steps;
      const envelope=Math.min(1,step/4,(steps-step)/6);
      if(envelope<=0)continue;
      const sx=x+dx*step+bow*Math.sin(t*Math.PI);
      const sy=y+dy*step;
      const cx=Math.floor(sx),cy=wrap(Math.floor(sy));
      for(let offset=-2;offset<=2;offset++){
        const xx=cx+offset;
        const distance=Math.abs(xx+.5-sx);
        const alpha=clamp(width+.5-distance,0,1)*envelope*strength;
        if(alpha===0)continue;
        const px=wrap(xx),p=cy*SIZE+px,i=p*3;
        albedo[i]=clamp(albedo[i]+red*alpha);
        albedo[i+1]=clamp(albedo[i+1]+green*alpha);
        albedo[i+2]=clamp(albedo[i+2]+blue*alpha);
        height[p]+=rise*alpha;
        roughness[p]=clamp(roughness[p]+rough*alpha);
      }
    }
  }
  for(let i=0;i<6400;i++){
    const x=random()*SIZE,y=random()*SIZE;
    const len=6+Math.pow(random(),1.35)*95;
    const width=.32+random()*1.05;
    const strength=.20+random()*.58;
    const dark=random()<.62;
    const delta=(dark?-1:1)*(.021+random()*.055);
    const tilt=(random()-.5)*.16;
    stroke(x,y,len,tilt,1,width,strength,-delta*.24,
      delta,delta*.80,delta*.60,dark?.023:-.013);
  }
  for(let i=0;i<42;i++){
    const x=random()*SIZE,y=random()*SIZE;
    const len=10+random()*65;
    const tilt=(random()-.5)*.21;
    const strength=.24+random()*.51;
    stroke(x,y,len,tilt,1,.35+random()*.36,strength,-.077,
      -.17,-.145,-.12,.064);
    stroke(x+1.5,y,len*.86,tilt,1,.33,strength*.45,.025,
      .045,.037,.024,-.014);
  }
  for(let i=0;i<90;i++){
    const x=random()*SIZE,y=random()*SIZE;
    const len=5+random()*20;
    const strength=.14+random()*.24;
    stroke(x,y,len,.8+(random()-.5)*.4,.15,.45+random()*.52,
      strength,-.02,-.045,-.035,-.026,.025);
  }
  return {albedo,height,roughness};
}

// End grain is cut across the growth axis. The concentric rings and radial
// seasoning checks are deliberately distinct from the beam's longitudinal grain.
function generateEndGrain(seeds){
  const grain=seeds.grain>>>0,color=seeds.color>>>0;
  const albedo=new Float32Array(SIZE*SIZE*3);
  const height=new Float32Array(SIZE*SIZE);
  const roughness=new Float32Array(SIZE*SIZE);
  const cx=SIZE*(.48+(hash(1,0,grain)-.5)*.09);
  const cy=SIZE*(.51+(hash(0,1,grain)-.5)*.09);
  const checks=[];
  for(let i=0;i<9;i++){
    if(hash(i,3,grain^0xa8b1197e)>.76)continue;
    checks.push({angle:hash(i,4,grain^0xc25fb412)*Math.PI*2,
      length:.35+hash(i,5,grain^0x47e2b1aa)*.56,
      start:.10+hash(i,6,grain^0xa932ac15)*.22});
  }
  for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
    const p=y*SIZE+x,i=p*3;
    const dx=(x-cx)/(.94*SIZE),dy=(y-cy)/(1.03*SIZE);
    const angle=Math.atan2(dy,dx);
    const r=Math.hypot(dx,dy);
    const distortion=noise(x,y,7,8,grain^0x7427ca19)-.5;
    const rings=r*70+Math.sin(angle*5+grain*.00001)*.48+
      distortion*1.70+Math.sin(angle*11+r*31)*.19;
    const late=Math.pow(Math.max(0,Math.sin(rings*Math.PI*2)),5);
    const early=Math.sin(rings*Math.PI*2)*.19;
    const pores=noise(x,y,79,73,grain^0x278ffcf3)-.5;
    const fine=noise(x,y,126,128,grain^0xf0397ce2)-.5;
    const spot=noise(x,y,17,19,color^0xaa13315b)-.5;
    let crack=0;
    for(const check of checks){
      const difference=Math.atan2(Math.sin(angle-check.angle),
        Math.cos(angle-check.angle));
      const wiggle=Math.sin(r*23+check.angle*9)*.018;
      const width=.006+Math.max(0,r-.22)*.008;
      const span=r>check.start && r<check.length;
      if(span)crack=Math.max(crack,Math.exp(-Math.pow((difference-wiggle)/width,2))*
        Math.min(1,(r-check.start)*35,(check.length-r)*35));
    }
    const heart=Math.exp(-r*r*280)*.24;
    const pigment=(spot*.085+pores*.060+fine*.034)-
      late*.115+early*.023-crack*.31-heart;
    albedo[i]=clamp(.38+pigment,.10,.66);
    albedo[i+1]=clamp(.275+pigment*.76,.06,.49);
    albedo[i+2]=clamp(.176+pigment*.59,.04,.34);
    height[p]=.27+early*.07-late*.075+pores*.042+fine*.019-crack*.16;
    roughness[p]=clamp(.84+late*.10+crack*.14+fine*.08,.66,.99);
  }
  return {albedo,height,roughness};
}

// Flat-sawn surfaces show broad flowing figure rather than the tight parallel
// fibers of a narrow structural beam. No painted plank joins or beam edges.
function generateWideWood(seeds){
  const grain=seeds.grain>>>0,color=seeds.color>>>0;
  const albedo=new Float32Array(SIZE*SIZE*3);
  const height=new Float32Array(SIZE*SIZE);
  const roughness=new Float32Array(SIZE*SIZE);
  const knotX=SIZE*(.35+hash(2,1,grain)*.3);
  const knotY=SIZE*(.28+hash(3,1,grain)*.4);
  for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
    const p=y*SIZE+x,i=p*3;
    const dx=((x-knotX+SIZE*1.5)%SIZE)-SIZE*.5;
    const dy=((y-knotY+SIZE*1.5)%SIZE)-SIZE*.5;
    const elliptical=Math.hypot(dx/32,dy/92);
    const warp=noise(x,y,8,5,grain^0x119ebc65)-.5;
    const finer=noise(x,y,62,11,grain^0x45fe1a8d)-.5;
    const flowing=noise(x,y,23,6,grain^0x5c911e24)-.5;
    const pigment=noise(x,y,9,11,color^0x1da58e73)-.5;
    const grainLine=Math.sin((x/512*21+warp*.45+
      Math.exp(-elliptical*elliptical*.60)*dx*.020+
      flowing*.28)*Math.PI*2);
    const figure=grainLine*.55+finer*.26+flowing*.70;
    const curl=Math.exp(-Math.pow((elliptical-.85)/.32,2));
    const eye=Math.exp(-elliptical*elliptical*8);
    const pores=noise(x,y,137,38,grain^0xba091abc)-.5;
    const value=figure*.072+pigment*.080+pores*.029-
      curl*.040-eye*.12;
    albedo[i]=clamp(.375+value,.13,.62);
    albedo[i+1]=clamp(.273+value*.78,.075,.49);
    albedo[i+2]=clamp(.181+value*.60,.05,.35);
    height[p]=.29+figure*.047+finer*.024+pores*.022-curl*.035-eye*.06;
    roughness[p]=clamp(.82+pores*.080+curl*.048-eye*.08,.64,.98);
  }
  return {albedo,height,roughness};
}
let cache=null;
function material(seeds,profile){
  if(!cache||cache.grain!==seeds.grain||cache.color!==seeds.color)
    cache={grain:seeds.grain,color:seeds.color,profiles:new Map()};
  if(!cache.profiles.has(profile)){
    const generate={beam:generateTimber,end:generateEndGrain,panel:generateWideWood}[profile];
    cache.profiles.set(profile,generate(seeds));
  }
  return cache.profiles.get(profile);
}
export function paintTimberTexture(canvas,seeds,view='albedo',profile='beam'){
  if(!TIMBER_VIEWS.includes(view))throw Error('Unknown timber texture channel');
  if(!TIMBER_PROFILES.includes(profile))throw Error('Unknown timber profile');
  for(const key of ['grain','color'])if(!Number.isInteger(seeds?.[key])||
    seeds[key]<0||seeds[key]>0xffffffff)throw Error('Invalid timber seed: '+key);
  canvas.width=SIZE;canvas.height=SIZE;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw Error('2D canvas context required');
  const image=ctx.createImageData(SIZE,SIZE),d=image.data,m=material(seeds,profile);
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
    channels:'RGBA',views:TIMBER_VIEWS,profiles:TIMBER_PROFILES,
    sourceSeeds:{grain:seeds.grain,color:seeds.color},
    paint:(canvas,view='albedo',profile='beam')=>
      paintTimberTexture(canvas,seeds,view,profile)};
}
