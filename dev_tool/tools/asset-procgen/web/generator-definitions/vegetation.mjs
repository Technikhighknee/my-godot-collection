// Vegetation owns growth, foliage, bark and canonical output adapters.
import {DEFAULT_TREE,generateTree} from '../tree.mjs';
import {generateFir} from '../fir.mjs';
import {generateOakFoliage} from '../oak-foliage.mjs';
import {paintOakAtlas,OAK_ATLAS_SIZE} from '../oak-atlas.mjs';
import {generateOakSprig,paintOakSprig,OAK_SPRIG_SIZE} from '../oak-sprig.mjs';
import {OAK_BARK_SIZE,OAK_BARK_MAPS,OAK_BARK_PROFILES,
  generateOakBarkMaterial,paintGeneratedOakBarkMap} from '../oak-bark.mjs';
import {mapOakBarkWood} from '../oak-bark-uv.mjs';
import {canonicalTreeModel,canonicalOakModel} from '../canonical-model.mjs';

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
// Generate export channels from the same bark implementation used in the
// viewport. No alternate material algorithm is introduced for baking.
function oakBarkBakeMaps(asset){
  if(!asset.barkSeeds)throw Error('Missing oak bark recipe');
  const profiles={};
  for(const profile of OAK_BARK_PROFILES){
    const maps=generateOakBarkMaterial({...asset.barkSeeds,profile});
    profiles[profile]={
      albedo:{width:maps.width,height:maps.height,rgba:maps.albedo},
      normal:{width:maps.width,height:maps.height,rgba:maps.normal},
      roughness:{width:maps.width,height:maps.height,rgba:maps.roughness},
      ao:{width:maps.width,height:maps.height,rgba:maps.ao},
    };
  }
  if(!Number.isInteger(asset.atlasSeed))
    throw Error('Missing oak foliage atlas seed');
  return {
    oakBark:profiles,
    oakFoliage:{default:{
      albedo:{paint:canvas=>paintOakAtlas(canvas,asset.atlasSeed)},
    }},
  };
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
export const VEGETATION_GENERATORS=Object.freeze([
  Object.freeze({
    id:'oak',kind:'model',recipeVersion:1,symbol:'♠',label:'Oak tree',subtitle:'Oak wood & leaves',
    modelBake:Object.freeze({
      variants:Object.freeze([Object.freeze({name:'model',level:1})]),
      canonicalize:asset=>canonicalOakModel(asset),
      materialMaps:asset=>oakBarkBakeMaps(asset),
    }),
    libraryPath:Object.freeze(['Vegetation','Oak']),navLabel:'Tree',navType:'3D',
    generate:generateOakAsset,
    overline:'OAK / WOOD + FOLIAGE',title:'Oak in leaf.',
    description:'European oak with seeded bark PBR and a transparent leaf-card atlas. Full GLB export preserves the native wood geometry, bark materials and foliage cards.',
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
    id:'fir',kind:'model',recipeVersion:1,symbol:'♣',
    modelBake:Object.freeze({
      variants:Object.freeze([Object.freeze({name:'model',level:1})]),
      canonicalize:asset=>canonicalTreeModel(asset),
    }),label:'Fir tree',subtitle:'Fir wood geometry',
    libraryPath:Object.freeze(['Vegetation','Fir']),navLabel:'Tree',navType:'3D',
    generate:generateFirAsset,
    overline:'FIR / WOOD GEOMETRY',title:'Fir wood.',
    description:'A young fir with a continuous leader, layered branch whorls and fine lateral shoots. Wood-only GLB export; needles and detailed bark materials are not generated yet.',
    previewLabel:'Interactive 3D fir wood preview',
    initialMasterSeed:DEFAULT_TREE.seed,
    components:Object.freeze([
      Object.freeze({id:'geometry',label:'Wood geometry',initialSeed:DEFAULT_TREE.seed}),
    ]),
  }),
  Object.freeze({
    id:'oak-atlas',kind:'image',recipeVersion:1,headlessCanvasBake:true,symbol:'▧',label:'Oak leaf atlas',
    libraryPath:Object.freeze(['Vegetation','Oak']),navLabel:'Leaf atlas',navType:'Atlas',
    subtitle:'Procedural RGBA foliage sprites',
    generate:generateOakAtlasAsset,
    overline:'2D / OAK LEAF ATLAS',title:'Leaf atlas.',
    description:'Transparent game-scale atlas rendered from seeded 3D-grown oak twigs and leaves; PNG export uses the same painting routine as the browser preview.',
    previewLabel:'Procedural oak leaf atlas with transparent tiles',
    initialMasterSeed:21749,
    components:Object.freeze([
      Object.freeze({id:'leaves',label:'Leaf appearance',initialSeed:21749}),
    ]),
  }),
  Object.freeze({
    id:'oak-sprig',kind:'image',recipeVersion:1,headlessCanvasBake:true,symbol:'❧',
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
    id:'oak-bark',kind:'image',recipeVersion:1,headlessBake:true,symbol:'▤',
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
  }),]);
