// Versioned production artstyle identities, independent of material algorithms.
// Experimental study styles are deliberately not production capabilities.
export const PRODUCTION_ARTSTYLES=Object.freeze([
  Object.freeze({id:'original',version:1,status:'production',label:'Generator original'}),
]);
const byId=new Map(PRODUCTION_ARTSTYLES.map(style=>[style.id,style]));
if(byId.size!==PRODUCTION_ARTSTYLES.length)
  throw Error('Duplicate production artstyle ID');

export function validateProductionArtstyle(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||
    Object.keys(value).sort().join()!=='id,version')
    throw Error('Invalid production artstyle reference');
  const capability=byId.get(value.id);
  if(!capability)
    throw Error('Unknown or experimental production artstyle: '+String(value.id));
  if(capability.version!==value.version)
    throw Error('Unsupported production artstyle version for '+value.id+
      ': saved '+String(value.version)+', available '+capability.version);
  return Object.freeze({id:capability.id,version:capability.version});
}

// Only the original style can use the original generator without a specialized
// interpretation. New styles must be explicitly supported by each producer.
export function assertGeneratorArtstyleSupport(definition,value){
  const style=validateProductionArtstyle(value);
  if(style.id!=='original'&&
    !definition?.productionStyleGeneration?.styles?.some(s=>
      s.id===style.id&&s.version===style.version))
    throw Error('Generator does not support production artstyle: '+style.id);
  return style;
}
export function availableProductionArtstyles(definition){
  return PRODUCTION_ARTSTYLES.filter(style=>style.id==='original'||
    definition?.productionStyleGeneration?.styles?.some(s=>
      s.id===style.id&&s.version===style.version));
}
