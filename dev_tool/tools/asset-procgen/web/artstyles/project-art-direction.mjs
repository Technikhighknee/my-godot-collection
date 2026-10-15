// Authoritative project-level visual identity policy. Pure and portable:
// no filesystem, editor state, canvas, or build implementation dependencies.
import {validateProductionArtstyle,assertGeneratorArtstyleSupport}
  from './production-artstyles.mjs';

export function emptyProjectArtDirection(){
  return {format:'devtool-art-direction',version:1,name:'Project identity',
    defaultArtstyle:null,generatorArtstyles:{}};
}
export function validateProjectArtDirection(raw,lookup){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))
    throw Error('Invalid project art direction');
  if(Object.keys(raw).sort().join()!==
    'defaultArtstyle,format,generatorArtstyles,name,version'||
    raw.format!=='devtool-art-direction'||raw.version!==1)
    throw Error('Unsupported project art direction');
  if(typeof raw.name!=='string'||!raw.name.trim()||
    raw.name.trim().length>100)
    throw Error('Invalid art direction name (1–100 characters)');
  if(!raw.generatorArtstyles||typeof raw.generatorArtstyles!=='object'||
    Array.isArray(raw.generatorArtstyles))
    throw Error('Invalid generator artstyle assignments');
  const defaultArtstyle=raw.defaultArtstyle===null?null:
    validateProductionArtstyle(raw.defaultArtstyle);
  const generatorArtstyles={};
  for(const id of Object.keys(raw.generatorArtstyles).sort()){
    if(!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(id))
      throw Error('Invalid artstyle generator ID: '+id);
    const def=lookup(id);
    if(!def)throw Error('Unknown artstyle generator: '+id);
    generatorArtstyles[id]=assertGeneratorArtstyleSupport(
      def,raw.generatorArtstyles[id]);
  }
  return {format:'devtool-art-direction',version:1,
    name:raw.name.trim(),defaultArtstyle,generatorArtstyles};
}

// An explicit per-asset pin always wins. A project assignment changes
// effective production inputs, never the persisted asset source itself.
export function resolveProjectArtstyle(generatorId,definition,
  explicitArtstyle,artDirection){
  const chosen=explicitArtstyle??
    artDirection.generatorArtstyles[generatorId]??
    artDirection.defaultArtstyle??undefined;
  return chosen===undefined?undefined:
    assertGeneratorArtstyleSupport(definition,chosen);
}

// Build plans and bakers receive one identical resolved view. Unstyled and
// imported resources retain exact identities and legacy cache fingerprints.
export function applyProjectArtDirection(entries,artDirection,lookup){
  return entries.map(entry=>{
    const source=entry.source;
    if('origin' in source||source.artstyle!==undefined)return entry;
    const definition=lookup(source.generator.id);
    if(!definition)throw Error('Unknown generator: '+source.generator.id);
    const chosen=resolveProjectArtstyle(source.generator.id,definition,
      undefined,artDirection);
    return chosen===undefined?entry:
      {...entry,source:{...source,artstyle:chosen}};
  });
}
