// Native alternative procedural grammars for the Texture Style Study.
// Every material is re-authored from its semantic seeds: no recoloring or
// processing of pixels from the original generator. Experimental, non-persisted
// study only. Each grammar yields matching albedo/height/roughness maps.
export const MATERIAL_STUDY_STYLES=Object.freeze([
  'hand-painted-study','retro-3d-study',
  'naturalistic-study','watercolor-study',
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
function prepareMaterialContext(material,{structure,pigment,retro,resolution}){
  if(material==='plaster-lime'){
    const count=retro?17:25,strokes=[];
    for(let k=0;k<count;k++){
      const angle=(hash(k,2,structure^0x9471a3bc)-.5)*1.25;
      strokes.push({
        cx:hash(k,0,structure^0x519ca2e4),
        cy:hash(k,1,structure^0x38d7ab52),
        ca:Math.cos(angle),sa:Math.sin(angle),
        length:.095+hash(k,3,structure^0x18af739c)*.19,
        width:.022+hash(k,4,structure^0x7a5913fe)*.047,
        weight:hash(k,7,structure^0x6f37b4c9)-.5,
      });
    }
    return {strokes};
  }
  if(material==='stone-rubble'){
    // Periodic, approximately level masonry courses. A course is a band of
    // individually sized stones -- not Voronoi cobbles or rectangular bricks.
    const w=resolution??(retro?128:512),h=w;
    const rows=retro?7:6;
    const weights=Array.from({length:rows},(_,r)=>
      .67+hash(r,0,structure^0x321b91ae)*.86);
    const total=weights.reduce((a,b)=>a+b,0);
    const elevations=[0];
    for(const weight of weights)
      elevations.push(elevations[elevations.length-1]+
        weight/total*h);
    elevations[rows]=h;
    const edges=Array.from({length:w},(_,x)=>{
      const line=[];
      for(let k=0;k<=rows;k++){
        const index=k%rows;
        const phase=hash(index,7,structure^0x19b7a5e3)*Math.PI*2;
        const phase2=hash(index,3,structure^0x82c7fa19)*Math.PI*2;
        const coarse=Math.sin(x/w*Math.PI*4+phase)*(retro?2.3:6.4);
        const fine=Math.sin(x/w*Math.PI*10+phase2)*(retro?1.15:2.95);
        line.push(elevations[k]+coarse+fine);
      }
      return line;
    });
    // Put the vertical tiling cut within a wide course instead of
    // directly on the boundary between the first and last courses.
    const widestRow=weights.indexOf(Math.max(...weights));
    const originY=(elevations[widestRow]+elevations[widestRow+1])*.5;
    const courses=[];
    for(let row=0;row<rows;row++){
      // Include small chinking stones and occasional long slabs; the walls
      // should not settle into a repetitive uniform rectangular bond.
      const count=4+Math.floor(
        hash(row,1,structure^0x391e4bc2)*(retro?3:4));
      const small=Math.floor(hash(row,2,structure^0x8fca923d)*count);
      let large=Math.floor(hash(row,3,structure^0xa127f48b)*count);
      if(large===small)large=(large+2)%count;
      const widths=Array.from({length:count},(_,i)=>{
        const base=(retro?.74:.36)+hash(row,i,structure^0x38cbd672)*
          (retro?.92:1.67);
        return base*(i===small?(retro?.68:.37):
          i===large?(retro?1.65:2.1):1);
      });
      const sum=widths.reduce((a,b)=>a+b,0);
      const cuts=[0];
      for(const width of widths)
        cuts.push(cuts[cuts.length-1]+width/sum*w);
      cuts[count]=w;
      const joints=Array.from({length:count},(_,i)=>{
        const before=i===0?cuts[count]-cuts[count-1]:
          cuts[i]-cuts[i-1];
        const after=cuts[i+1]-cuts[i];
        return {
          a:(hash(row,i,structure^0x317e29af)-.5)*2,
          b:(hash(row,i,structure^0x981ac3f2)-.5)*2,
          phase:hash(row,i,structure^0x7a1cbf36)*Math.PI*2,
          // Narrow chinking stones must never flip their side joints.
          limit:Math.min(retro?2.5:6.0,Math.min(before,after)*.20),
        };
      });
      const stones=Array.from({length:count},(_,i)=>({
        relief:.83+hash(row,i,structure^0x92d341ab)*.35,
        chip:hash(row,i,structure^0xb417c82a),
        tone:hash(row,i,pigment^0xa96d325c)-.5,
        // Structure seed only: paint/respray does not move corners.
        corner:hash(row,i,structure^0xcb58d127),
      }));
      // Place the horizontal tiling cut within a stone, rather than
      // on an arbitrary vertical joint. Vary the cut within that stone
      // independently per course so it doesn't create a repeated pillar.
      const largest=widths.indexOf(Math.max(...widths));
      const span=cuts[largest+1]-cuts[largest];
      const center=(cuts[largest]+cuts[largest+1])*.5;
      const drift=(hash(row,9,structure^0x56b1ca37)-.5)*span*.36;
      courses.push({count,cuts,joints,stones,
        offset:wrap(w-center-drift,w)});
    }
    return {masonry:{rows,edges,courses,originY}};
  }
  return {};
}
// Styles change not only pigments but the procedural structure seed and the
// physical surface relief. They never process the existing Current bitmap.
function artDirectionSurface(material,style,x,y,{w,h,structure,pigment,weather},shape){
  if(style!=='naturalistic-study'&&style!=='watercolor-study')
    return shape;
  const natural=style==='naturalistic-study';
  const macro=noise(x,y,w,h,7,9,pigment^0x2938a15f);
  const stains=noise(x,y,w,h,15,18,weather^0x7a2e8f31);
  const pigmentMid=noise(x,y,w,h,28,25,pigment^0x4bc2719e);
  const grain=noise(x,y,w,h,113,107,structure^0x391ea671);
  const fibers=noise(x,y,w,h,91,material==='timber-oak'?8:49,
    structure^0x6b29d435);
  const stroke=noise(x+y*.17,y,w,h,24,11,structure^0x824ae13c);
  // A flooded paint edge follows a broad *pigment* wash, not a second
  // unrelated stone/roof pattern painted across the source structure.
  const tide=Math.abs(pigmentMid*.78+macro*.55);
  const pool=Math.exp(-Math.pow((tide-.235)/.063,2));
  const dry=Math.max(0,grain+.14);
  let palette,luminosity,edge,physical,roughness;
  switch(material){
    case 'roof-thatch':
      palette=natural?[.53,.443,.278]:[.80,.68,.418];
      edge=Math.max(0,.42-shape.z)*.38;
      luminosity=(natural?fibers*.21+grain*.066:
        fibers*.14+stroke*.085-grain*.06);
      physical=fibers*(natural?.066:.033)+grain*.022;
      roughness=.90;break;
    case 'timber-oak':
      palette=natural?[.385,.274,.185]:[.65,.468,.307];
      edge=Math.max(0,.37-shape.z)*.64;
      luminosity=(natural?fibers*.19+grain*.08:
        fibers*.135+stroke*.09);
      physical=fibers*(natural?.065:.037)+grain*.02;
      roughness=.85;break;
    case 'plaster-lime':
      palette=natural?[.78,.75,.69]:[.915,.859,.737];
      edge=Math.max(0,.43-shape.z)*.33;
      luminosity=(natural?grain*.094+stroke*.052:
        stroke*.15+grain*.045);
      physical=grain*(natural?.041:.026)+stroke*.032;
      roughness=.91;break;
    case 'stone-rubble':
      palette=natural?[.615,.598,.554]:[.79,.746,.646];
      // Genuine rubble face geometry remains clearly distinguishable.
      edge=Math.max(0,.36-shape.z)*(natural?.54:.91);
      luminosity=(natural?grain*.087+fibers*.038:
        grain*.049+stroke*.089);
      physical=grain*(natural?.052:.030)+stroke*.022;
      roughness=.89;break;
    default:return shape;
  }
  const paintedTint=natural?
    macro*.116+pigmentMid*.088+stains*.075+luminosity-edge:
    macro*.145+pigmentMid*.13+luminosity-pool*.092-
      dry*.037-edge*.91;
  const weathering=natural?Math.max(0,stains+.15)*.17:0;
  // Preserve silhouette contrast by retaining a material-specific share
  // of its native, geometry-aware albedo. Neither art direction blurs it.
  const nativeWeight=natural?.56:.40;
  const rgb=palette.map((v,c)=>
    mix(v,shape.rgb[c],nativeWeight)+
      paintedTint*[1,.91,.75][c]-
      weathering*[1,.84,.70][c]);
  return {rgb,z:clamp(shape.z+physical+
    (natural?grain*.025:stroke*.023),.02,.97),
    rough:clamp(mix(shape.rough,roughness,natural?.33:.46)+
      (natural?grain*.065+stains*.035:dry*.049+pool*.035))};
}
function raster(material,style,seeds,profile){
  const retro=style==='retro-3d-study';
  const alternate=style==='naturalistic-study'||style==='watercolor-study';
  // Bake the new art directions at 256 px and reconstruct with periodic
  // bilinear sampling. Studio displays them at 256 px; this keeps a full
  // 512 px export without running every costly pigment field four times.
  const scale=retro?4:alternate?2:1;
  const height=material==='timber-oak'&&profile==='beam'?2048:W;
  const width=W;
  const w=width/scale,h=height/scale,m=allocate(w,h);
  const structure=(seeds.pattern??seeds.grain??seeds.structure??
    seeds.layout)>>>0;
  const pigment=(seeds.color??seeds.pigment??seeds.mineral)>>>0;
  const weather=(seeds.wear??seeds.weather??pigment)>>>0;
  // Geometry has its own art-direction grammar/seed stream. A color reseed
  // never changes the outlines or the normal/height fields.
  const form=alternate?structure^(style==='naturalistic-study'?
    0x529ae317:0x81f2a64d):structure;
  const dimensions={w,h,structure:form,pigment,weather,retro,
    ...prepareMaterialContext(material,{structure:form,pigment,retro,
      resolution:w})};
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
    const physical=artDirectionSurface(material,style,x,y,
      {w,h,structure:form,pigment,weather},result);
    colorize(m,p,physical.rgb,physical.z,physical.rough);
  }
  // Rubble already wraps geometrically along both axes. Averaging mirrored
  // border pixels flattened the stone relief into conspicuous pale bands
  // whenever the texture was repeated. Other materials still need welding.
  if(material!=='stone-rubble')weldSeams(m);
  if(scale===1)return m;
  // Only Retro uses pixel-perfect nearest-neighbor enlargement. Naturalistic
  // and Watercolor get periodic bilinear reconstruction, preserving smooth
  // pigments and tangent-space relief rather than obvious 2x2 pixel blocks.
  const full=allocate(width,height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const dst=y*width+x;
    if(retro){
      const src=Math.floor(y/scale)*w+Math.floor(x/scale);
      full.albedo.set(m.albedo.subarray(src*3,src*3+3),dst*3);
      full.heightMap[dst]=m.heightMap[src];
      full.roughness[dst]=m.roughness[src];
      continue;
    }
    const sx=x/scale,sy=y/scale;
    const px=Math.floor(sx),py=Math.floor(sy);
    const tx=smooth(sx-px),ty=smooth(sy-py);
    const a=py*w+px,b=py*w+wrap(px+1,w);
    const c=wrap(py+1,h)*w+px,d=wrap(py+1,h)*w+wrap(px+1,w);
    const blend=(arr,channels,channel=0)=>mix(
      mix(arr[a*channels+channel],arr[b*channels+channel],tx),
      mix(arr[c*channels+channel],arr[d*channels+channel],tx),ty);
    for(let ch=0;ch<3;ch++)
      full.albedo[dst*3+ch]=blend(m.albedo,3,ch);
    full.heightMap[dst]=blend(m.heightMap,1);
    full.roughness[dst]=blend(m.roughness,1);
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
    strokeTone+=cover*(weight*.057);
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
  // Scuffed, partially reworked lime coats: feathered mineral patches
  // live in the shape field, whereas their tint still belongs to pigment.
  const porous=noise(x,y,w,h,retro?16:33,retro?14:31,
    structure^0x3ae8b192);
  const skim=noise(x,y,w,h,retro?7:12,retro?9:14,
    structure^0x98c1a263);
  const worn=smooth((porous+skim*.39-.13)/.22);
  const chips=Math.max(0,porous-.29)*(retro?.12:.085);
  const chipped=retro?Math.max(0,-patch-.19)*.065:0;
  const tone=wash*.047+patch*.030+strokeTone+
    swish*(retro?.034:.043)-grime*.072+
    plasterGrain*.033+skim*.042-worn*.072-pit-chipped;
  const base=retro?[.84,.765,.641]:[.9,.842,.722];
  return {rgb:[base[0]+tone,base[1]+tone*.91,
      base[2]+tone*.75],
    z:.435+raised+edgeLip+fine*.018+plasterGrain*.036+
      swish*.023-worn*.029-chips-pit*.36-chipped*.42,
    rough:clamp(.88+fine*.04+grime*.095+pit*.12+worn*.046)};
}

function stone(x,y,{w,h,structure,pigment,weather,retro,masonry}){
  // Hand-laid masonry: horizontal, irregular courses and stones of wildly
  // different widths. Each joint is shared by its neighbors. The periodic
  // first/last course and first/last vertical joint keep the texture tileable.
  const {rows,edges,courses,originY}=masonry;
  const boundary=edges[x],seam=boundary[0];
  // A fixed, seeded origin inside an actual stone course keeps both edges
  // periodic without creating an artificial continuous mortar line.
  const yy=wrap(y+originY-seam,h)+seam;
  let row=0;
  while(row<rows-1&&yy>=boundary[row+1])row++;
  const top=boundary[row],bottom=boundary[row+1],height=bottom-top;
  const t=clamp((yy-top)/height);
  const course=courses[row];
  const jointShift=(i)=>{
    const j=course.joints[i%course.count];
    return j.limit*(mix(j.a,j.b,t)+
      .19*Math.sin(t*Math.PI*2+j.phase));
  };
  const shift0=jointShift(0);
  const xx=wrap(x-course.offset-shift0,w)+shift0;
  let index=0;
  while(index<course.count-1&&
    xx>=course.cuts[index+1]+jointShift(index+1))index++;
  const left=course.cuts[index]+jointShift(index);
  const right=course.cuts[index+1]+jointShift(index+1);
  const rock=course.stones[index];
  const span=Math.max(1,right-left);
  const fx=clamp((xx-left)/span);
  const fy=t;
  // Chamfer some corners on diagonals instead of yielding round Voronoi
  // polygons. The cut amount belongs to the stone shape seed.
  const corner=(retro?.13:.17)+rock.corner*(retro?.14:.17);
  const diagonal=Math.min(
    fx+fy,fx+1-fy,1-fx+fy,2-fx-fy);
  const cornerInset=Math.max(0,corner-diagonal)*Math.min(span,height)*.57;
  const ragged=noise(x,y,w,h,retro?29:51,retro?27:49,
    structure^0x6db82ca1)*(retro?.55:3.5);
  const edge=Math.min(xx-left,right-xx,yy-top,bottom-yy)-
    cornerInset+ragged;
  // Retro is authored at 128 px: each side of a joint needs only ~1 texel,
  // not the old 3-4 texels that joined into an unreadable dark network.
  const border=retro?.10:1.6;
  const face=smooth((edge-border)/(retro?1.15:3.4));
  const bevel=smooth((edge-(retro?.06:.5))/(retro?2.25:9.3));
  const micro=noise(x,y,w,h,retro?23:79,retro?29:73,
    structure^0x718c42d3);
  const grit=noise(x,y,w,h,retro?32:113,retro?26:109,
    structure^0x31a5e70c);
  const medium=noise(x,y,w,h,retro?11:28,retro?12:30,
    structure^0x9f18ac72);
  const lichen=noise(x,y,w,h,11,12,weather^0x291fe71c);
  const mineral=noise(x,y,w,h,12,10,pigment^0x823f9a26);
  const wash=noise(x,y,w,h,20,19,pigment^0xe7c4591a);
  const scratch=Math.max(0,-grit-.26)*face;
  // Different shape grammars share a coherent limestone family. Shallow
  // value variation does the work, not dark cartoon grout outlines.
  const base=retro?[.663,.629,.554]:[.679,.642,.558];
  const mortar=retro?[.518,.497,.451]:[.497,.472,.431];
  const tone=rock.tone*(retro?.12:.15)+mineral*.075+
    wash*.035+medium*.054+micro*.040-
    Math.max(0,lichen)*.090-scratch*.080;
  // Fine stone lip on the top, but avoid baked directional light gradients.
  const paleLip=face*(1-bevel)*(retro?.026:.038);
  const rgb=base.map((v,c)=>mix(mortar[c]+grit*.014,
    v+tone*[1,.88,.68][c]+paleLip,face));
  const stoneHeight=(.265+rock.relief*.090)+
    medium*.044+micro*.032+grit*.015-scratch*.072;
  return {rgb,z:.15+bevel*stoneHeight,
    rough:clamp(mix(.945,.86+micro*.05+
      Math.max(0,lichen)*.055+scratch*.09,face))};
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
      if(view==='normal'&&material!=='stone-rubble')weldNormalEdges(d,w,h,step);
      ctx.putImageData(image,0,0);
    },
  };
}
