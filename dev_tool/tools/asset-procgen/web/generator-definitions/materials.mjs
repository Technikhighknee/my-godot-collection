// Authoritative texture capabilities with their native art studies.
import {makeRoofAsset,CLAY_GENERATIVE_STYLES} from '../roof-textures.mjs';
import {makeStyledMaterialAsset,MATERIAL_STUDY_STYLES}
  from '../material-style-generation.mjs';
import {makeTimberAsset} from '../timber-textures.mjs';
import {makePlasterAsset} from '../plaster-textures.mjs';
import {makeStoneAsset} from '../stone-textures.mjs';

export const MATERIAL_GENERATORS=Object.freeze([
  Object.freeze({
    id:'roof-thatch',kind:'image',recipeVersion:1,headlessBake:true,symbol:'▤',
    label:'Thatch roofing',subtitle:'Layered straw/reed material',
    libraryPath:Object.freeze(['Textures','Roofs']),
    navLabel:'Thatch',navType:'Texture',
    generate:seeds=>makeRoofAsset('thatch',seeds),
    studyGeneration:Object.freeze({
      styles:MATERIAL_STUDY_STYLES,
      generate:(seeds,style)=>makeStyledMaterialAsset('roof-thatch',seeds,style),
    }),
    overline:'PROJECT TEXTURES / ROOF',
    title:'Thatched roofing.',
    description:'Seamless thatch surface with layered, fibrous courses. Albedo, normal and roughness maps are separately inspectable and lighting-independent.',
    previewLabel:'Procedural thatch roof texture',
    initialMasterSeed:18174,
    components:Object.freeze([
      Object.freeze({id:'pattern',label:'Straw structure',initialSeed:18174}),
      Object.freeze({id:'color',label:'Straw coloration',initialSeed:23512}),
    ]),
  }),
  Object.freeze({
    id:'roof-clay',kind:'image',recipeVersion:1,headlessBake:true,symbol:'▤',
    label:'Clay roof tiles',subtitle:'Staggered overlapping ceramic roof tiles',
    libraryPath:Object.freeze(['Textures','Roofs']),
    navLabel:'Clay tiles',navType:'Texture',
    generate:seeds=>makeRoofAsset('clay',seeds),
    studyGeneration:Object.freeze({
      styles:CLAY_GENERATIVE_STYLES,
      generate:(seeds,style)=>makeRoofAsset('clay',seeds,{style}),
    }),
    overline:'PROJECT TEXTURES / ROOF',
    title:'Clay roof tiles.',
    description:'Seamless interlocking terracotta tiles with clear rows, shaped overlaps and subtle color variation. Separate albedo, normal and roughness channels.',
    previewLabel:'Procedural terracotta roof tile texture',
    initialMasterSeed:90317,
    components:Object.freeze([
      Object.freeze({id:'pattern',label:'Tile pattern',initialSeed:90317}),
      Object.freeze({id:'color',label:'Clay coloration',initialSeed:43091}),
    ]),
  }),
  Object.freeze({
    id:'timber-oak',kind:'image',recipeVersion:1,headlessBake:true,symbol:'▤',
    label:'Hewn oak timber',subtitle:'Weathered structural wood with longitudinal grain',
    libraryPath:Object.freeze(['Textures','Wood']),
    navLabel:'Hewn oak',navType:'Texture',
    generate:seeds=>makeTimberAsset(seeds),
    studyGeneration:Object.freeze({
      styles:MATERIAL_STUDY_STYLES,
      generate:(seeds,style)=>makeStyledMaterialAsset('timber-oak',seeds,style),
    }),
    overline:'PROJECT TEXTURES / TIMBER',
    title:'Hewn oak timber.',
    description:'One reusable hewn oak asset with three surface profiles: beam grain, crosscut end grain and broad flat-sawn wood. Each includes albedo, normal and roughness maps; buildings vary UV sampling per beam.',
    previewLabel:'Procedural weathered timber grain texture',
    initialMasterSeed:37821,
    components:Object.freeze([
      Object.freeze({id:'grain',label:'Wood grain and knots',initialSeed:37821}),
      Object.freeze({id:'color',label:'Wood coloration',initialSeed:19257}),
    ]),
  }),
  Object.freeze({
    id:'plaster-lime',kind:'image',recipeVersion:1,headlessBake:true,symbol:'▦',
    label:'Lime plaster',subtitle:'Warm hand-applied mineral facade render',
    libraryPath:Object.freeze(['Textures','Walls']),
    navLabel:'Lime plaster',navType:'Texture',
    generate:seeds=>makePlasterAsset(seeds),
    studyGeneration:Object.freeze({
      styles:MATERIAL_STUDY_STYLES,
      generate:(seeds,style)=>makeStyledMaterialAsset('plaster-lime',seeds,style),
    }),
    overline:'PROJECT TEXTURES / PLASTER',
    title:'Lime plaster.',
    description:'Warm game-stylized lime render with subtle trowel undulations, grain and weathering. Tileable albedo, normal and roughness channels; reuse one material across timber-frame facade panels.',
    previewLabel:'Warm hand-applied lime plaster',
    initialMasterSeed:47519,
    components:Object.freeze([
      Object.freeze({id:'structure',label:'Plaster application',initialSeed:47519}),
      Object.freeze({id:'pigment',label:'Mineral coloration',initialSeed:20468}),
      Object.freeze({id:'wear',label:'Surface wear',initialSeed:90571}),
    ]),
  }),
  Object.freeze({
    id:'stone-rubble',kind:'image',recipeVersion:1,headlessBake:true,symbol:'▦',
    label:'Rubble stone',subtitle:'Irregular limestone and mortar masonry',
    libraryPath:Object.freeze(['Textures','Stone']),
    navLabel:'Rubble stone',navType:'Texture',
    generate:seeds=>makeStoneAsset(seeds),
    studyGeneration:Object.freeze({
      styles:MATERIAL_STUDY_STYLES,
      generate:(seeds,style)=>makeStyledMaterialAsset('stone-rubble',seeds,style),
    }),
    overline:'PROJECT TEXTURES / STONE',
    title:'Rubble stone masonry.',
    description:'Irregular interlocking fieldstones with recessed mortar, bevelled faces and granular mineral surfaces. Three seamless PBR maps and independent layout, mineral and weather seeds.',
    previewLabel:'Irregular medieval rubble stone with mortar joints',
    initialMasterSeed:71803,
    components:Object.freeze([
      Object.freeze({id:'layout',label:'Stone shape and arrangement',initialSeed:71803}),
      Object.freeze({id:'mineral',label:'Stone color and geology',initialSeed:30192}),
      Object.freeze({id:'weather',label:'Weathering and erosion',initialSeed:58212}),
    ]),
  }),
]);
