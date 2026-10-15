// Public capability lookup for the editor and headless production.
// The catalogue contains no generator-specific algorithms.
import {validateSeed} from './seed-model.mjs';
import {MATERIAL_GENERATORS} from './generator-definitions/materials.mjs';
import {ARCHITECTURE_GENERATORS} from './generator-definitions/architecture.mjs';
import {VEGETATION_GENERATORS} from './generator-definitions/vegetation.mjs';

export const GENERATORS=Object.freeze([
  ...MATERIAL_GENERATORS,
  ...ARCHITECTURE_GENERATORS,
  ...VEGETATION_GENERATORS,
]);
const definitions=new Map();
for(const definition of GENERATORS){
  if(definitions.has(definition.id))throw Error('Duplicate generator ID: '+definition.id);
  if(!Number.isSafeInteger(definition.recipeVersion)||definition.recipeVersion<1)
    throw Error('Invalid generator recipe version: '+definition.id);
  if(!Array.isArray(definition.components)||
    new Set(definition.components.map(component=>component.id)).size!==definition.components.length)
    throw Error('Invalid generator seed components: '+definition.id);
  definitions.set(definition.id,definition);
}

export function findGenerator(id){return definitions.get(id)??null;}
export function generateAsset(definition,componentSeeds,options,level=1){
  if(definitions.get(definition?.id)!==definition)throw Error('Unknown generator');
  for(const component of definition.components)
    validateSeed(componentSeeds?.[component.id]);
  return definition.generate(componentSeeds,options,level);
}
