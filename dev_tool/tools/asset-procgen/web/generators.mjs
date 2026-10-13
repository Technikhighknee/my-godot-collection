// Catalog of independent asset generators. This knows no DOM, WebGL,
// canvas or editor state. Future 2D generators can use the same catalog.
import {DEFAULT_TREE,generateTree} from './tree.mjs';
import {generateFir} from './fir.mjs';
import {generateOakFoliage} from './oak-foliage.mjs';
import {validateSeed} from './seed-model.mjs';
import {paintOakAtlas,OAK_ATLAS_SIZE} from './oak-atlas.mjs';
import {generateOakSprig,paintOakSprig,OAK_SPRIG_SIZE} from './oak-sprig.mjs';
import {OAK_BARK_SIZE,OAK_BARK_MAPS,OAK_BARK_PROFILES,
  generateOakBarkMaterial,paintGeneratedOakBarkMap} from './oak-bark.mjs';
import {mapOakBarkWood} from './oak-bark-uv.mjs';
import {DEFAULT_BUILDING_OPTIONS,validateBuildingOptions,generateBuildingFamily}
  from './building.mjs';
import {makeRoofAsset} from './roof-textures.mjs';
import {makeTimberAsset} from './timber-textures.mjs';

// Each registration owns its implementation; the UI never switches on
// generator IDs to decide how an asset is produced.
function generateOakAsset(seeds){
  const wood=generateTree({seed:seeds.geometry});
  return {id:'oak',kind:'model',wood,
    // Never change the established growth mesh to accommodate UV seams.
    barkWood:mapOakBarkWood(wood),
    barkSeeds:{structureSeed:seeds.barkStructure,
      surfaceSeed:seeds.barkSurface,colorSeed:seeds.barkColor},
    foliage:generateOakFoliage(wood,{seed:seeds.foliage}),
    atlasSeed:seeds.leaves};
}
function generateFirAsset(seeds){
  return {id:'fir',kind:'model',
    wood:generateFir({seed:seeds.geometry}),
    foliage:null,atlasSeed:null};
}
function generateOakAtlasAsset(seeds){
  return {
    id:'oak-atlas',kind:'image',width:OAK_ATLAS_SIZE,height:OAK_ATLAS_SIZE,
    channels:'RGBA',tiles:16,atlas:{columns:4,rows:4},
    paint:canvas=>paintOakAtlas(canvas,seeds.leaves),
  };
}
function generateOakSprigAsset(seeds){
  const sprig=generateOakSprig({
    structureSeed:seeds.structure,
    leafSeed:seeds.leaves,
  });
  return {id:'oak-sprig',kind:'image',width:OAK_SPRIG_SIZE,
    height:OAK_SPRIG_SIZE,channels:'RGBA',
    paint:canvas=>paintOakSprig(canvas,sprig)};
}
function generateOakBarkAsset(seeds){
  // Lazily materialize only the requested profile, then reuse its
  // maps when switching inspector channels. Seed edits create a new asset.
  const materials=new Map();
  return {
    id:'oak-bark',kind:'image',width:OAK_BARK_SIZE,height:OAK_BARK_SIZE,
    channels:'RGBA',views:OAK_BARK_MAPS,profiles:OAK_BARK_PROFILES,
    paint:(canvas,view='albedo',profile='trunk')=>{
      if(!OAK_BARK_MAPS.includes(view))throw Error('Unknown bark material map');
      if(!OAK_BARK_PROFILES.includes(profile))throw Error('Unknown bark profile');
      let material=materials.get(profile);
      if(!material){
        material=generateOakBarkMaterial({
          structureSeed:seeds.structure,
          surfaceSeed:seeds.surface,
          colorSeed:seeds.color,profile,
        });
        materials.set(profile,material);
      }
      return paintGeneratedOakBarkMap(canvas,material,view);
    },
  };
}
export const GENERATORS=Object.freeze([
  Object.freeze({
    id:'roof-thatch',kind:'image',symbol:'▤',
    label:'Thatch roofing',subtitle:'Layered straw/reed material',
    libraryPath:Object.freeze(['Textures','Roofs']),
    navLabel:'Thatch',navType:'Texture',
    generate:seeds=>makeRoofAsset('thatch',seeds),
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
    id:'roof-clay',kind:'image',symbol:'▤',
    label:'Clay roof tiles',subtitle:'Staggered overlapping ceramic roof tiles',
    libraryPath:Object.freeze(['Textures','Roofs']),
    navLabel:'Clay tiles',navType:'Texture',
    generate:seeds=>makeRoofAsset('clay',seeds),
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
    id:'timber-oak',kind:'image',symbol:'▤',
    label:'Hewn oak timber',subtitle:'Weathered structural wood with longitudinal grain',
    libraryPath:Object.freeze(['Textures','Wood']),
    navLabel:'Hewn oak',navType:'Texture',
    generate:seeds=>makeTimberAsset(seeds),
    overline:'PROJECT TEXTURES / TIMBER',
    title:'Hewn oak timber.',
    description:'Tileable timber surface for solid framing beams, with lengthwise grain, sparse knots, subtle cracks and natural firing-brown variation. Separate albedo, normal and roughness maps.',
    previewLabel:'Procedural weathered timber grain texture',
    initialMasterSeed:37821,
    components:Object.freeze([
      Object.freeze({id:'grain',label:'Wood grain and knots',initialSeed:37821}),
      Object.freeze({id:'color',label:'Wood coloration',initialSeed:19257}),
    ]),
  }),
  Object.freeze({
    id:'timber-building',kind:'model',symbol:'⌂',
    label:'Timber-frame building',subtitle:'Three upgrade levels · optional empty interior',
    libraryPath:Object.freeze(['Architecture','Buildings','Timber frame']),
    navLabel:'Building family',navType:'3D',
    generate:generateBuildingFamily,
    defaultOptions:DEFAULT_BUILDING_OPTIONS,
    validateOptions:validateBuildingOptions,
    materialSlots:Object.freeze([
      Object.freeze({id:'timberWood',label:'Oak structural timber',
        generators:Object.freeze(['timber-oak'])}),
      Object.freeze({id:'roofThatch',label:'Thatch · level 1',
        generators:Object.freeze(['roof-thatch'])}),
      Object.freeze({id:'roofClay',label:'Clay tiles · levels 2–3',
        generators:Object.freeze(['roof-clay'])}),
    ]),
    overline:'ARCHITECTURE / TIMBER-FRAME FAMILY',
    title:'Timber-frame building.',
    description:'Northern European town architecture: jettied timber floors, articulated gables, varied roof tiles, dormers and a service wing. Three linked levels; a detachable unfurnished interior hall and side room share the same openings.',
    previewLabel:'Procedural timber frame building with optional interior preview',
    initialMasterSeed:19043,
    components:Object.freeze([
      Object.freeze({id:'structure',label:'Building proportions',initialSeed:19043}),
      Object.freeze({id:'material',label:'Roof and surface variation',initialSeed:62191}),
    ]),
  }),
  Object.freeze({
    id:'oak',kind:'model',symbol:'♠',label:'Oak tree',subtitle:'Oak wood & leaves',
    libraryPath:Object.freeze(['Vegetation','Oak']),navLabel:'Tree',navType:'3D',
    generate:generateOakAsset,
    overline:'OAK / WOOD + FOLIAGE',title:'Oak in leaf.',
    description:'European oak with seeded bark PBR material (albedo, normal, roughness and cavity AO), continuous axial UVs along each woody chain, and independently generated foliage. No export.',
    previewLabel:'Interactive 3D oak tree wood preview',
    initialMasterSeed:DEFAULT_TREE.seed,
    components:Object.freeze([
      Object.freeze({id:'geometry',label:'Wood geometry',initialSeed:DEFAULT_TREE.seed}),
      Object.freeze({id:'foliage',label:'Foliage placement',initialSeed:DEFAULT_TREE.seed}),
      Object.freeze({id:'leaves',label:'Leaf atlas',initialSeed:21749}),
      Object.freeze({id:'barkStructure',label:'Bark fissures',initialSeed:19641}),
      Object.freeze({id:'barkSurface',label:'Bark surface',initialSeed:48507}),
      Object.freeze({id:'barkColor',label:'Bark pigmentation',initialSeed:21749}),
    ]),
  }),
  Object.freeze({
    id:'fir',kind:'model',symbol:'♣',label:'Fir tree',subtitle:'Fir wood geometry',
    libraryPath:Object.freeze(['Vegetation','Fir']),navLabel:'Tree',navType:'3D',
    generate:generateFirAsset,
    overline:'FIR / WOOD GEOMETRY',title:'Fir wood.',
    description:'A young fir with a continuous leader, layered branch whorls and fine lateral shoots. Wood only; no needles, bark texture or export.',
    previewLabel:'Interactive 3D fir wood preview',
    initialMasterSeed:DEFAULT_TREE.seed,
    components:Object.freeze([
      Object.freeze({id:'geometry',label:'Wood geometry',initialSeed:DEFAULT_TREE.seed}),
    ]),
  }),
  Object.freeze({
    id:'oak-atlas',kind:'image',symbol:'▧',label:'Oak leaf atlas',
    libraryPath:Object.freeze(['Vegetation','Oak']),navLabel:'Leaf atlas',navType:'Atlas',
    subtitle:'Procedural RGBA foliage sprites',
    generate:generateOakAtlasAsset,
    overline:'2D / OAK LEAF ATLAS',title:'Leaf atlas.',
    description:'Inspect the current procedural oak leaf atlas separately from the tree. Each tile is baked from a seeded 3D-grown oak twig and individual leaves. Experimental game-scale sprites; no export yet.',
    previewLabel:'Procedural oak leaf atlas with transparent tiles',
    initialMasterSeed:21749,
    components:Object.freeze([
      Object.freeze({id:'leaves',label:'Leaf appearance',initialSeed:21749}),
    ]),
  }),
  Object.freeze({
    id:'oak-sprig',kind:'image',symbol:'❧',
    libraryPath:Object.freeze(['Vegetation','Oak']),navLabel:'Leaf spray',navType:'Sprite',
    label:'Oak leaf spray',subtitle:'Individual twig & leaves',
    generate:generateOakSprigAsset,
    overline:'2D / SINGLE OAK SPRAY',title:'An oak leaf spray.',
    description:'Independent 3D-grown twig with individually curved oak leaves, projected into a transparent RGBA sprite. This same sprite renderer now builds the tree foliage atlas.',
    previewLabel:'Baked oak leaf spray with transparent background',
    initialMasterSeed:19461,
    components:Object.freeze([
      Object.freeze({id:'structure',label:'Twig structure',initialSeed:19461}),
      Object.freeze({id:'leaves',label:'Leaf appearance',initialSeed:21749}),
    ]),
  }),
  Object.freeze({
    id:'oak-bark',kind:'image',symbol:'▤',
    libraryPath:Object.freeze(['Vegetation','Oak']),navLabel:'Bark',navType:'Texture',
    label:'Oak bark',subtitle:'Seamless mature oak bark PBR material',
    generate:generateOakBarkAsset,
    overline:'2D / OAK BARK',title:'Mature oak bark.',
    description:'Age-responsive oak bark with three independent maturity profiles: mature trunk, strong limbs and smooth young wood. Inspect Albedo, Normal, Roughness, cavity AO and Height for each profile; the 3D oak uses all three PBR materials.',
    previewLabel:'Seamless gray-brown oak bark albedo texture',
    initialMasterSeed:19641,
    components:Object.freeze([
      Object.freeze({id:'structure',label:'Bark fissures',initialSeed:19641}),
      Object.freeze({id:'surface',label:'Surface detail',initialSeed:48507}),
      Object.freeze({id:'color',label:'Pigmentation',initialSeed:21749}),
    ]),
  }),
]);
export function findGenerator(id){
  return GENERATORS.find(generator=>generator.id===id)??null;
}
// One explicit input per generated part. Geometry is always recomputed
// first; attached foliage is placed against that actual wood, using its
// own independent variation seed.
export function generateAsset(definition,componentSeeds,options,level=1){
  if(!GENERATORS.includes(definition))throw Error('Unknown generator');
  for(const component of definition.components)
    validateSeed(componentSeeds?.[component.id]);
  return definition.generate(componentSeeds,options,level);
}
