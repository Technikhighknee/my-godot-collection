// Native alternative procedural grammars for the Texture Style Study.
// Every material is re-authored from its semantic seeds: no recoloring or
// processing of pixels from the original generator. Experimental, non-persisted
// study only. Each grammar yields matching albedo/height/roughness maps.
export const MATERIAL_STUDY_STYLES=Object.freeze([
  'hand-painted-study','retro-3d-study',
]);
const W=512;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a+(b-a)*t;
const smooth=t=>{t=clamp(t);return t*t*(3-2*t);};
const wrap=(v,n)=>(v%n+n)%n;
function hash(x,y,seed){
  let n=(Math.imul(x,374761393)^Math.imul(y,668265263)^(seed>>>0))>>>0;
  n=Math.imul(n^(n>>>13),1274126177);
  return ((n^(n>>>16))>>>0)/4294967296;
}
function noise(x,y,width,height,columns,rows,seed){
  const u=x*columns/width,v=y*rows/height;
  const ix=Math.floor(u),iy=Math.floor(v),fx=smooth(u-ix),fy=smooth(v-iy);
  const sample=(a,b)=>hash(wrap(a,columns),wrap(b,rows),seed);
  return mix(mix(sample(ix,iy),sample(ix+1,iy),fx),
    mix(sample(ix,iy+1),sample(ix+1,iy+1),fx),fy)-.5;
}
function allocate(width,height){
  const count=width*height;
  return {width,height,albedo:new Float32Array(count*3),
    heightMap:new Float32Array(count),roughness:new Float32Array(count)};
}
function colorize(m,p,rgb,height,rough){
  const i=p*3;
  for(let c=0;c<3;c++)m.albedo[i+c]=clamp(rgb[c]);
  m.heightMap[p]=clamp(height);m.roughness[p]=clamp(rough);
}
// Ensure periodic border pixels for every generated channel. Work on the
// native raster *before* retro upscaling, keeping texels and tangent normals
// consistent when the surface wraps on a building.
function weldSeams(m){
  const {width:w,height:h,albedo,heightMap,roughness}=m;
  const margin=Math.max(3,Math.floor(Math.min(w,h)*.035));
  const blendPair=(a,b,t)=>{
    for(let c=0;c<3;c++){
      const ia=a*3+c,ib=b*3+c;
      const midpoint=(albedo[ia]+albedo[ib])*.5;
      albedo[ia]=mix(albedo[ia],midpoint,t);
      albedo[ib]=mix(albedo[ib],midpoint,t);
    }
    const median=(heightMap[a]+heightMap[b])*.5;
    heightMap[a]=mix(heightMap[a],median,t);
    heightMap[b]=mix(heightMap[b],median,t);
    const rough=(roughness[a]+roughness[b])*.5;
    roughness[a]=mix(roughness[a],rough,t);
    roughness[b]=mix(roughness[b],rough,t);
  };
  for(let y=0;y<h;y++)for(let k=0;k<margin;k++){
    blendPair(y*w+k,y*w+(w-1-k),1-smooth(k/margin));
  }
  for(let x=0;x<w;x++)for(let k=0;k<margin;k++){
    blendPair(k*w+x,(h-1-k)*w+x,1-smooth(k/margin));
  }
  return m;
}
function prepareMaterialContext(material,{structure,pigment,retro}){
  if(material==='plaster-lime'){
    const count=retro?13:19,strokes=[];
    for(let k=0;k<count;k++){
      const angle=(hash(k,2,structure^0x9471a3bc)-.5)*1.25;
      strokes.push({
        cx:hash(k,0,structure^0x519ca2e4),
        cy:hash(k,1,structure^0x38d7ab52),
        ca:Math.cos(angle),sa:Math.sin(angle),
        length:.13+hash(k,3,structure^0x18af739c)*.19,
        width:.025+hash(k,4,structure^0x7a5913fe)*.045,
        weight:hash(k,7,structure^0x6f37b4c9)-.5,
      });
    }
    return {strokes};
  }
  if(material==='stone-rubble'){
    const cols=retro?9:7,rows=retro?9:7,sites=[];
    for(let iy=0;iy<rows;iy++)for(let ix=0;ix<cols;ix++)
      sites.push({
        jx:(hash(ix,iy,structure^0xa137bd21)-.5)*(retro?.70:.91),
        jy:(hash(ix,iy,structure^0x7f1829ad)-.5)*(retro?.72:.92),
        wf:.74+hash(ix,iy,structure^0x23b91ced)*.52,
        af:.75+hash(ix,iy,structure^0x91d782ad)*.43,
        weight:(hash(ix,iy,structure^0x41c529e3)-.5)*.25,
        variation:hash(ix,iy,structure^0x48da51b1),
        color:(hash(ix,iy,pigment^0xa96d325c)-.5)*
          (retro?.20:.21),
      });
    return {cols,rows,sites};
  }
  return {};
}
function raster(material,style,seeds,profile){
  const retro=style==='retro-3d-study',scale=retro?4:1;
  const height=material==='timber-oak'&&profile==='beam'?2048:W;
  const width=W;
  const w=width/scale,h=height/scale,m=allocate(w,h);
  const structure=(seeds.pattern??seeds.grain??seeds.structure??
    seeds.layout)>>>0;
  const pigment=(seeds.color??seeds.pigment??seeds.mineral)>>>0;
  const weather=(seeds.wear??seeds.weather??pigment)>>>0;
  const dimensions={w,h,structure,pigment,weather,retro,
    ...prepareMaterialContext(material,{structure,pigment,retro})};
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const p=y*w+x;
    let result;
    switch(material){
      case 'roof-thatch':
        result=thatch(x,y,dimensions);break;
      case 'timber-oak':
        result=wood(x,y,dimensions,profile);break;
      case 'plaster-lime':
        result=plaster(x,y,dimensions);break;
      case 'stone-rubble':
        result=stone(x,y,dimensions);break;
      default:throw Error('Unknown native study material: '+material);
    }
    colorize(m,p,result.rgb,result.z,result.rough);
  }
  weldSeams(m);
  if(!retro)return m;
  // Pixel-perfect low-resolution *geometry*. All three maps are generated
  // at native 128px density before nearest-neighbour enlargement.
  const full=allocate(width,height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const src=Math.floor(y/scale)*w+Math.floor(x/scale),dst=y*width+x;
    full.albedo.set(m.albedo.subarray(src*3,src*3+3),dst*3);
    full.heightMap[dst]=m.heightMap[src];
    full.roughness[dst]=m.roughness[src];
  }
  return full;
}
function thatch(x,y,{w,h,structure,pigment,retro}){
  // A thatched roof reads as dense, dangling straw. Avoid rectangular
  // bundles: each fiber belongs to an irregular overlapping course, with a
  // staggered and frayed lower edge instead of an artificial tile boundary.
  const u=x/w,v=y/h;
  const courses=retro?6:8,strands=retro?67:117;
  const sweep=noise(x,y,w,h,6,5,structure^0x73fd56a8)*.16;
  const fiberPos=u*strands+sweep*2.2;
  const fiber=Math.floor(fiberPos);
  const f=wrap(fiberPos,1)-.5;
  const fiberOffset=hash(wrap(fiber,strands),0,structure^0x91ac728b)-.5;
  const rowPos=v*courses+fiberOffset*.27+
    noise(x,y,w,h,7,6,structure^0x213b79fa)*.29;
  const row=Math.floor(rowPos),down=wrap(rowPos,1);
  const rowId=wrap(row,courses),strandId=wrap(fiber,strands);
  const fork=hash(strandId,rowId,structure^0x8a3f711d);
  const tip=clamp(.79+(fork-.5)*.36,.60,.98);
  // Tip silhouettes feather into the next layer; narrow longitudinal
  // shafts continue across the entire exposure instead of looking tiled.
  const fray=smooth((tip-down)/.18);
  const falloff=smooth((down-.02)/.19);
  const brightness=hash(strandId,rowId,pigment^0xf3928a13)-.5;
  const shafts=Math.pow(Math.max(0,1-Math.abs(f)*2),retro?2:3);
  const splits=noise(x,y,w,h,retro?31:80,retro?17:26,
    structure^0x2f87a55b);
  const warp=noise(x,y,w,h,19,7,structure^0x64b2c8d1);
  const darkFiber=Math.exp(-Math.pow(f/(retro?.18:.14),2));
  const organic=shafts*.052*(.65+.35*falloff)-
    darkFiber*.043+splits*.038+warp*.033;
  const strata=(fray*.07-(1-fray)*.025)*falloff;
  const relief=.32+organic*.72+shafts*.045+
    fray*.047+falloff*.018;
  const mineral=noise(x,y,w,h,8,7,pigment^0x473aa510);
  const reedColor=retro?[.625,.515,.302]:[.694,.573,.338];
  const tint=brightness*.18+mineral*.10+organic*.65+strata;
  return {rgb:[reedColor[0]+tint,
      reedColor[1]+tint*.84,reedColor[2]+tint*.63],
    z:relief,rough:clamp(.92+splits*.053+(1-fray)*.043)};
}

function wood(x,y,{w,h,structure,pigment,retro},profile){
  // Longitudinal grain follows stretched, domain-warped noise rather than
  // uniformly spaced sine waves. Knots are sparse local disturbances, not
  // a repeated full-surface contour-line effect.
  const u=x/w,v=y/h;
  const len=profile==='beam'?19:5;
  const low=noise(x,y,w,h,5,len,structure^0x9a4d83b1);
  const bend=noise(x,y,w,h,9,len+2,structure^0xb836dce1);
  const knots=profile==='end'?0:(retro?3:4);
  let knotBody=0,knotRing=0,displace=0;
  if(profile!=='end')for(let k=0;k<knots;k++){
    const cx=hash(k,1,structure^0x32f581ac);
    const cy=hash(k,2,structure^0x6d25cb31);
    const dx=Math.min(Math.abs(u-cx),1-Math.abs(u-cx));
    const dy=Math.min(Math.abs(v-cy),1-Math.abs(v-cy));
    const distance=Math.hypot(dx/(retro?.045:.035),
      dy/(retro?.080:.055));
    const eye=Math.exp(-distance*distance*1.6);
    const halo=Math.exp(-Math.pow((distance-1.24)/.42,2));
    knotBody+=eye;
    knotRing+=halo;
    displace+=(u-cx)*Math.exp(-distance*distance*.9)*.30;
  }
  let grain,relief;
  if(profile==='end'){
    const dx=Math.min(Math.abs(u-.48),1-Math.abs(u-.48));
    const dy=Math.min(Math.abs(v-.51),1-Math.abs(v-.51));
    const radius=Math.hypot(dx,dy)*2;
    const warped=radius+(low+bend*.5)*.034;
    grain=Math.sin(warped*Math.PI*(retro?26:44))*.054+
      noise(x,y,w,h,retro?29:73,retro?29:73,
        structure^0x74ac7de1)*.062;
    relief=.36+grain*.35+low*.055;
  }else{
    // Anisotropic multi-octave fiber fields make irregular interrupted
    // growth bands. The narrow dark cracks only appear locally.
    const offset=(bend*.022+low*.014+displace)*w;
    const g1=noise(x+offset,y,w,h,retro?33:65,len+2,
      structure^0xd291c4e3);
    const g2=noise(x+offset*.7,y,w,h,retro?65:121,len+7,
      structure^0x87a294cd);
    const g3=noise(x+offset*.31,y,w,h,retro?17:31,len+1,
      structure^0xe87bd241);
    const dry=noise(x,y,w,h,retro?27:53,len+4,
      structure^0x3249b7a6);
    const crack=Math.max(0,-g2-.23)*
      Math.max(0,.14+g3+dry*.4);
    grain=g1*.14+g2*.085+g3*.078+low*.07-
      crack*.24-knotBody*.23-knotRing*.065;
    relief=.38+g1*.066+g2*.029+g3*.038+low*.035-
      knotBody*.16-knotRing*.045;
  }
  const aged=noise(x,y,w,h,9,len+2,pigment^0xd73431ef);
  const heart=hash(3,9,pigment^0xa831db2a)-.5;
  const tone=grain+aged*.07+heart*.057;
  const base=retro?[.50,.339,.218]:[.525,.358,.226];
  return {rgb:[base[0]+tone,base[1]+tone*.80,
      base[2]+tone*.59],
    z:relief,rough:clamp(.85+low*.066+knotBody*.13)};
}

function plaster(x,y,{w,h,structure,pigment,weather,retro,strokes}){
  // Broad, overlapping hand-applied lime-plaster strokes. Brush/trowel
  // geometry is authored by the structure seed, NOT by the tint seed.
  // Distinct raised feathered boundaries replace quantized cloudy blobs.
  const u=x/w,v=y/h;
  let raised=0,edgeLip=0,strokeTone=0;
  for(const stroke of strokes){
    const {ca,sa,length,width,weight}=stroke;
    const dx=wrap(u-stroke.cx+.5,1)-.5;
    const dy=wrap(v-stroke.cy+.5,1)-.5;
    const along=dx*ca+dy*sa,across=-dx*sa+dy*ca;
    const curve=Math.sin((along/length)*Math.PI*.65)*
      width*.11;
    const ellipse=Math.hypot(along/length,(across-curve)/width);
    const cover=1-smooth((ellipse-(retro?.68:.73))/
      (retro?.22:.24));
    const rim=smooth((ellipse-.73)/.09)*
      (1-smooth((ellipse-.99)/.06))*cover;
    raised+=cover*(.031+weight*.022);
    edgeLip+=rim*(.011+Math.abs(weight)*.01);
    strokeTone+=cover*(weight*.036);
  }
  const fine=noise(x,y,w,h,retro?23:79,retro?25:83,
    structure^0x563e11a8);
  const plasterGrain=noise(x,y,w,h,retro?19:47,retro?17:49,
    structure^0x94b71f52);
  const patch=noise(x,y,w,h,8,7,structure^0x52ba8e17);
  const wash=noise(x,y,w,h,8,8,pigment^0x94e13d2f);
  const wear=noise(x,y,w,h,11,13,weather^0x2f83cdea);
  const grime=Math.max(0,wear+patch*.37-.18);
  const swish=noise(x+y*.21,y,w,h,retro?24:41,retro?9:14,
    structure^0x9a17d256);
  const grit=hash(x,y,structure^0x4e91c3a7);
  const pit=grit>.936?(grit-.936)*(.55+Math.max(0,patch))*.85:0;
  const chipped=retro?Math.max(0,-patch-.19)*.080:0;
  const tone=wash*.046+patch*.032+strokeTone+
    swish*(retro?.031:.038)-grime*.080+
    plasterGrain*.035-pit-chipped;
  const base=retro?[.84,.765,.641]:[.9,.842,.722];
  return {rgb:[base[0]+tone,base[1]+tone*.91,
      base[2]+tone*.75],
    z:.435+raised+edgeLip+fine*.017+plasterGrain*.037+
      swish*.016-pit*.36-chipped*.42,
    rough:clamp(.88+fine*.04+grime*.095+pit*.12)};
}

function stone(x,y,{w,h,structure,pigment,weather,retro,
  cols,rows,sites}){
  // Weighted, periodic Voronoi sites are prepared once per raster.
  // Neighbor lookup is material grammar, not brick-course indexing.
  const bendX=retro?0:noise(x,y,w,h,12,10,
    structure^0x9e4273b1)*.15;
  const bendY=retro?0:noise(x,y,w,h,11,13,
    structure^0x6d21ac53)*.15;
  const u=x/w*cols+bendX,v=y/h*rows+bendY;
  const gx=Math.floor(u),gy=Math.floor(v);
  let first=1e9,second=1e9;
  let chosenVariation=0,chosenColor=0;
  for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){
    const cx=gx+i,cy=gy+j,ix=wrap(cx,cols),iy=wrap(cy,rows);
    const site=sites[iy*cols+ix];
    const dx=u-(cx+.5+site.jx),dy=v-(cy+.5+site.jy);
    const dist=(dx*dx*site.wf+dy*dy*site.af)-site.weight;
    if(dist<first){
      second=first;first=dist;
      chosenVariation=site.variation;chosenColor=site.color;
    }else if(dist<second)second=dist;
  }
  // Face is a polygon-ish chipped cobble, with a broad chamfer and muted
  // mortar. Retro still samples this stone geometry at coarse texel density.
  const edge=second-first;
  const face=smooth((edge-(retro?.045:.025))/(retro?.27:.32));
  const crown=smooth((edge-.02)/.65);
  const grain=noise(x,y,w,h,retro?25:61,retro?29:57,
    structure^0x8d2e17f4);
  const crack=noise(x,y,w,h,retro?16:42,retro?22:43,
    structure^0xc8517e2b);
  const mineral=noise(x,y,w,h,11,12,pigment^0xe7c4591a);
  const age=noise(x,y,w,h,13,14,weather^0x291fe71c);
  const varColor=chosenColor;
  const base=retro?[.588,.552,.477]:[.675,.641,.56];
  const mortar=retro?[.42,.40,.367]:[.48,.455,.415];
  const weathered=varColor+mineral*.064+grain*.045-
    Math.max(0,age)*.11;
  const splinter=Math.max(0,-crack-.29)*face;
  const rgb=base.map((v,c)=>mix(mortar[c],
    v+weathered*[1,.88,.68][c]-splinter*.08,face));
  return {rgb,z:.20+crown*(.27+chosenVariation*.10)+
      grain*.025*face-splinter*.07,
    rough:clamp(mix(.96,.84+grain*.065+
      Math.max(0,age)*.08,face))};
}

function weldNormalEdges(d,width,height,step){
  const levels=step===4?4:12;
  const blendBlocks=(a,b,weight,stride)=>{
    for(let c=0;c<3;c++){
      const ia=a+c,ib=b+c;
      const mean=(d[ia]+d[ib])*.5;
      const av=Math.round(mix(d[ia],mean,weight));
      const bv=Math.round(mix(d[ib],mean,weight));
      for(let pixel=0;pixel<step;pixel++){
        d[ia+pixel*stride]=av;
        d[ib-pixel*stride]=bv;
      }
    }
  };
  for(let y=0;y<height;y++)for(let k=0;k<levels;k++){
    const a=(y*width+k*step)*4;
    const b=(y*width+(width-1-k*step))*4;
    blendBlocks(a,b,1-smooth(k/levels),4);
  }
  for(let x=0;x<width;x++)for(let k=0;k<levels;k++){
    const a=(k*step*width+x)*4;
    const b=((height-1-k*step)*width+x)*4;
    blendBlocks(a,b,1-smooth(k/levels),width*4);
  }
}
function validate(material,style,seeds){
  if(!['roof-thatch','timber-oak','plaster-lime','stone-rubble'].includes(material))
    throw Error('Unknown native study material: '+material);
  if(!MATERIAL_STUDY_STYLES.includes(style))
    throw Error('Unsupported material generation style: '+style);
  const keys={
    'roof-thatch':['pattern','color'],
    'timber-oak':['grain','color'],
    'plaster-lime':['structure','pigment','wear'],
    'stone-rubble':['layout','mineral','weather'],
  }[material];
  for(const key of keys)
    if(!Number.isInteger(seeds?.[key])||seeds[key]<0||
       seeds[key]>0xffffffff)
      throw Error('Invalid native material seed: '+key);
}
export function makeStyledMaterialAsset(material,seeds,style){
  validate(material,style,seeds);
  const recipe={...seeds},views=Object.freeze(['albedo','normal','roughness']);
  const profiles=material==='timber-oak'?Object.freeze(['beam','end','panel']):null;
  const width=W,height=material==='timber-oak'?2048:W;
  const cache=new Map();
  return {
    id:material,kind:'image',width,height,channels:'RGBA',views,
    ...(profiles?{profiles,profileSizes:{
      beam:{width:W,height:2048},end:{width:W,height:W},
      panel:{width:W,height:W}}}:{}),
    sourceSeeds:recipe,sourceStyle:style,
    paint(canvas,view='albedo',profile=material==='timber-oak'?'beam':null){
      if(!views.includes(view))throw Error('Unknown study texture channel');
      if(profiles&&!profiles.includes(profile))throw Error('Unknown timber profile');
      if(!cache.has(profile)){
        cache.set(profile,raster(material,style,recipe,profile));
      }
      const maps=cache.get(profile),w=maps.width,h=maps.height;
      canvas.width=w;canvas.height=h;
      const ctx=canvas.getContext('2d');
      if(!ctx)throw Error('2D canvas context required');
      const image=ctx.createImageData(w,h);
      const d=image.data,retro=style==='retro-3d-study';
      const step=retro?4:1;
      const at=(x,y)=>maps.heightMap[
        (profiles&&profile==='end'?clamp(y,0,h-1):wrap(y,h))*w+
        (profiles&&profile==='end'?clamp(x,0,w-1):wrap(x,w))];
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        const p=y*w+x,i=p*4;
        if(view==='albedo'){
          for(let c=0;c<3;c++)d[i+c]=Math.round(maps.albedo[p*3+c]*255);
        }else if(view==='roughness'){
          const value=Math.round(maps.roughness[p]*255);
          d[i]=value;d[i+1]=value;d[i+2]=value;
        }else{
          const cx=retro?Math.floor(x/4)*4+2:x;
          const cy=retro?Math.floor(y/4)*4+2:y;
          const dx=(at(cx+step,cy)-at(cx-step,cy))*2.4;
          const dy=(at(cx,cy+step)-at(cx,cy-step))*2.4;
          const length=Math.hypot(dx,dy,1);
          d[i]=Math.round((1-dx/length)*127.5);
          d[i+1]=Math.round((1-dy/length)*127.5);
          d[i+2]=Math.round((1+1/length)*127.5);
        }
        d[i+3]=255;
      }
      if(view==='normal')weldNormalEdges(d,w,h,step);
      ctx.putImageData(image,0,0);
    },
  };
}
