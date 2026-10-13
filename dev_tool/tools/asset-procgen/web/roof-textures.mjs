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

// A beaver-tail clay roof is a layer of individual ceramic pieces, not a brick
// pattern. Wrapped tile identities keep the same irregularity at image borders.
function renderClay(seeds){
  const pattern=seeds.pattern>>>0,color=seeds.color>>>0;
  const albedo=new Float32Array(SIZE*SIZE*3);
  const height=new Float32Array(SIZE*SIZE);
  const roughness=new Float32Array(SIZE*SIZE);
  const columns=11,rows=10,course=SIZE/rows;
  const geometrySeed=pattern^0x6c87a21f;
  const colorSeed=color^0xb63d48a1;
  const trait=(col,row,salt)=>hash(wrap(col,columns),wrap(row,rows),salt);
  function tileAt(x,y,row){
    const cy=wrap(row,rows);
    const offset=(row&1)*.5+(trait(0,row,geometrySeed^0x92473e6b)-.5)*.11;
    const lane=x*columns/SIZE+offset+
      Math.sin(y*2*Math.PI/SIZE)*.009;
    const joint=k=>k+(trait(k,row,geometrySeed^0xe68af6ed)-.5)*.18;
    let col=Math.floor(lane);
    if(lane<joint(col))col--;
    else if(lane>=joint(col+1))col++;
    const fx=clamp((lane-joint(col))/(joint(col+1)-joint(col)),0,1);
    return {
      fx,cy,
      shape:trait(col,row,geometrySeed),
      tip:trait(col,row,geometrySeed^0x396fa481),
      twist:trait(col,row,geometrySeed^0x74ced816),
      fired:trait(col,row,colorSeed),
      faded:trait(col,row,colorSeed^0x2a18ee9d),
      stain:trait(col,row,colorSeed^0x15d1e9a0),
      fracture:trait(col,row,geometrySeed^0xe3981ab4),
    };
  }
  function tail(t){
    // Rounded lower tips, not points or perfect half-circles. Tile-to-tile
    // shape changes are subtle but visible, especially along course edges.
    const x=clamp(t.fx,0,1);
    const skew=(t.twist-.5)*.13;
    const symmetric=Math.max(0,1-Math.pow(2*(x-.5-skew),2));
    return .10 + (.21+(t.tip-.5)*.075)*Math.pow(symmetric,.75) +
      (t.shape-.5)*.035 + (x-.5)*(t.tip-.5)*.055;
  }
  for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
    const p=y*SIZE+x;
    const row=Math.floor(y/course),fraction=fract(y/course);
    const upper=tileAt(x,y,row-1);
    const visibleUpper=fraction<tail(upper);
    const tile=visibleUpper?upper:tileAt(x,y,row);
    const localY=visibleUpper?fraction+1:fraction;
    const fx=tile.fx;
    const edge=Math.min(fx,1-fx);
    const edgeDepth=1-smooth(clamp((edge-.012)/.085,0,1));
    const overhang=tail(upper);
    const underlap=visibleUpper?0:Math.exp(-Math.pow((fraction-overhang)/.056,2));
    const cutEnd=visibleUpper?Math.exp(-Math.pow((fraction-overhang)/.026,2)):0;
    const belly=Math.pow(Math.sin(Math.PI*fx),1.55);
    const warp=.038*Math.sin(Math.PI*localY)+(tile.shape-.5)*.038;

    // Multiple granular scales, no large muddy blotches or per-tile flat fills.
    const kiln=periodicNoise(x,y,12,color^0x436f35e5)-.5;
    const weather=periodicNoise(x,y,36,color^0x4b1d28c3)-.5;
    const pores=periodicNoise(x,y,85,pattern^0x692be11d)-.5;
    const grain=periodicNoise(x,y,137,color^0x6bec6291)-.5;
    const speck=hash(x,y,pattern^0x79f463df)-.5;
    const salt=hash(x,y,color^0x5a642af0)-.5;
    const runoff=periodicNoise(x,y,19,color^0x97ecb172)-.5;
    const verticalDirt=Math.max(0,.14-Math.abs(fx-(.18+.61*tile.stain+runoff*.10))) *
      Math.max(0,localY-.2);
    const pit=Math.max(0,-pores*.9-grain*.5+salt*.12-.18);
    const mold=Math.max(0,weather*.63+kiln*.3+grain*.2+(tile.stain-.5)*.17-.18);
    const crack=tile.fracture>.965 && localY>.35 && localY<.97 &&
      Math.abs(fx-(.24+.50*tile.fracture+.052*Math.sin(localY*8+tile.twist*4)))<.009;
    const chip=tile.fracture>.926 && edge<.07 && localY>.78 &&
      pores+grain*.6>.17;
    height[p]=.18+belly*.31+warp+cutEnd*.17-edgeDepth*.13-
      underlap*.16 + pores*.052+grain*.024+speck*.010-pit*.047-
      (crack?.06:0)-(chip?.085:0);

    // Color remains a diffuse material property; the near-contact darkening
    // reads as tight dirt-filled crevices rather than painted sunlight.
    const firing=(tile.fired-.5)*.19 + (tile.faded-.5)*.055;
    const fading=(tile.faded-.5)*.10 + kiln*.105 + weather*.075;
    const soot=Math.max(0,-weather*.62-kiln*.28-.07);
    const patina=underlap*.11 + edgeDepth*.08 + verticalDirt*.41+
      pit*.23+soot*.13+(crack?.075:0)+(chip?.07:0);
    const chippedWash=Math.max(0,grain*.5-pores*.46-.10);
    const cold=mold*.22;
    const idx=p*3;
    const base=[.555,.327,.205];
    albedo[idx]=clamp(base[0]+firing+fading*.90+chippedWash*.18-patina*.48-cold*.25,.12,.83);
    albedo[idx+1]=clamp(base[1]+firing*.70+fading*.72+chippedWash*.15-patina*.44+cold*.03,.075,.65);
    albedo[idx+2]=clamp(base[2]+firing*.48+fading*.59+chippedWash*.13-patina*.38-cold*.13,.055,.50);
    roughness[p]=clamp(.80+pit*.23+mold*.08+underlap*.12+edgeDepth*.05+
      Math.max(0,pores)*.09+salt*.06+(tile.faded-.5)*.055,.57,.99);
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
