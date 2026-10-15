// Interpret a generated surface for each visual language and material.
// Structure, pigment and weathering remain independently seeded.
import {clamp, mix, smooth, noise}
  from './material-grammar-math.mjs';

function directedStoneSurface(style,x,y,{w,h,structure,pigment,weather},shape){
  const natural=style==='naturalistic';
  const edge=shape.jointDistance;
  const face=smooth((edge+(natural?.35:.45))/(natural?2.0:2.8));
  const chamfer=smooth((edge-.10)/(natural?4.2:4.8));
  const grain=noise(x,y,w,h,67,63,structure^0x4d129ac7);
  const mineral=noise(x,y,w,h,20,18,pigment^0x6a81fc43);
  const wash=noise(x,y,w,h,7,9,pigment^0xb72dc941);
  const wear=noise(x,y,w,h,11,13,weather^0x529b2f84);
  const stoneTone=shape.stoneTint*.68;
  const {moisture,erosion,crack}=shape.aging;
  if(natural){
    // Quiet, believable limestone grout: a narrow mortar cut and subtle
    // recess, not a black outline running through every joint.
    const stone=[.663,.645,.596],mortar=[.562,.545,.513];
    const age=Math.max(0,wear+.17);
    const tint=stoneTone+mineral*.046+wash*.032+
      grain*.045-age*.055-moisture*.047-erosion*.022-crack*.037;
    const rgb=stone.map((v,c)=>mix(mortar[c]+wear*.018,
      v+tint*[1,.89,.73][c]+(1-chamfer)*face*.017,face));
    return {
      rgb,
      z:clamp(.17+chamfer*shape.stoneRelief+grain*.014*face-
        erosion*.031-crack*.050),
      rough:clamp(mix(.94,.855+grain*.056+age*.06,face)+
        moisture*.055),
    };
  }
  // Watercolor keeps the masonry readable but allows the pigment to break
  // up along its joints. Broad washes, transparent gaps and dry-grain edges
  // follow the stones, not uniformly dark drawn contour lines.
  const glaze=noise(x,y,w,h,12,10,pigment^0xc8e4913a);
  const dust=noise(x,y,w,h,55,49,structure^0x28a41c75);
  const bloom=noise(x,y,w,h,6,8,pigment^0x71bc4209);
  const tide=noise(x,y,w,h,17,15,pigment^0x39a1f282);
  const dry=clamp((dust+glaze*.44+.31)/.66);
  // Keep pigment washes continuous. Sampling an iso-value of a noise field
  // produces closed contour loops, not watercolor drying marks. Deposits
  // instead accumulate in the actual masonry joints and chipped edges.
  const fade=smooth((wash+mineral*.45+wear*.22+.26)/.52);
  const groutOpacity=(1-face)*(.53+.18*fade);
  const stone=[.765,.696,.592],mortar=[.66,.63,.575];
  const paper=[.965,.943,.885];
  const firstWash=smooth((wash+.31)/.62);
  const secondWash=smooth((glaze+.30)/.60);
  const density=clamp(.48+firstWash*.25+secondWash*.22+
    bloom*.12-dry*.07);
  const granules=Math.max(0,dust+.06)*(.3+.7*fade);
  const jointDeposit=(1-face)*(.020+.016*fade);
  const tint=stoneTone*.70+wash*.13+mineral*.09+
    glaze*.075+bloom*.055-granules*.078-
    moisture*.027-erosion*.016-crack*.019;
  const rgb=stone.map((v,c)=>{
    const paint=clamp(v+tint*[1,.88,.70][c],.04,.95);
    const glazed=mix(paper[c],paint,density);
    return mix(glazed,mortar[c]+wash*.05-jointDeposit,
      groutOpacity)+dust*.018;
  });
  return {
    rgb,
    z:clamp(.19+chamfer*shape.stoneRelief*.66+
      grain*.013*face-erosion*.014-crack*.019),
    rough:clamp(mix(.95,.915+dust*.063+dry*.05,face)),
  };
}
// Art direction is a material-aware translation, never an image blur.
// Geometry and physical relief come only from the structure seed. Pigment
// fields affect albedo, not the normals, even after a color reseed.
export function artDirectionSurface(material,style,x,y,{w,h,structure,pigment,weather},shape){
  if(style!=='naturalistic'&&style!=='watercolor')
    return shape;
  if(material==='stone-rubble')return directedStoneSurface(
    style,x,y,{w,h,structure,pigment,weather},shape);
  const natural=style==='naturalistic';
  const macro=noise(x,y,w,h,5,7,pigment^0x2938a15f);
  const stains=noise(x,y,w,h,13,15,weather^0x7a2e8f31);
  const fine=noise(x,y,w,h,109,107,structure^0x391ea671);
  const speck=noise(x,y,w,h,87,83,pigment^0x63ba9204);
  const wet=noise(x,y,w,h,11,13,pigment^0x4bc2719e);
  // Aquarelle are built from translucent pigment over warm paper. Bleeds,
  // granulation and darkened drying fronts need a different signal language
  // from photographic fine-grain or generic soft color noise.
  const bloom=noise(x,y,w,h,6,7,pigment^0x7482aa13);
  const tide=noise(x,y,w,h,16,17,pigment^0x118fe437);
  const paper=noise(x,y,w,h,91,89,structure^0x78223fa1);
  // Diffuse, layered translucent washes. A hard threshold of any pigment
  // noise is forbidden here: it draws nested topographic contour rings.
  const dry=clamp((paper+wet*.4+.30)/.65);
  const bleed=clamp((bloom+wet*.52+.35)/.72);
  const pigmentGranules=Math.max(0,speck+.08)*(.25+.75*bleed);
  const fiber=noise(x+noise(x,y,w,h,7,5,structure^0x716e3a29)*w*.018,
    y,w,h,103,material==='timber-oak'?7:21,structure^0x6b29d435);
  const lines=noise(x,y,w,h,162,material==='timber-oak'?11:31,
    structure^0x17b21a4f);
  let palette,physical=0,detail=0,weathered=0,opacity=.62;
  switch(material){
    case 'roof-thatch':{
      palette=natural?[.59,.49,.32]:[.81,.69,.47];
      // Thatch is a comb of overlapping longitudinal stalks, not fuzzy hay.
      const stalk=Math.max(0,fiber+.12)*.31+lines*.18;
      const courses=noise(x,y,w,h,9,23,structure^0x3b98c11d);
      detail=natural?stalk+courses*.070:
        noise(x,y,w,h,51,14,structure^0x516ba04e)*.24+
        noise(x,y,w,h,19,17,structure^0xc72835e1)*.09+
        courses*.10;
      physical=stalk*.055;
      weathered=Math.max(0,stains+.17)*.13;
      opacity=natural?.47:.62;
      break;
    }
    case 'timber-oak':{
      palette=natural?[.47,.34,.245]:[.70,.53,.38];
      // Strongly anisotropic early/late wood rather than mottled pixels.
      const widerGrain=noise(x,y,w,h,36,5,
        structure^0x9a11e3c8);
      detail=natural?fiber*.30+lines*.13+widerGrain*.11:
        widerGrain*.34+noise(x,y,w,h,18,4,
          structure^0x28be719c)*.13+fiber*.045;
      physical=fiber*.045+lines*.014;
      weathered=Math.max(0,stains+.13)*.13;
      opacity=natural?.42:.58;
      break;
    }
    case 'plaster-lime':{
      palette=natural?[.82,.79,.73]:[.94,.89,.79];
      const trowel=noise(x+y*.19,y,w,h,21,13,structure^0x824ae13c);
      const porous=noise(x,y,w,h,63,59,structure^0xa58d231c);
      detail=natural?trowel*.10+porous*.075+fine*.057:
        trowel*.20+noise(x,y,w,h,14,12,
          structure^0x91a826f3)*.11+porous*.020;
      physical=porous*.019+trowel*.013;
      weathered=Math.max(0,stains+.16)*.10;
      opacity=natural?.43:.57;
      break;
    }
    default:return shape;
  }
  if(natural){
    const tint=detail+macro*.060+wet*.042+speck*.023-weathered;
    return {
      rgb:palette.map((v,c)=>clamp(mix(v,shape.rgb[c],1-opacity)+
        tint*[1,.87,.70][c])),
      z:clamp(shape.z+physical+fine*.012,.02,.97),
      rough:clamp(shape.rough*.76+.22+fine*.035+weathered*.20),
    };
  }
  // Pigment belongs to the represented material: reeds remain fibrous,
  // oak stays longitudinal and plaster keeps its trowel patches. Intermittent
  // paper exposure and granular deposits create watercolor character
  // without inventing ring-shaped objects on the surface.
  const paperBase=[.965,.944,.887];
  // Two uneven transparent paint passes. Their soft wash boundaries
  // overlap, rather than tracing the same density threshold as a line.
  const firstWash=smooth((bloom+.31)/.62);
  const secondWash=smooth((wet+.29)/.58);
  const washDensity=clamp(.46+firstWash*.27+secondWash*.24+
    tide*.10-dry*.09-Math.max(0,paper+.09)*.11);
  const groove=material==='timber-oak'?Math.max(0,-detail)*.16:
    material==='roof-thatch'?Math.max(0,-detail)*.10:0;
  const localPigment=detail*.87+macro*.11+wet*.085+
    pigmentGranules*.068-groove;
  return {
    rgb:palette.map((v,c)=>{
      const underpaint=mix(v,shape.rgb[c],.19);
      const stain=clamp(underpaint+localPigment*[1,.82,.68][c],
        .05,.96);
      return clamp(mix(paperBase[c],stain,washDensity)+
        paper*.020);
    }),
    z:clamp(shape.z+physical*.34+paper*.006,.02,.97),
    rough:clamp(.945+paper*.032+dry*.016),
  };
}
