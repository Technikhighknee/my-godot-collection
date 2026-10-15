// Experimental style identities are independent of material interpretation.
// No saved asset may use these IDs as a production contract yet.
export const EXPERIMENTAL_ARTSTYLES=Object.freeze([
  Object.freeze({id:'classic-strategy-study',version:1,status:'experimental',
    label:'Classic PC Strategy',description:'Painted color, rough pigment and clearly readable details'}),
  Object.freeze({id:'naturalistic-study',version:1,status:'experimental',
    label:'Naturalistic',description:'Material-aware wear, fine physical grain and realistic pigments'}),
  Object.freeze({id:'hand-painted-study',version:1,status:'experimental',
    label:'Hand-Painted Fantasy',description:'Bold illustrated shapes, simplified colors and contrast'}),
  Object.freeze({id:'retro-3d-study',version:1,status:'experimental',
    label:'Retro 3D',description:'Chunky texels, ordered dithering and limited color depth'}),
  Object.freeze({id:'watercolor-study',version:1,status:'experimental',
    label:'Watercolor',description:'Illustrated material forms with pooled pigment and dry-brush grain'}),
]);
const byId=new Map(EXPERIMENTAL_ARTSTYLES.map(style=>[style.id,style]));
if(byId.size!==EXPERIMENTAL_ARTSTYLES.length)
  throw Error('Duplicate experimental artstyle identity');

export function findExperimentalArtstyle(id){return byId.get(id)??null;}

// Material capabilities must explicitly opt in to experimental grammars.
// Referencing an unknown or duplicate style is a startup error, not a
// silently missing studio option or an accidental production fallback.
export function defineExperimentalStyleSupport(ids){
  const unique=new Set(ids);
  if(unique.size!==ids.length)throw Error('Duplicate experimental artstyle support');
  for(const id of ids){
    if(!byId.has(id))throw Error('Unregistered experimental artstyle: '+id);
  }
  return Object.freeze([...ids]);
}
