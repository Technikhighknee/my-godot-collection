// Sixteen game-scale foliage cards, each baked from the same 3D-grown
// oak twig and leaf geometry used by the standalone spray inspector.
// Keep one shared deterministic atlas for the entire tree.
import {generateOakSprig,paintOakSprigTile} from './oak-sprig.mjs';
import {OAK_ATLAS_GRID} from './oak-foliage.mjs';
export const OAK_ATLAS_TILE=256;
export const OAK_ATLAS_SIZE=OAK_ATLAS_TILE*OAK_ATLAS_GRID;
function random(seed){
  let state=seed>>>0;
  return ()=>{
    state=(state+0x6d2b79f5)>>>0;
    let x=state;
    x=Math.imul(x^(x>>>15),x|1);
    x^=x+Math.imul(x^(x>>>7),x|61);
    return ((x^(x>>>14))>>>0)/4294967296;
  };
}
export function paintOakAtlas(canvas,seed=21749){
  if(!canvas||typeof canvas.getContext!=='function'||
    !Number.isInteger(seed)||seed<0||seed>0xffffffff)
    throw Error('Invalid oak atlas canvas or seed');
  canvas.width=OAK_ATLAS_SIZE;
  canvas.height=OAK_ATLAS_SIZE;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw Error('Canvas 2D unavailable for oak atlas');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  for(let tile=0;tile<OAK_ATLAS_GRID**2;tile++){
    const rng=random((seed^Math.imul(tile+1,0x9e3779b1))>>>0);
    const sprig=generateOakSprig({
      structureSeed:Math.floor(rng()*4294967296),
      leafSeed:Math.floor(rng()*4294967296),
    });
    const left=(tile%OAK_ATLAS_GRID)*OAK_ATLAS_TILE;
    const top=Math.floor(tile/OAK_ATLAS_GRID)*OAK_ATLAS_TILE;
    paintOakSprigTile(ctx,sprig,left,top,OAK_ATLAS_TILE);
  }
  return {size:OAK_ATLAS_SIZE,tiles:OAK_ATLAS_GRID**2,padding:9};
}
