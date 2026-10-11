// Application coordinator: catalog, seed controls, and preview UI.
// Mesh generation and Three.js rendering live in separate modules.
import {GENERATORS,findGenerator,generateAsset} from './generators.mjs';
import {createSeedState,parseSeed,updateComponentSeed,updateMasterSeed}
  from './seed-model.mjs';
import {createModelViewport} from './viewport-3d.mjs';
import {createImageViewport} from './viewport-2d.mjs';
import {createAssetLibrary} from './asset-library.mjs';

const byId=id=>document.getElementById(id);
const states=new Map(GENERATORS.map(def=>[def.id,createSeedState(def)]));
let active=findGenerator('oak');
let modelViewport,imageViewport;
let library;
const randomSeed=()=>crypto.getRandomValues(new Uint32Array(1))[0];
const seeds=()=>states.get(active.id);

function updatePreviewControls(state){
  if(active.kind!=='model')return;
  const oak=state.assetId==='oak';
  const leaves=byId('foliageToggle');
  leaves.hidden=!oak;
  leaves.textContent=state.foliageVisible?'Hide leaves':'Show leaves';
  leaves.setAttribute('aria-pressed',String(oak&&state.foliageVisible));
  for(const id of ['inspectCard','inspectClump'])
    byId(id).hidden=!oak;
  byId('stageContent').textContent=state.inspectMode==='card'?
    'LEAF CARD / ATLAS':state.inspectMode==='clump'?
    'ONE FOLIAGE CLUMP':oak&&state.foliageVisible?
    'WOOD + FOLIAGE':'WOOD ONLY';
  byId('turntable').setAttribute('aria-pressed',String(state.spinning));
  byId('silhouette').setAttribute('aria-pressed',String(state.silhouette));
  if(state.inspectMode!=='card')byId('cardPreview').hidden=true;
}
function updateImageControls(state){
  if(active.kind!=='image')return;
  byId('imageFit').setAttribute('aria-pressed',String(state.mode==='fit'));
  byId('imageActual').setAttribute('aria-pressed',String(state.mode==='actual'));
  byId('imageZoomLabel').textContent=Math.round(state.scale*100)+'%';
  for(const [channel,id] of [['rgba','imageRGBA'],
    ['rgb','imageRGB'],['alpha','imageAlpha']])
    byId(id).setAttribute('aria-pressed',String(state.channel===channel));
  byId('imageTile').value=state.tile===null?'all':String(state.tile);
  byId('imageMap').value=state.view??'';
  byId('imageProfile').value=state.profile??'';
  byId('stageContent').textContent=(state.tile===null?
    'FULL IMAGE':'TILE '+(state.tile+1)+' / '+state.tiles)+
    ' · '+state.channel.toUpperCase();
}
function updateImageProfiles(asset){
  const picker=byId('imageProfile');
  picker.replaceChildren();
  for(const profile of asset.profiles??[]){
    const option=document.createElement('option');
    option.value=profile;option.textContent=profile.toUpperCase();
    picker.append(option);
  }
  byId('imageProfileRow').hidden=!(asset.profiles?.length);
  picker.value=imageViewport.state().profile??'';
}
function updateImageViews(asset){
  const select=byId('imageMap');
  select.replaceChildren();
  for(const view of asset.views??[]){
    const option=document.createElement('option');
    option.value=view;option.textContent=view.toUpperCase();
    select.append(option);
  }
  byId('imageMapRow').hidden=!(asset.views?.length);
  select.value=imageViewport.state().view??'';
}
function updateImageTiles(asset){
  const picker=byId('imageTile');
  picker.replaceChildren();
  const full=document.createElement('option');
  full.value='all';
  full.textContent=asset.atlas?'All tiles':'Full image';
  picker.append(full);
  if(asset.atlas)
    for(let i=0;i<asset.tiles;i++){
      const item=document.createElement('option');
      item.value=String(i);
      item.textContent='Tile '+(i+1);
      picker.append(item);
    }
  picker.disabled=!asset.atlas;
  picker.value=imageViewport.state().tile===null?
    'all':String(imageViewport.state().tile);
}
function build(state=seeds()){
  try{
    const started=performance.now();
    // Generate first, then replace the preview atomically.
    const asset=generateAsset(active,state.components);
    let stats;
    if(asset.kind==='model'){
      if(!modelViewport)
        modelViewport=createModelViewport(byId('viewport'),updatePreviewControls);
      stats=modelViewport.render(asset);
      byId('meshStats').textContent=stats.axes+' WOOD AXES · '+
        (stats.cards?stats.cards+' FOLIAGE CARDS · ':'')+
        stats.triangles.toLocaleString()+' TRIS';
    }else if(asset.kind==='image'){
      if(!imageViewport)
        imageViewport=createImageViewport(byId('imageViewport'),updateImageControls);
      stats=imageViewport.render(asset);
      updateImageTiles(asset);
      updateImageViews(asset);
      updateImageProfiles(asset);
      updateImageControls(imageViewport.state());
      byId('meshStats').textContent=stats.width+' × '+stats.height+
        ' PX · '+stats.channels+(stats.tiles?' · '+stats.tiles+' TILES':'');
    }else throw Error('Unknown asset kind');
    states.set(active.id,state);
    byId('seedValue').value=String(state.masterSeed);
    byId('cardPreview').hidden=true;
    byId('status').textContent='Asset ready · '+
      Math.round(performance.now()-started)+' ms';
    byId('error').hidden=true;
    return true;
  }catch(error){
    byId('status').textContent='Generation failed';
    byId('error').hidden=false;
    byId('error').textContent=error.message;
    console.error(error);
    return false;
  }
}
function applySeeds(next){
  if(build(next)){
    renderSeedControls();
    if(active.kind==='model')modelViewport.focus('whole');
  }else{
    renderSeedControls();
  }
}
function updateSeedInput(input,onValid,current){
  try{
    const seed=parseSeed(input.value);
    onValid(seed);
  }catch(error){
    byId('status').textContent=error.message;
    input.value=String(current);
  }
}
function renderSeedControls(){
  const state=seeds();
  byId('seedValue').value=String(state.masterSeed);
  const list=byId('componentSeeds');
  list.replaceChildren();
  for(const component of active.components){
    const row=document.createElement('div');
    row.className='pg-component-seed';
    const label=document.createElement('label');
    const id='seed-'+component.id;
    label.htmlFor=id;
    label.textContent=component.label;
    const input=document.createElement('input');
    input.id=id;input.type='number';
    input.min='0';input.max='4294967295';input.step='1';
    input.value=String(state.components[component.id]);
    input.setAttribute('aria-label',component.label+' seed');
    input.addEventListener('change',()=>updateSeedInput(input,seed=>{
      applySeeds(updateComponentSeed(active,seeds(),component.id,seed));
    },seeds().components[component.id]));
    const shuffle=document.createElement('button');
    shuffle.type='button';shuffle.className='pg-seed-shuffle';
    shuffle.textContent='↻';
    shuffle.title='Reseed '+component.label;
    shuffle.setAttribute('aria-label','Reseed '+component.label);
    shuffle.addEventListener('click',()=>applySeeds(
      updateComponentSeed(active,seeds(),component.id,randomSeed())));
    row.append(label,input,shuffle);
    list.append(row);
  }
}
function renderMobileChoices(){
  const select=byId('speciesSelect');
  select.replaceChildren();
  const groups=new Map();
  for(const def of GENERATORS){
    const name=def.libraryPath.join(' / ');
    let group=groups.get(name);
    if(!group){
      group=document.createElement('optgroup');
      group.label=name;
      groups.set(name,group);
      select.append(group);
    }
    const option=document.createElement('option');
    option.value=def.id;
    option.textContent=def.navLabel+' · '+def.navType;
    group.append(option);
  }
}
function selectGenerator(id){
  const def=findGenerator(id);
  if(!def)return;
  active=def;
  library?.select(id);
  byId('speciesSelect').value=id;
  byId('assetOverline').textContent=def.overline;
  byId('assetTitle').textContent=def.title;
  byId('assetDescription').textContent=def.description;
  byId(def.kind==='model'?'viewport':'imageViewport')
    .setAttribute('aria-label',def.previewLabel);
  byId('modelStage').hidden=def.kind!=='model';
  byId('imageStage').hidden=def.kind!=='image';
  byId('stageKind').textContent=def.kind==='model'?'3D MODEL':'2D ASSET';
  byId('viewportHint').textContent=def.kind==='model'?
    'DRAG TO ORBIT · SCROLL TO ZOOM · RIGHT-DRAG TO PAN':
    'WHEEL ZOOM · DRAG PAN · CLICK A TILE · ALPHA CHANNEL';
  renderSeedControls();
  if(build()&&def.kind==='model')modelViewport.focus('whole');
}
renderMobileChoices();
library=createAssetLibrary({
  definitions:GENERATORS,
  list:byId('generatorList'),
  search:byId('assetSearch'),
  filters:byId('assetFilters'),
  count:byId('libraryCount'),
  onSelect:selectGenerator,
});
byId('speciesSelect').addEventListener('change',
  e=>selectGenerator(e.target.value));
byId('seedValue').addEventListener('change',()=>{
  const input=byId('seedValue');
  updateSeedInput(input,value=>applySeeds(
    updateMasterSeed(active,seeds(),value)),seeds().masterSeed);
});
byId('reseed').addEventListener('click',()=>applySeeds(
  updateMasterSeed(active,seeds(),randomSeed())));
for(const action of ['whole','foot','crown'])
  byId(action).addEventListener('click',()=>{
    if(active.kind==='model')modelViewport.focus(action);
  });
byId('inspectCard').addEventListener('click',()=>{
  if(active.kind!=='model')return;
  const source=modelViewport.inspectCard();
  if(!source)return;
  const canvas=byId('cardPreviewCanvas'),ctx=canvas.getContext('2d');
  if(!ctx)throw Error('2D card preview unavailable');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.imageSmoothingEnabled=true;
  ctx.imageSmoothingQuality='high';
  ctx.drawImage(source,0,0,256,256,0,0,canvas.width,canvas.height);
  byId('cardPreview').hidden=false;
});
byId('inspectClump').addEventListener('click',()=>{
  if(active.kind==='model')modelViewport.inspectClump();
});
byId('foliageToggle').addEventListener('click',()=>{
  if(active.kind==='model')modelViewport.toggleLeaves();
});
byId('silhouette').addEventListener('click',()=>{
  if(active.kind==='model')modelViewport.toggleSilhouette();
});
byId('turntable').addEventListener('click',()=>{
  if(active.kind==='model')modelViewport.toggleTurntable();
});
byId('imageFit').addEventListener('click',()=>{
  if(active.kind==='image')imageViewport.setMode('fit');
});
byId('imageActual').addEventListener('click',()=>{
  if(active.kind==='image')imageViewport.setMode('actual');
});
byId('imageZoomOut').addEventListener('click',()=>{
  if(active.kind==='image')imageViewport.zoomStep(-1);
});
byId('imageZoomIn').addEventListener('click',()=>{
  if(active.kind==='image')imageViewport.zoomStep(1);
});
for(const [name,channel] of [['imageRGBA','rgba'],
  ['imageRGB','rgb'],['imageAlpha','alpha']])
  byId(name).addEventListener('click',()=>{
    if(active.kind==='image')imageViewport.setChannel(channel);
  });
byId('imageProfile').addEventListener('change',event=>{
  if(active.kind==='image')imageViewport.setProfile(event.target.value);
});
byId('imageMap').addEventListener('change',event=>{
  if(active.kind==='image')imageViewport.setView(event.target.value);
});
byId('imageTile').addEventListener('change',event=>{
  if(active.kind==='image'){
    const value=event.target.value;
    imageViewport.selectTile(value==='all'?null:Number(value));
  }
});
try{
  selectGenerator(active.id);
}catch(error){
  byId('error').hidden=false;
  byId('error').textContent=error.message;
  byId('status').textContent='Preview unavailable';
  console.error(error);
}
