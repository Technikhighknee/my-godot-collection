// Shared, seed-reproducible roof surfaces. No scene lighting baked into albedo.
// Albedo, normal and roughness maps are derived from the same periodic height field.
// UVs: U along ridge, V downhill; images repeat in both directions.
export const ROOF_TEXTURE_SIZE=512;
export const ROOF_VIEWS=Object.freeze(['albedo','normal','roughness']);
const SIZE=ROOF_TEXTURE_SIZE;
const fract=x=>x-Math.floor(x);
const wrap=(n,size)=>((n%size)+size)%size;
const mix=(a,b,t)=>a*(1-t)+b*t;
const clamp=(v,a=0,b=255)=>Math.max(a,Math.min(b,v));
const smooth=t=>t*t*(3-2*t);
const hash=(x,y,seed)=>{
  let n=(Math.imul(x,374761393)^Math.imul(y,668265263)^seed)>>>0;
  n=Math.imul(n^(n>>>13),1274126177)>>>0;
  return ((n^(n>>>16))>>>0)/4294967295;
};
function sampleClay(u,v,seeds){
  const pattern=seeds.pattern>>>0,color=seeds.color>>>0;
  {
    const cols=8,rows=8;
    const r=Math.floor(v*rows),ry=fract(v*rows);
    const stagger=((wrap(r,rows)%2)===1?.5:0);
    const c=Math.floor(u*cols+stagger),rx=fract(u*cols+stagger);
    const variation=hash(wrap(c,cols),wrap(r,rows),color);
    const chipped=hash(wrap(c,cols),wrap(r,rows),pattern^0x4325);
    const edge=Math.min(rx,1-rx);
    // A curved pan tile, separated by mortar-shadow gaps. The upper lip
    // overlaps the course below; lower tips are rounded, not square pixels.
    const scallop=Math.sin(Math.PI*rx)**2;
    const lip=Math.exp(-Math.pow((ry-.85)/.105,2));
    const rim=Math.exp(-Math.pow((ry-.09)/.07,2));
    const gap=clamp(edge*34,0,1);
    const broken=(chipped>.91&&ry>.87&&rx>.78)?-.16:0;
    const height=(.23+.52*scallop+.26*lip+.11*rim)*gap+broken;
    const micro=(hash(wrap(Math.floor(u*SIZE),SIZE),
      wrap(Math.floor(v*SIZE),SIZE),pattern^39)-.5)*.032;
    const base=[.52,.28,.185].map((n,i)=>n+(.22*variation-.105)*[.90,.68,.52][i]+micro);
    const crevice=gap<.3?.57+gap*1.2:ry<.065?.79:1;
    return {height,base:base.map(n=>n*crevice),
      roughness:clamp(.81+(.5-variation)*.14+micro,.57,.97)};
  }

  throw Error('Unsupported roof material: '+kind);
}
// Tileable value noise prevents a visible seam when the material repeats.
// Fine scales supply fiber dust and weathering, not rows of shingles.
function periodicNoise(x,y,cells,seed){
  const u=x*cells/SIZE,v=y*cells/SIZE;
  const cx=Math.floor(u),cy=Math.floor(v),fx=smooth(fract(u)),fy=smooth(fract(v));
  const a=hash(wrap(cx,cells),wrap(cy,cells),seed);
  const b=hash(wrap(cx+1,cells),wrap(cy,cells),seed);
  const c=hash(wrap(cx,cells),wrap(cy+1,cells),seed);
  const d=hash(wrap(cx+1,cells),wrap(cy+1,cells),seed);
  return mix(mix(a,b,fx),mix(c,d,fx),fy);
}

// Overlapping bundles of fine, tapered stems. Bundles have independent
// origins and lengths; their ends never form artificial horizontal courses.
function renderThatch(seeds){
  const count=SIZE*SIZE;
  const albedo=new Float32Array(count*3);
  const height=new Float32Array(count);
  const roughness=new Float32Array(count);
  const pattern=seeds.pattern>>>0,color=seeds.color>>>0;
  for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
    const i=y*SIZE+x;
    const broad=periodicNoise(x,y,7,color^0x56430b2d)-.5;
    const medium=periodicNoise(x,y,29,color^0x4e8a16cc)-.5;
    const fine=periodicNoise(x,y,79,pattern^0x193ae587)-.5;
    const grain=hash(x,y,color^0x72de20f3)-.5;
    const t=broad*.17+medium*.075+fine*.044+grain*.037;
    albedo[i*3]=.49+t;
    albedo[i*3+1]=.36+t*.80;
    albedo[i*3+2]=.215+t*.65;
    height[i]=.16+medium*.055+fine*.038;
    roughness[i]=.91+medium*.05+fine*.025+grain*.02;
  }

  // Structure and color have separate seeded streams.
  let state=(pattern^0xa56be231)>>>0;
  const random=()=>{
    state=(state+0x6d2b79f5)>>>0;
    let z=state;
    z=Math.imul(z^(z>>>15),z|1);
    z^=z+Math.imul(z^(z>>>7),z|61);
    return ((z^(z>>>14))>>>0)/4294967296;
  };
  for(let bundle=0;bundle<1850;bundle++){
    const cx=random()*SIZE,cy=random()*SIZE;
    const spread=5+random()*12;
    const tilt=(random()-.5)*.24;
    const sway=(random()-.5)*6;
    const bundleTone=(hash(bundle,0,color^0x8f1a4dc7)-.5)*.21;
    const strands=8+Math.floor(random()*10);
    for(let fiber=0;fiber<strands;fiber++){
      const startX=cx+(random()-.5)*spread;
      const startY=cy+(random()-.5)*18;
      const length=18+random()*72;
      const bend=(random()-.5)*4;
      const width=.46+random()*1.05;
      const strandTone=bundleTone+(hash(bundle,fiber,color)-.5)*.18;
      const red=clamp(.48+strandTone,.25,.72);
      const green=clamp(.36+strandTone*.81,.18,.60);
      const blue=clamp(.20+strandTone*.66,.09,.40);
      const ridge=.27+random()*.20;
      const direction=tilt+(random()-.5)*.14;
      const steps=Math.ceil(length);
      for(let step=0;step<=steps;step++){
        const t=step/steps;
        const tip=Math.min(1,step/4,(steps-step)/8);
        if(tip<=0)continue;
        const yy=wrap(Math.floor(startY+step),SIZE);
        const xx=startX+direction*step+(sway+bend)*Math.sin(t*Math.PI);
        const minX=Math.floor(xx-width-1),maxX=Math.ceil(xx+width+1);
        for(let x=minX;x<=maxX;x++){
          const distance=Math.abs((x+.5)-xx);
          const coverage=clamp(width+.5-distance,0,1)*tip;
          if(coverage<=0)continue;
          const i=yy*SIZE+wrap(x,SIZE);
          const alpha=coverage*.74;
          const offset=i*3;
          albedo[offset]=mix(albedo[offset],red,alpha);
          albedo[offset+1]=mix(albedo[offset+1],green,alpha);
          albedo[offset+2]=mix(albedo[offset+2],blue,alpha);
          const center=1-clamp(distance/(width+.25),0,1);
          height[i]=mix(height[i],.18+ridge*center,alpha*.8);
          roughness[i]=mix(roughness[i],.86+strandTone*.10,alpha*.65);
        }
      }
    }
  }
  return {albedo,height,roughness};
}
// Cache only the most recent seed pair. Inspecting three channels should not
// rebuild the fiber field three times; reseeding invalidates the cache.
let lastThatch=null;
function thatchData(seeds){
  if(!lastThatch||lastThatch.pattern!==seeds.pattern||lastThatch.color!==seeds.color)
    lastThatch={pattern:seeds.pattern,color:seeds.color,data:renderThatch(seeds)};
  return lastThatch.data;
}

export function paintRoofTexture(canvas,kind,seeds,view='albedo'){
  if(!['clay','thatch'].includes(kind))throw Error('Unknown roof texture type');
  if(!ROOF_VIEWS.includes(view))throw Error('Unknown roof texture channel');
  for(const k of ['pattern','color'])
    if(!Number.isInteger(seeds?.[k])||seeds[k]<0||seeds[k]>0xffffffff)
      throw Error('Invalid roof texture seed: '+k);
  canvas.width=SIZE;canvas.height=SIZE;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw Error('2D canvas context required');
  const data=ctx.createImageData(SIZE,SIZE);
  const thatch=kind==='thatch'?thatchData(seeds):null;
  for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
    const i=(y*SIZE+x)*4,p=y*SIZE+x;
    if(view==='albedo'){
      const base=thatch?[
        thatch.albedo[p*3],thatch.albedo[p*3+1],thatch.albedo[p*3+2]
      ]:sampleClay((x+.5)/SIZE,(y+.5)/SIZE,seeds).base;
      for(let j=0;j<3;j++)data.data[i+j]=Math.round(clamp(base[j]*255));
    }else if(view==='normal'){
      let dx,dy;
      if(thatch){
        dx=(thatch.height[y*SIZE+wrap(x+1,SIZE)]-
          thatch.height[y*SIZE+wrap(x-1,SIZE)])*1.8;
        dy=(thatch.height[wrap(y+1,SIZE)*SIZE+x]-
          thatch.height[wrap(y-1,SIZE)*SIZE+x])*1.8;
      }else{
        const u=(x+.5)/SIZE,v=(y+.5)/SIZE,delta=1/SIZE;
        dx=(sampleClay(u+delta,v,seeds).height-
          sampleClay(u-delta,v,seeds).height)*1.8;
        dy=(sampleClay(u,v+delta,seeds).height-
          sampleClay(u,v-delta,seeds).height)*1.8;
      }
      const length=Math.hypot(dx,dy,1);
      data.data[i]=Math.round((1-dx/length)*127.5);
      data.data[i+1]=Math.round((1-dy/length)*127.5);
      data.data[i+2]=Math.round((1+1/length)*127.5);
    }else{
      const rough=thatch?thatch.roughness[p]:
        sampleClay((x+.5)/SIZE,(y+.5)/SIZE,seeds).roughness;
      const value=Math.round(255*clamp(rough,0,1));
      data.data[i]=value;data.data[i+1]=value;data.data[i+2]=value;
    }
    data.data[i+3]=255;
  }
  ctx.putImageData(data,0,0);
}
export function makeRoofAsset(kind,seeds){
  return {id:kind==='clay'?'roof-clay':'roof-thatch',kind:'image',
    width:SIZE,height:SIZE,channels:'RGBA',views:ROOF_VIEWS,
    sourceSeeds:{pattern:seeds.pattern,color:seeds.color},
    paint:(canvas,view='albedo')=>paintRoofTexture(canvas,kind,seeds,view)};
}
