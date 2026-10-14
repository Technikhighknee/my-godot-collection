// The watercolor medium, not a generic material painter. Material generators
// supply their own pigment fields, paper grain and real piece/joint boundaries.
// Inputs are centered, periodic signals in [-.5,.5]; edge is a local mask.
// No height/normal changes belong here: pigment must remain reseedable.
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const smooth=v=>{v=clamp(v);return v*v*(3-2*v);};

export function watercolorPigment({wash,secondary,grain,paper,stroke,edge}){
  // Overlapping translucent washes. Their varying opacity is intentional:
  // shifting RGB alone cannot make an opaque surface read as watercolor.
  const wet=smooth(.5+(wash*.84+secondary*.38+stroke*.13)*2.15);
  // Pigment gathers where water stops against the actual material boundaries.
  // Avoid global isoline rings: the generator decides where a boundary exists.
  const pooling=clamp(edge)*(.043+.083*wet)*
    (.74+.26*smooth(.5+secondary));
  // Granulation settles into the paper tooth. Occasional dry-brush breaks
  // expose warm paper rather than scattering arbitrary dark noise.
  const tooth=grain*.083+paper*.043;
  const skip=smooth((grain+paper*.53+.02)/.34)*
    smooth((.57-wet)/.43);
  const opacity=clamp(.53+.31*wet+stroke*.09-skip*.23,.25,.94);
  return {opacity,pooling,granulation:tooth*(.55+.45*wet),
    paperLift:skip*.064,wet};
}
