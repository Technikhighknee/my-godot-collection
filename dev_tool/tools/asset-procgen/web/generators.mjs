// Catalog of independent asset generators. This knows no DOM, WebGL,
// canvas or editor state. Future 2D generators can use the same catalog.
import {DEFAULT_TREE,generateTree} from './tree.mjs';
import {generateFir} from './fir.mjs';
import {generateOakFoliage} from './oak-foliage.mjs';
import {validateSeed} from './seed-model.mjs';
import {paintOakAtlas,OAK_ATLAS_SIZE} from './oak-atlas.mjs';

// Each registration owns its implementation; the UI never switches on
// generator IDs to decide how an asset is produced.
function generateOakAsset(seeds){
  const wood=generateTree({seed:seeds.geometry});
  return {id:'oak',kind:'model',wood,
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
export const GENERATORS=Object.freeze([
  Object.freeze({
    id:'oak',kind:'model',symbol:'♠',label:'Oak tree',subtitle:'Oak wood & leaves',
    generate:generateOakAsset,
    overline:'OAK / WOOD + FOLIAGE',title:'Oak in leaf.',
    description:'A European oak with branch-supported textured leaf cushions generated from a procedural oak atlas. No bark texture or export.',
    previewLabel:'Interactive 3D oak tree wood preview',
    initialMasterSeed:DEFAULT_TREE.seed,
    components:Object.freeze([
      Object.freeze({id:'geometry',label:'Wood geometry',initialSeed:DEFAULT_TREE.seed}),
      Object.freeze({id:'foliage',label:'Foliage placement',initialSeed:DEFAULT_TREE.seed}),
      Object.freeze({id:'leaves',label:'Leaf atlas',initialSeed:21749}),
    ]),
  }),
  Object.freeze({
    id:'fir',kind:'model',symbol:'♣',label:'Fir tree',subtitle:'Fir wood geometry',
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
    subtitle:'Procedural RGBA foliage sprites',
    generate:generateOakAtlasAsset,
    overline:'2D / OAK LEAF ATLAS',title:'Leaf atlas.',
    description:'Inspect the current procedural oak leaf atlas separately from the tree. The sprites are still experimental; no baking, export or advanced image tools yet.',
    previewLabel:'Procedural oak leaf atlas with transparent tiles',
    initialMasterSeed:21749,
    components:Object.freeze([
      Object.freeze({id:'leaves',label:'Leaf appearance',initialSeed:21749}),
    ]),
  }),
]);
export function findGenerator(id){
  return GENERATORS.find(generator=>generator.id===id)??null;
}
// One explicit input per generated part. Geometry is always recomputed
// first; attached foliage is placed against that actual wood, using its
// own independent variation seed.
export function generateAsset(definition,componentSeeds){
  if(!GENERATORS.includes(definition))throw Error('Unknown generator');
  for(const component of definition.components)
    validateSeed(componentSeeds?.[component.id]);
  return definition.generate(componentSeeds);
}
