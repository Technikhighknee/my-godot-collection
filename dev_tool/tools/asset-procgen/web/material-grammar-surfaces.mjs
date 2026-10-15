// Material-specific shape grammars. No UI, project store or export logic.
import {clamp, mix, smooth, wrap, hash, noise}
  from './material-grammar-math.mjs';
import {materialElementTraits, materialElementWear}
  from './material-language.mjs';

export function prepareMaterialContext(material,{structure,pigment,weather,retro,resolution}){
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
        materialDetail:materialElementTraits(i,row,count,rows,
          {form:structure,pigment,aging:weather}),
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
// Surface grammar for hand-laid stone. The masonry generator supplies *real*
// joint distance, stone relief and seeded mineral character. A style can
// change mortar width, tint, pigment deposition and depth independently
// without modifying the stone layout or simply filtering the old albedo.

export function thatch(x,y,{w,h,structure,pigment,retro}){
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

export function wood(x,y,{w,h,structure,pigment,retro},profile){
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

export function plaster(x,y,{w,h,structure,pigment,weather,retro,strokes}){
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

export function stone(x,y,{w,h,structure,pigment,weather,retro,masonry}){
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
  const aging=materialElementWear(rock.materialDetail,fx,fy);
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
      Math.max(0,lichen)*.055+scratch*.09,face)),
    // Semantic material fields used by alternate art directions. Keep
    // underlying hand-painted / retro generators completely unchanged.
    jointDistance:edge,stoneRelief:stoneHeight,stoneTint:tone,
    aging};
}


export const MATERIAL_SURFACE_PRODUCERS = Object.freeze({
  'roof-thatch': thatch,
  'timber-oak': wood,
  'plaster-lime': plaster,
  'stone-rubble': stone,
});
