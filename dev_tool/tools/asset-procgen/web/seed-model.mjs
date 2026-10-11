// Stable component-level seed ownership, independent of UI and asset type.
// No random calls in generators: same seed set always produces the same asset.
export const MAX_SEED=0xffffffff;
export function validateSeed(seed){
  if(!Number.isInteger(seed)||seed<0||seed>MAX_SEED)
    throw Error('Seed must be an integer between 0 and 4294967295');
  return seed;
}
export function parseSeed(text){
  if(typeof text!=='string'||! /^(0|[1-9][0-9]*)$/.test(text.trim()))
    throw Error('Seed must be an integer between 0 and 4294967295');
  return validateSeed(Number(text.trim()));
}
// Stable avalanche of a master seed and a semantic component ID.
// Adding or reordering unrelated components never changes existing seeds.
export function deriveSeed(masterSeed,componentId){
  validateSeed(masterSeed);
  if(typeof componentId!=='string'||!componentId)
    throw Error('Component ID is required');
  let hash=(2166136261^masterSeed)>>>0;
  for(let i=0;i<componentId.length;i++){
    hash=Math.imul(hash^componentId.charCodeAt(i),16777619)>>>0;
  }
  hash^=hash>>>16;hash=Math.imul(hash,0x7feb352d)>>>0;
  hash^=hash>>>15;hash=Math.imul(hash,0x846ca68b)>>>0;
  return (hash^(hash>>>16))>>>0;
}
function requireComponent(definition,componentId){
  if(!definition.components.some(component=>component.id===componentId))
    throw Error('Unknown generator component: '+componentId);
}
export function createSeedState(definition){
  const components={};
  for(const component of definition.components){
    if(Object.hasOwn(components,component.id))
      throw Error('Duplicate generator component: '+component.id);
    components[component.id]=validateSeed(component.initialSeed);
  }
  return {masterSeed:validateSeed(definition.initialMasterSeed),components};
}
export function updateComponentSeed(definition,state,componentId,seed){
  requireComponent(definition,componentId);
  return {
    ...state,components:{...state.components,[componentId]:validateSeed(seed)},
  };
}
// Master seed is a convenience control, not a hidden dependency of a part.
// The primary geometry seed equals master for predictable old-style usage.
export function updateMasterSeed(definition,_state,masterSeed){
  validateSeed(masterSeed);
  const components={};
  for(const component of definition.components)
    components[component.id]=component.id==='geometry'?masterSeed:
      deriveSeed(masterSeed,component.id);
  return {masterSeed,components};
}
