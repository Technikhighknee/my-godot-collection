// Generic 2D asset preview. Generator data and Canvas drawing are supplied
// by the asset; the view owns only display, checkerboard and fit/1:1 scale.
// Advanced inspection (channels, tile selection, export) is a later step.
export function imageFitScale(width,height,availableWidth,availableHeight){
  if(![width,height,availableWidth,availableHeight].every(x=>Number.isFinite(x)&&x>0))
    throw Error('Invalid 2D viewport dimensions');
  return Math.min(1,Math.max(.05,Math.min(availableWidth/width,availableHeight/height)));
}
export function validateImageAsset(asset){
  if(!asset||asset.kind!=='image'||!Number.isSafeInteger(asset.width)||
    !Number.isSafeInteger(asset.height)||asset.width<1||asset.height<1||
    asset.width>4096||asset.height>4096||typeof asset.paint!=='function')
    throw Error('Expected bounded 2D image asset');
  if(asset.tiles!==undefined&&(!Number.isInteger(asset.tiles)||asset.tiles<1||
    asset.tiles>4096))
    throw Error('Invalid 2D tile count');
  return asset;
}
export function createImageViewport(container,onChange=()=>{}){
  const scroll=document.createElement('div');
  scroll.className='pg-image-scroll';
  const mat=document.createElement('div');
  mat.className='pg-image-mat';
  scroll.append(mat);
  container.append(scroll);
  let canvas=null,asset=null,mode='fit',scale=1;
  const state=()=>({mode,scale,width:asset?.width??0,height:asset?.height??0});
  function resize(){
    if(!canvas||!asset)return;
    scale=mode==='fit'?imageFitScale(asset.width,asset.height,
      Math.max(1,container.clientWidth-70),
      Math.max(1,container.clientHeight-110)):1;
    mat.style.width=(asset.width*scale)+'px';
    mat.style.height=(asset.height*scale)+'px';
    onChange(state());
  }
  const observer=new ResizeObserver(resize);
  observer.observe(container);
  function render(next){
    validateImageAsset(next);
    // Draw off-DOM first so a failed generator cannot replace the old image.
    const fresh=document.createElement('canvas');
    fresh.width=next.width;fresh.height=next.height;
    next.paint(fresh);
    if(fresh.width!==next.width||fresh.height!==next.height)
      throw Error('Image generator changed the declared dimensions');
    fresh.className='pg-image-canvas';
    mat.replaceChildren(fresh);
    canvas=fresh;asset=next;
    resize();
    return {width:asset.width,height:asset.height,
      channels:asset.channels??'RGBA',tiles:asset.tiles??0};
  }
  function setMode(next){
    if(next!=='fit'&&next!=='actual')throw Error('Unknown image scale mode');
    mode=next;
    resize();
  }
  return {render,setMode,state};
}
