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
function raster(material,style,seeds,profile){
  const retro=style==='retro-3d-study',scale=retro?4:1;
  const height=material==='timber-oak'&&profile==='beam'?2048:W;
  const width=W;
  const w=width/scale,h=height/scale,m=allocate(w,h);
  const structure=(seeds.pattern??seeds.grain??seeds.structure??
    seeds.layout)>>>0;
  const pigment=(seeds.color??seeds.pigment??seeds.mineral)>>>0;
  const weather=(seeds.wear??seeds.weather??pigment)>>>0;
  const dimensions={w,h,structure,pigment,weather,retro};
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
  // Coarse overlapping sheaves are part of the actual height geometry;
  // periodic longitudinal fibers sit inside each sheaf, not confetti dots.
  const bundles=retro?13:23,courses=retro?8:11;
  const u=x/w,v=y/h;
  const drift=noise(x,y,w,h,5,4,structure^0x73fd56a8)*.39;
  const px=u*bundles+drift,py=v*courses;
  const row=Math.floor(py),phase=py-row;
  const shift=(row&1)*.47;
  const col=Math.floor(px+shift),within=px+shift-col;
  const id=hash(wrap(col,bundles),wrap(row,courses),structure^0xa37125ab);
  const split=Math.min(within,1-within);
  const edge=.025+(id-.5)*.025;
  const bundle=smooth((split-edge)/.13);
  const overlap=smooth((phase-.04)/.12)*(1-smooth((phase-.72)/.25));
  const fibers=retro?Math.sin(2*Math.PI*within*5):
    Math.sin(2*Math.PI*(within*9+drift*.9));
  const fibril=noise(x,y,w,h,retro?26:99,retro?17:37,
    structure^0xb91ca53d);
  const roughStraw=retro?Math.round(fibril*6)/6:fibril;
  const shaft=Math.pow(Math.max(0,fibers),retro?2:3)*bundle;
  const ridge=bundle*(.20+overlap*.14+shaft*.13)+roughStraw*.043;
  const strawTone=hash(wrap(col,bundles),wrap(row,courses),
    pigment^0x9b153c48)-.5;
  const wash=noise(x,y,w,h,7,9,pigment^0x83ce251f);
  const tone=strawTone*.16+wash*.11+shaft*.090-
    (1-bundle)*.072+(overlap-.5)*.025;
  const base=retro?[.64,.51,.275]:[.72,.56,.30];
  return {rgb:[base[0]+tone,base[1]+tone*.80,base[2]+tone*.56],
    z:.20+ridge,rough:clamp(.89+roughStraw*.056+(1-bundle)*.048)};
}
function wood(x,y,{w,h,structure,pigment,retro},profile){
  const u=x/w,v=y/h;
  const large=noise(x,y,w,h,5,profile==='beam'?14:5,
    structure^0x9a4d83b1);
  const warp=noise(x,y,w,h,8,profile==='beam'?9:6,
    structure^0xb836dce1);
  const growth=retro?18:36;
  let band,knot=0,ring=0;
  if(profile==='end'){
    // End grain needs radial annual rings, not longitudinal fibers.
    const nx=wrap(u-.44,1);const xx=Math.min(nx,1-nx);
    const ny=wrap(v-.48,1);const yy=Math.min(ny,1-ny);
    const radius=Math.hypot(xx,yy)*2;
    ring=Math.sin((radius+warp*.07)*Math.PI*growth);
    band=ring*.13+large*.042;
    knot=Math.exp(-radius*radius*45)*.14;
  }else{
    // Streaks run along the beam, with seeded knot interruptions.
    const bend=warp*.27+large*.09;
    ring=Math.sin((u+bend)*Math.PI*2*growth);
    const secondary=Math.sin((u+bend*.53)*Math.PI*2*(growth*.45));
    band=ring*.082+secondary*.034;
    const centers=retro?3:5;
    for(let k=0;k<centers;k++){
      const cx=hash(k,1,structure^0x32f581ac);
      const cy=hash(k,2,structure^0x6d25cb31);
      const dx=Math.min(Math.abs(u-cx),1-Math.abs(u-cx));
      const dy=Math.min(Math.abs(v-cy),1-Math.abs(v-cy));
      const a=dx/(retro?.085:.07),b=dy/(retro?.12:.085);
      const r=Math.hypot(a,b);
      const eye=Math.exp(-r*r*3);
      const halo=Math.exp(-Math.pow((r-1.08)/.35,2));
      knot+=eye*.22+halo*.076;
    }
  }
  const cut=retro?Math.round(band*24)/24:band;
  const pigmentWash=noise(x,y,w,h,9,7,pigment^0xd73431ef);
  const mineral=hash(3,9,pigment^0xa831db2a)-.5;
  const tone=cut+pigmentWash*.053+mineral*.052-knot;
  const base=retro?[.48,.305,.18]:[.50,.315,.172];
  const surface=.36+ring*.055+large*.047+warp*.029-knot*.56;
  return {rgb:[base[0]+tone,base[1]+tone*.80,base[2]+tone*.56],
    z:surface,rough:clamp(.85+large*.09+knot*.17)};
}
function plaster(x,y,{w,h,structure,pigment,weather,retro}){
  const base=noise(x,y,w,h,retro?6:13,retro?6:11,
    structure^0xe238b319);
  const coarse=noise(x,y,w,h,5,6,structure^0x94b71f52);
  const small=noise(x,y,w,h,retro?17:53,retro?17:47,
    structure^0x563e11a8);
  const wash=noise(x,y,w,h,8,8,pigment^0x94e13d2f);
  const wear=noise(x,y,w,h,11,13,weather^0x2f83cdea);
  // Painted plaster uses overlapping broad swept trowel swaths.
  // Retro plaster instead uses irregular chipped lime patches.
  const swath=retro?Math.round((base+coarse*.28)*5)/5:
    Math.round((base+small*.15)*7)/7;
  const lip=retro?Math.abs(swath)*.044:
    (base-swath)*.055;
  const stain=Math.max(0,wear+coarse*.6-.15);
  const tone=swath*(retro?.075:.095)+wash*.056-
    stain*.068+small*(retro?.017:.031);
  return {rgb:retro?
      [.84+tone,.75+tone*.89,.57+tone*.71]:
      [.91+tone,.85+tone*.91,.70+tone*.75],
    z:.46+swath*(retro?.10:.095)+lip+coarse*.033+
      small*.023,
    rough:clamp(.89+small*.065+stain*.072)};
}
function stone(x,y,{w,h,structure,pigment,weather,retro}){
  const rows=retro?8:6,cols=retro?8:6;
  const u=x/w,v=y/h;
  const ry=v*rows,row=Math.floor(ry),fy=ry-row;
  const stagger=(row&1)*(retro?.5:.38);
  const uneven=retro?0:
    noise(x,y,w,h,12,9,structure^0x9e4273b1)*.075;
  const sx=u*cols+stagger+uneven;
  const col=Math.floor(sx),fx=sx-col;
  const shape=hash(wrap(col,cols),wrap(row,rows),
    structure^0x31b75ea2);
  const warp=retro?0:
    noise(x,y,w,h,19,22,structure^0x4a21bf8e)*.052;
  const bevelDist=Math.min(fx,1-fx,fy,1-fy)+warp;
  const grout=retro?.035:.031;
  const face=smooth((bevelDist-grout)/(retro?.105:.105));
  const plateau=smooth((bevelDist-grout)/(retro?.19:.21));
  const grain=noise(x,y,w,h,retro?26:51,retro?27:49,
    structure^0x8d2e17f4);
  const mineral=noise(x,y,w,h,11,12,pigment^0xe7c4591a);
  const age=noise(x,y,w,h,13,14,weather^0x291fe71c);
  const colorVar=(hash(wrap(col,cols),wrap(row,rows),
    pigment^0xa96d325c)-.5)*(retro?.18:.14);
  const warmth=retro?[.56,.52,.44]:[.67,.63,.55];
  const mortar=retro?[.31,.30,.28]:[.48,.455,.415];
  const stoneTone=colorVar+mineral*.07+grain*(retro?.03:.055)-
    Math.max(0,age)*.06;
  const rgb=warmth.map((v,c)=>mix(mortar[c],
    v+stoneTone*[1,.86,.70][c],face));
  return {rgb,z:.16+plateau*(.30+shape*.06)+grain*.022*face,
    rough:clamp(mix(.95,.85+grain*.06+Math.max(0,age)*.08,face))};
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
      ctx.putImageData(image,0,0);
    },
  };
}
