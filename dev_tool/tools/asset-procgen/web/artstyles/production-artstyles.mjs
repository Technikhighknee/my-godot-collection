// Versioned production artstyle identities, independent of material algorithms.
// Experimental study styles are deliberately not production capabilities.
export const PRODUCTION_ARTSTYLES=Object.freeze([
  Object.freeze({id:'original',version:1,status:'production',label:'Generator original'}),
]);
// Keep every released version addressable. Registering v2 must not evict v1.
const byVersion=new Map(PRODUCTION_ARTSTYLES.map(style=>[
  style.id+'@'+style.version,style,
]));
if(byVersion.size!==PRODUCTION_ARTSTYLES.length)
  throw Error('Duplicate production artstyle identity/version');
const knownIds=new Set(PRODUCTION_ARTSTYLES.map(style=>style.id));

export function validateProductionArtstyle(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||
    Object.keys(value).sort().join()!=='id,version')
    throw Error('Invalid production artstyle reference');
  if(typeof value.id!=='string'||!knownIds.has(value.id))
    throw Error('Unknown or experimental production artstyle: '+String(value.id));
  if(!Number.isSafeInteger(value.version)||value.version<1)
    throw Error('Invalid production artstyle version');
  const capability=byVersion.get(value.id+'@'+value.version);
  if(!capability)
    throw Error('Unsupported production artstyle version for '+value.id+
      ': saved '+String(value.version));
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
