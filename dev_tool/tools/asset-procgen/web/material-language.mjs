// Shared material semantics for procedural texture studies.
//
// Physical structure, pigment and aging have independent deterministic seed
// streams. Styles render these facts differently; they must not invent a new
// unrelated crack or moss map by simply filtering the finished RGB image.
//
// This module does not paint, know about canvas, or prescribe a style palette.
import {deriveSeed,validateSeed} from './seed-model.mjs';

export const MATERIAL_SEED_ROLES=Object.freeze({
  'roof-clay':Object.freeze({form:'pattern',pigment:'color'}),
  'roof-thatch':Object.freeze({form:'pattern',pigment:'color'}),
  'timber-oak':Object.freeze({form:'grain',pigment:'color'}),
  'plaster-lime':Object.freeze({form:'structure',pigment:'pigment',aging:'wear'}),
  'stone-rubble':Object.freeze({form:'layout',pigment:'mineral',aging:'weather'}),
});
const wrap=(n,size)=>(n%size+size)%size;
const clamp=n=>Math.max(0,Math.min(1,n));
const smooth=t=>{t=clamp(t);return t*t*(3-2*t);};
function hash(x,y,seed){
  let n=(Math.imul(x,374761393)^Math.imul(y,668265263)^(seed>>>0))>>>0;
  n=Math.imul(n^(n>>>13),1274126177);
  return ((n^(n>>>16))>>>0)/4294967296;
}
export function materialSeedStreams(material,seeds){
  const roles=MATERIAL_SEED_ROLES[material];
  if(!roles)throw Error('Unknown material seed roles: '+material);
  const form=validateSeed(seeds?.[roles.form]);
  const pigment=validateSeed(seeds?.[roles.pigment]);
  // Two-component materials have reproducible aging derived from form.
  // Recoloring can never relocate patina or alter a normal map.
  const aging=roles.aging?validateSeed(seeds?.[roles.aging]):
    deriveSeed(form,material+':aging');
  return Object.freeze({form,pigment,aging});
}
// Normalized element coordinates are periodic. Geometry IDs do not depend on
// pigment or aging; each per-element property owns its own salted stream.
export function materialElementTraits(column,row,columns,rows,streams){
  if(!Number.isInteger(columns)||columns<1||
     !Number.isInteger(rows)||rows<1)
    throw Error('Material element grid must be positive integers');
  const x=wrap(column,columns),y=wrap(row,rows);
  return Object.freeze({
    form:hash(x,y,streams.form^0xa34d21f0),
    variation:hash(x,y,streams.pigment^0x479f5a21),
    age:hash(x,y,streams.aging^0xc18db4e7),
    deposits:hash(x,y,streams.aging^0x2bf594d1),
    fracture:hash(x,y,streams.form^0x8a53c19f),
    fracturePosition:.24+hash(x,y,streams.form^0x3ac271a5)*.52,
    fractureSkew:hash(x,y,streams.form^0x32f18ea6)-.5,
    chipped:hash(x,y,streams.form^0x61d9f827),
  });
}
// Describes WHERE damage occurs on an individual piece, not how it is
// colored. A roof tile, a stone and a piece of timber can interpret the
// resulting masks differently in their own PBR/art-direction renderers.
export function materialElementWear(traits,u,v){
  const x=clamp(u),y=clamp(v);
  const edge=Math.min(x,1-x,y,1-y);
  const moisture=traits.deposits*
    smooth((y-.42)/.52)*(.38+.62*smooth((.22-edge)/.22));
  const erosion=traits.chipped*
    (1-smooth(edge/.105))*smooth((traits.age-.34)/.55);
  const line=traits.fracturePosition+
    traits.fractureSkew*(y-.5)*.21+
    Math.sin(y*11+traits.fractureSkew*7)*.012;
  const crack=traits.fracture>.87?
    (1-smooth(Math.abs(x-line)/.014))*
      smooth((y-.08)/.18)*(1-smooth((y-.93)/.07)):
    0;
  return {moisture,erosion,crack};
}
