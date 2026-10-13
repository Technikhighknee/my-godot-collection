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

// Clay roof: overlapping, slightly crooked beaver-tail tiles, not bricks.
// Each new course hides the heads of the course below. The exposed tails of
// the course above have real scalloped outlines; there is no mortar grid.
// A common height field drives normal and roughness, without painted light.
function renderClay(seeds){
  const pattern=seeds.pattern>>>0,color=seeds.color>>>0;
  const albedo=new Float32Array(SIZE*SIZE*3);
  const height=new Float32Array(SIZE*SIZE);
  const roughness=new Float32Array(SIZE*SIZE);
  const columns=11,rows=10;
  const cellH=SIZE/rows;
  const geomSalt=pattern^0x6c87a21f;
  const toneSalt=color^0xb63d48a1;
  // A single tile's local coordinate and identity across a continuous field;
  // use wrapped IDs only for randomized features, never for position.
  function tileAt(x,y,row){
    const shift=(row&1)*.5;
    const lean=Math.sin(2*Math.PI*y*rows/SIZE)*.008;
    const lane=x*columns/SIZE+shift+lean;
    let col=Math.floor(lane);
    const cy=wrap(row,rows);
    const joint=k=>k+(hash(wrap(k,columns),cy,geomSalt^0xe68af6ed)-.5)*.090;
    if(lane<joint(col))col--;
    else if(lane>=joint(col+1))col++;
    const fx=(lane-joint(col))/(joint(col+1)-joint(col));
    const cx=wrap(col,columns);
    const wobble=hash(cx,cy,geomSalt);
    const shade=hash(cx,cy,toneSalt);
    const weather=hash(cx,cy,color^0x13f17ce9);
    const bend=hash(cx,cy,pattern^0xf13ac780);
    return {fx,col,cx,cy,wobble,shade,weather,bend};
  }
  for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
    const p=y*SIZE+x;
    const ry=y/cellH;
    const row=Math.floor(ry);
    const frac=ry-row;
    const upper=tileAt(x,y,row-1);
    // The upper tile's tail hangs over the next course, varying by shape.
    // A rounded bottom extends farther at the center than near its corners.
    const arc=Math.pow(Math.sin(Math.PI*upper.fx),.75);
    const tail=.095+.225*arc+(upper.wobble-.5)*.038;
    const onUpper=frac<tail;
    const tile=onUpper?upper:tileAt(x,y,row);
    const localY=onUpper?frac+1:frac;
    const faceX=tile.fx;
    const left=Math.min(faceX,1-faceX);
    // The center of a fired tile subtly crowns out of the roof plane.
    // Narrow side grooves carry the water downhill along each course.
    const ceramicBelly=.14+.40*Math.pow(Math.sin(Math.PI*clamp(faceX,0,1)),1.18)+
      .055*Math.sin(Math.PI*localY/.95) + (tile.bend-.5)*.05;
    const lip=onUpper?Math.exp(-Math.pow((frac-tail+.033)/.04,2))*.20:0;
    const seamDepth=1-smooth(clamp((left-.014)/.075,0,1));

    // Coherent, multi-scale ceramic pores, slips, firing spots and runoff.
    const broad=periodicNoise(x,y,7,color^0x436f35e5)-.5;
    const pits=periodicNoise(x,y,47,pattern^0x692be11d)-.5;
    const blister=periodicNoise(x,y,83,color^0x6bec6291)-.5;
    const pebbles=periodicNoise(x,y,102,color^0x594c2971)-.5;
    const speck=hash(x,y,pattern^0x79f463df)-.5;
    const grit=hash(x,y,color^0x5a642af0)-.5;
    const worn=periodicNoise(x,y,25,color^0xcd56aa93)-.5;
    // Subtle vertical firing / erosion trails, per tile, so they can't form
    // horizontal bands or align across all shingles.
    const run=periodicNoise(x,y,19,color^0x97ecb172)-.5;
    const streak=Math.max(0,.23-Math.abs(faceX-(.22+.52*tile.weather+run*.10)))
      *(.16+Math.max(0,worn)*.38);
    const pores=Math.max(0,pits*.57+pebbles*.51+blister*.22+speck*.22-.09);
    const clinker=Math.max(0,blister*.65+pits*.45+grit*.16-.12);
    const salt=Math.max(0,-worn*.75-pebbles*.4+blister*.3-.11);
    const moss=Math.max(0,blister*.60+broad*.55+worn*.48+(tile.weather-.5)*.18-.21);
    const fractureX=.29+.31*tile.weather + .055*Math.sin(localY*5+tile.wobble*6);
    const crack=tile.bend>.958 && localY>.35 && localY<1.04 &&
      Math.abs(faceX-fractureX)<.018;
    const chipped=tile.bend>.92 && left<.095 && localY>.75 &&
      Math.abs(pits+pebbles*.7)>.21;
    const h=ceramicBelly+lip-seamDepth*.17 - (onUpper?0:.13) +
      pits*.045+pebbles*.024+blister*.026+speck*.017+
      clinker*.022-pores*.05-(chipped?.12:0)-(crack?.07:0);
    height[p]=h;

    // Clay is kiln-fired with locally varied ochre, brick and muted rose
    // pigments. Grime gathers in narrow gaps and pits, not across bands.
    const warm=(tile.shade-.5)*.18 + broad*.094 + worn*.095 + blister*.052;
    const burnt=(tile.weather-.5)*.085 + (tile.wobble-.5)*.035;
    const earth=Math.max(0,worn*.70+broad*.55+pits*.54+blister*.23+.02);
    const dirt=pores*.28+clinker*.15+streak*.45+seamDepth*.14+
      (chipped?.09:0)+(crack?.20:0)+moss*.25;
    const lichens=moss*.40;
    const fired=clinker*.22;
    const chalk=salt*.29;
    const ochre=[.56,.325,.194];
    const idx=p*3;
    albedo[idx]=clamp(ochre[0]+warm+burnt-earth*.16-dirt*.50-fired*.36+chalk*.33-lichens*.27,.12,.78);
    albedo[idx+1]=clamp(ochre[1]+warm*.72-burnt*.10-earth*.14-dirt*.42-fired*.30+chalk*.31-lichens*.09,.08,.56);
    albedo[idx+2]=clamp(ochre[2]+warm*.55-burnt*.13-earth*.105-dirt*.37-fired*.25+chalk*.26-lichens*.34,.055,.43);
    roughness[p]=clamp(.78+pores*.22+clinker*.12+Math.max(0,pits)*.10+
      seamDepth*.12+streak*.38+moss*.26+(tile.weather-.5)*.06,.60,.99);
  }
  return {albedo,height,roughness};
}
let lastClay=null;
function clayData(seeds){
  if(!lastClay||lastClay.pattern!==seeds.pattern||lastClay.color!==seeds.color)
    lastClay={pattern:seeds.pattern,color:seeds.color,data:renderClay(seeds)};
  return lastClay.data;
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
  const material=kind==='thatch'?thatchData(seeds):clayData(seeds);
  for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
    const i=(y*SIZE+x)*4;
    const p=y*SIZE+x;
    if(view==='albedo'){
      const base=[material.albedo[p*3],material.albedo[p*3+1],material.albedo[p*3+2]];
      for(let j=0;j<3;j++)data.data[i+j]=Math.round(clamp(base[j]*255));
    }else if(view==='normal'){
      const dx=(material.height[y*SIZE+wrap(x+1,SIZE)]-
        material.height[y*SIZE+wrap(x-1,SIZE)])*1.8;
      const dy=(material.height[wrap(y+1,SIZE)*SIZE+x]-
        material.height[wrap(y-1,SIZE)*SIZE+x])*1.8;
      const length=Math.hypot(dx,dy,1);
      data.data[i]=Math.round((1-dx/length)*127.5);
      data.data[i+1]=Math.round((1-dy/length)*127.5);
      data.data[i+2]=Math.round((1+1/length)*127.5);
    }else{
      const value=Math.round(255*clamp(material.roughness[p],0,1));
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
