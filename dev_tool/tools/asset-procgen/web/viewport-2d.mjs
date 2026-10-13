// Generator-independent 2D inspector. All inspection views are derived
// from a private source canvas; seed content is never rewritten by the UI.
export const IMAGE_MIN_ZOOM=.05;
export const IMAGE_MAX_ZOOM=16;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

export function imageFitScale(width,height,availableWidth,availableHeight){
  if(![width,height,availableWidth,availableHeight].every(x=>Number.isFinite(x)&&x>0))
    throw Error('Invalid 2D viewport dimensions');
  return Math.min(1,Math.max(IMAGE_MIN_ZOOM,
    Math.min(availableWidth/width,availableHeight/height)));
}
export function validateImageAsset(asset){
  if(!asset||asset.kind!=='image'||!Number.isSafeInteger(asset.width)||
    !Number.isSafeInteger(asset.height)||asset.width<1||asset.height<1||
    asset.width>4096||asset.height>4096||typeof asset.paint!=='function')
    throw Error('Expected bounded 2D image asset');
  if(asset.tiles!==undefined&&(!Number.isInteger(asset.tiles)||asset.tiles<1||
    asset.tiles>4096))
    throw Error('Invalid 2D tile count');
  if(asset.profiles!==undefined&&(!Array.isArray(asset.profiles)||
    asset.profiles.length<1||asset.profiles.some(value=>
      typeof value!=='string'||!value)||
    new Set(asset.profiles).size!==asset.profiles.length))
    throw Error('Invalid image profiles');
  if(asset.profileSizes!==undefined){
    if(!asset.profiles||Object.keys(asset.profileSizes).some(profile=>
      !asset.profiles.includes(profile)||!asset.profileSizes[profile]||
      !['width','height'].every(axis=>
        Number.isInteger(asset.profileSizes[profile][axis])&&
        asset.profileSizes[profile][axis]>0&&
        asset.profileSizes[profile][axis]<=4096)))
      throw Error('Invalid image profile dimensions');
  }
  if(asset.views!==undefined&&(!Array.isArray(asset.views)||
    asset.views.length<1||asset.views.some(name=>
      typeof name!=='string'||!name.length)||
    new Set(asset.views).size!==asset.views.length))
    throw Error('Invalid image views');
  if(asset.atlas!==undefined){
    const {columns,rows}=asset.atlas??{};
    if(!Number.isInteger(columns)||!Number.isInteger(rows)||
      columns<1||rows<1||columns>64||rows>64||
      columns*rows!==asset.tiles||
      asset.width%columns!==0||asset.height%rows!==0)
      throw Error('Invalid 2D atlas layout');
  }
  return asset;
}
// Every profile may represent a different cut or aspect ratio.
export function imageProfileSize(asset,profile=null){
  validateImageAsset(asset);
  return asset.profileSizes?.[profile]??{width:asset.width,height:asset.height};
}
// Null selects the complete image. Tile coordinates are in source pixels.
export function imageTileRect(asset,tile,profile=null){
  const dimensions=imageProfileSize(asset,profile);
  if(tile===null)return {x:0,y:0,...dimensions};
  if(!asset.atlas||!Number.isInteger(tile)||tile<0||tile>=asset.tiles)
    throw Error('Invalid image tile');
  const width=dimensions.width/asset.atlas.columns;
  const height=dimensions.height/asset.atlas.rows;
  return {x:(tile%asset.atlas.columns)*width,
    y:Math.floor(tile/asset.atlas.columns)*height,width,height};
}
// Preserve the exact source pixel under the cursor while zooming.
export function imageZoomAt(oldZoom,newZoom,x,y,offsetX,offsetY){
  if(![oldZoom,newZoom,x,y,offsetX,offsetY].every(Number.isFinite)||
    oldZoom<=0||newZoom<=0)throw Error('Invalid image zoom');
  return {x:x-(x-offsetX)*newZoom/oldZoom,
    y:y-(y-offsetY)*newZoom/oldZoom};
}
export function createImageViewport(container,onChange=()=>{}){
  const surface=document.createElement('div');
  surface.className='pg-image-surface';
  surface.tabIndex=0;
  surface.setAttribute('aria-label','Pan image with drag; zoom at cursor with wheel; click a tile to inspect it');
  const mat=document.createElement('div');
  mat.className='pg-image-mat';
  const guide=document.createElement('div');
  guide.className='pg-image-grid';
  guide.setAttribute('aria-hidden','true');
  surface.append(mat);
  container.append(surface);
  let source=null,canvas=null,asset=null,tile=null,channel='rgba';
  let view=null,profile=null;
  let mode='fit',zoom=1,offsetX=0,offsetY=0;
  let viewWidth=0,viewHeight=0,drag=null;
  const state=()=>({
    mode,scale:zoom,width:source?.width??asset?.width??0,
    height:source?.height??asset?.height??0,
    viewWidth:canvas?.width??0,viewHeight:canvas?.height??0,
    channel,tile,tiles:asset?.tiles??0,hasAtlas:!!asset?.atlas,
    view,views:asset?.views??[],
    profile,profiles:asset?.profiles??[],
  });
  const changed=()=>onChange(state());
  function bounds(){
    if(!canvas)return;
    // Never let the entire inspected image disappear off-screen.
    const w=canvas.width*zoom,h=canvas.height*zoom;
    offsetX=clamp(offsetX,Math.min(32-w,viewWidth-32),
      Math.max(32,viewWidth-32));
    offsetY=clamp(offsetY,Math.min(32-h,viewHeight-32),
      Math.max(32,viewHeight-32));
  }
  function paintTransform(){
    if(!canvas)return;
    mat.style.width=canvas.width+'px';
    mat.style.height=canvas.height+'px';
    canvas.style.imageRendering=zoom>=2?'pixelated':'auto';
    mat.style.transform='translate('+offsetX+'px,'+offsetY+'px) scale('+zoom+')';
    changed();
  }
  function center(nextZoom){
    zoom=nextZoom;
    offsetX=(viewWidth-canvas.width*zoom)/2;
    offsetY=(viewHeight-canvas.height*zoom)/2;
    paintTransform();
  }
  function fit(){
    return imageFitScale(canvas.width,canvas.height,
      Math.max(1,viewWidth-64),Math.max(1,viewHeight-152));
  }
  function resize(){
    const oldWidth=viewWidth,oldHeight=viewHeight;
    viewWidth=Math.max(1,container.clientWidth);
    viewHeight=Math.max(1,container.clientHeight);
    if(!canvas)return;
    if(mode==='fit')center(fit());
    else{
      offsetX+=(viewWidth-oldWidth)/2;
      offsetY+=(viewHeight-oldHeight)/2;
      bounds();paintTransform();
    }
  }
  const observer=new ResizeObserver(resize);
  observer.observe(container);
  function compose(nextSource,nextAsset,nextTile,nextChannel,nextProfile){
    const r=imageTileRect(nextAsset,nextTile,nextProfile);
    const rendered=document.createElement('canvas');
    rendered.width=r.width;rendered.height=r.height;
    const ctx=rendered.getContext('2d',{willReadFrequently:true});
    if(!ctx)throw Error('Canvas 2D unavailable for image inspector');
    ctx.drawImage(nextSource,r.x,r.y,r.width,r.height,0,0,r.width,r.height);
    if(nextChannel!=='rgba'){
      const pixels=ctx.getImageData(0,0,r.width,r.height);
      const d=pixels.data;
      for(let i=0;i<d.length;i+=4){
        if(nextChannel==='alpha'){
          const a=d[i+3];
          d[i]=a;d[i+1]=a;d[i+2]=a;
        }
        d[i+3]=255;
      }
      ctx.putImageData(pixels,0,0);
    }
    rendered.className='pg-image-canvas';
    return rendered;
  }
  function showGrid(){
    guide.hidden=!asset?.atlas||tile!==null;
    if(!guide.hidden){
      guide.style.backgroundSize=(canvas.width/asset.atlas.columns)+'px '+
        (canvas.height/asset.atlas.rows)+'px';
    }
  }
  function swap(nextCanvas,nextSource,nextAsset,nextTile,nextChannel,reframe){
    mat.replaceChildren(nextCanvas,guide);
    canvas=nextCanvas;source=nextSource;asset=nextAsset;
    tile=nextTile;channel=nextChannel;
    showGrid();
    if(reframe){
      mode='fit';
      viewWidth=Math.max(1,container.clientWidth);
      viewHeight=Math.max(1,container.clientHeight);
      center(fit());
    }else paintTransform();
  }
  function render(next){
    validateImageAsset(next);
    // Painting or channel conversion may throw; the old visible asset survives.
    const fresh=document.createElement('canvas');
    const nextView=next.views?.includes(view)?view:(next.views?.[0]??null);
    const nextProfile=next.profiles?.includes(profile)?profile:
      (next.profiles?.[0]??null);
    const dimensions=imageProfileSize(next,nextProfile);
    fresh.width=dimensions.width;fresh.height=dimensions.height;
    next.paint(fresh,nextView??undefined,nextProfile??undefined);
    if(fresh.width!==dimensions.width||fresh.height!==dimensions.height)
      throw Error('Image generator changed the declared profile dimensions');
    const keepTile=next.atlas&&asset?.id===next.id&&tile!==null&&
      tile<next.tiles?tile:null;
    const preview=compose(fresh,next,keepTile,channel,nextProfile);
    const reframe=!canvas||!asset||asset.id!==next.id||
      canvas.width!==preview.width||canvas.height!==preview.height;
    swap(preview,fresh,next,keepTile,channel,reframe);
    view=nextView;
    profile=nextProfile;
    changed();
    return {width:source.width,height:source.height,
      channels:asset.channels??'RGBA',tiles:asset.tiles??0};
  }
  function setView(next){
    if(!asset?.views?.includes(next))throw Error('Unknown image view');
    if(next===view)return;
    const fresh=document.createElement('canvas');
    const dimensions=imageProfileSize(asset,profile);
    fresh.width=dimensions.width;fresh.height=dimensions.height;
    asset.paint(fresh,next,profile??undefined);
    if(fresh.width!==dimensions.width||fresh.height!==dimensions.height)
      throw Error('Image generator changed the declared profile dimensions');
    const preview=compose(fresh,asset,tile,channel,profile);
    swap(preview,fresh,asset,tile,channel,false);
    view=next;
    changed();
  }
  function setProfile(next){
    if(!asset?.profiles?.includes(next))throw Error('Unknown image profile');
    if(next===profile)return;
    const fresh=document.createElement('canvas');
    const dimensions=imageProfileSize(asset,next);
    fresh.width=dimensions.width;fresh.height=dimensions.height;
    asset.paint(fresh,view??undefined,next);
    if(fresh.width!==dimensions.width||fresh.height!==dimensions.height)
      throw Error('Image generator changed the declared profile dimensions');
    const preview=compose(fresh,asset,tile,channel,next);
    swap(preview,fresh,asset,tile,channel,true);
    profile=next;
    changed();
  }
  function setMode(next){
    if(next!=='fit'&&next!=='actual')throw Error('Unknown image scale mode');
    mode=next;
    if(!canvas)return;
    viewWidth=Math.max(1,container.clientWidth);
    viewHeight=Math.max(1,container.clientHeight);
    center(next==='fit'?fit():1);
  }
  function zoomAt(nextZoom,x,y){
    if(!canvas)return;
    const adjusted=clamp(nextZoom,IMAGE_MIN_ZOOM,IMAGE_MAX_ZOOM);
    const location=imageZoomAt(zoom,adjusted,x,y,offsetX,offsetY);
    zoom=adjusted;offsetX=location.x;offsetY=location.y;
    mode='custom';
    bounds();paintTransform();
  }
  function zoomStep(direction){
    if(!Number.isFinite(direction)||direction===0)throw Error('Invalid zoom direction');
    zoomAt(zoom*(direction>0?1.25:.8),viewWidth/2,viewHeight/2);
  }
  function setChannel(next){
    if(!['rgba','rgb','alpha'].includes(next))
      throw Error('Invalid image channel');
    if(next===channel)return;
    if(!source){channel=next;changed();return;}
    const preview=compose(source,asset,tile,next,profile);
    swap(preview,source,asset,tile,next,false);
  }
  function selectTile(next){
    if(next!==null)imageTileRect(asset,next,profile);
    if(!asset||next===tile)return;
    const preview=compose(source,asset,next,channel,profile);
    swap(preview,source,asset,next,channel,true);
  }
  const pointerXY=event=>{
    const rect=surface.getBoundingClientRect();
    return [event.clientX-rect.left,event.clientY-rect.top];
  };
  surface.addEventListener('wheel',event=>{
    if(!canvas)return;
    event.preventDefault();
    const [x,y]=pointerXY(event);
    zoomAt(zoom*Math.exp(-clamp(event.deltaY,-500,500)*.0015),x,y);
  },{passive:false});
  surface.addEventListener('pointerdown',event=>{
    if(!canvas||event.button!==0&&event.button!==1)return;
    event.preventDefault();
    surface.setPointerCapture(event.pointerId);
    drag={id:event.pointerId,x:event.clientX,y:event.clientY,
      moved:false,start:pointerXY(event)};
    surface.classList.add('pg-dragging');
  });
  surface.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.id)return;
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    if(Math.abs(dx)+Math.abs(dy)>0){
      if(Math.hypot(...pointerXY(event).map((n,i)=>n-drag.start[i]))>4)
        drag.moved=true;
      offsetX+=dx;offsetY+=dy;drag.x=event.clientX;drag.y=event.clientY;
      mode='custom';bounds();paintTransform();
    }
  });
  function endPointer(event){
    if(!drag||event.pointerId!==drag.id)return;
    const wasClick=!drag.moved&&event.type==='pointerup'&&event.button===0;
    const [x,y]=pointerXY(event);
    drag=null;
    surface.classList.remove('pg-dragging');
    if(surface.hasPointerCapture(event.pointerId))
      surface.releasePointerCapture(event.pointerId);
    if(wasClick&&asset?.atlas&&tile===null){
      const ix=(x-offsetX)/zoom,iy=(y-offsetY)/zoom;
      if(ix>=0&&iy>=0&&ix<canvas.width&&iy<canvas.height){
        const cx=Math.floor(ix/(canvas.width/asset.atlas.columns));
        const cy=Math.floor(iy/(canvas.height/asset.atlas.rows));
        selectTile(cy*asset.atlas.columns+cx);
      }
    }
  }
  surface.addEventListener('pointerup',endPointer);
  surface.addEventListener('pointercancel',endPointer);
  surface.addEventListener('lostpointercapture',event=>{
    if(drag?.id===event.pointerId){
      drag=null;surface.classList.remove('pg-dragging');
    }
  });
  surface.addEventListener('contextmenu',event=>event.preventDefault());
  return {render,setMode,zoomStep,setChannel,selectTile,setView,setProfile,state};
}
