// Architecture owns construction, surface slots and model bake contracts.
import {DEFAULT_BUILDING_OPTIONS,validateBuildingOptions,generateBuildingFamily}
  from '../building.mjs';
import {canonicalBuildingModel} from '../canonical-model.mjs';

export const ARCHITECTURE_GENERATORS=Object.freeze([
  Object.freeze({
    id:'timber-building',kind:'model',recipeVersion:1,symbol:'⌂',
    modelBake:Object.freeze({
      variants:Object.freeze([1,2,3].flatMap(level=>[
        Object.freeze({name:'level-'+level+'-exterior',level,view:'exterior'}),
        Object.freeze({name:'level-'+level+'-interior',level,view:'interior'}),
      ])),
      canonicalize:(asset,variant)=>canonicalBuildingModel(asset,variant.view),
    }),
    label:'Timber-frame building',subtitle:'Three upgrade levels · optional empty interior',
    libraryPath:Object.freeze(['Architecture','Buildings','Timber frame']),
    navLabel:'Building family',navType:'3D',
    generate:generateBuildingFamily,
    defaultOptions:DEFAULT_BUILDING_OPTIONS,
    validateOptions:validateBuildingOptions,
    materialSlots:Object.freeze([
      Object.freeze({id:'foundationStone',label:'Rubble stone · foundations',
        generators:Object.freeze(['stone-rubble'])}),
      Object.freeze({id:'facadePlaster',label:'Lime plaster · facades',
        generators:Object.freeze(['plaster-lime'])}),
      Object.freeze({id:'timberWood',label:'Oak structural timber',
        generators:Object.freeze(['timber-oak'])}),
      Object.freeze({id:'roofThatch',label:'Thatch · level 1',
        generators:Object.freeze(['roof-thatch'])}),
      Object.freeze({id:'roofClay',label:'Clay tiles · levels 2–3',
        generators:Object.freeze(['roof-clay'])}),
    ]),
    overline:'ARCHITECTURE / TIMBER-FRAME FAMILY',
    title:'Timber-frame building.',
    description:'Northern European timber-frame building with three linked levels and separate optional interior scenes. Each level exports to GLB; assigned shared project PBR materials are embedded.',
    previewLabel:'Procedural timber frame building with optional interior preview',
    initialMasterSeed:19043,
    components:Object.freeze([
      Object.freeze({id:'structure',label:'Building proportions',initialSeed:19043}),
      Object.freeze({id:'material',label:'Roof and surface variation',initialSeed:62191}),
    ]),
  }),
]);
