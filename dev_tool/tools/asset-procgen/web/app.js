// Application coordinator: catalog, seed controls, and preview UI.
// Mesh generation and Three.js rendering live in separate modules.
import {GENERATORS,findGenerator,generateAsset} from './generators.mjs';
import {createSeedState,parseSeed,updateComponentSeed,updateMasterSeed}
  from './seed-model.mjs';
import {createModelViewport} from './viewport-3d.mjs';
import {createImageViewport} from './viewport-2d.mjs';
import {createAssetLibrary} from './asset-library.mjs';

const byId=id=>document.getElementById(id);
const embedded=new URLSearchParams(location.search).get('embedded')==='1';
document.getElementById('styleStudyLink')?.addEventListener('click',event=>{
  if(!embedded)return;
  event.preventDefault();
  window.parent.postMessage({type:'studio:open-style-study'},location.origin);
});
if(embedded)document.documentElement.classList.add('studio-embedded');
function studioSignal(message){
  if(embedded&&window.parent!==window)window.parent.postMessage(message,location.origin);
}
let projectId=null;
let recipeDirty=false;
function setRecipeDirty(dirty){
  recipeDirty=dirty;
  studioSignal({type:'studio:dirty',dirty});
}
function assetSaved(entry){
  setRecipeDirty(false);
  studioSignal({type:'studio:asset-saved',id:entry.source.id,name:entry.source.name});
}
window.addEventListener('beforeunload',event=>{
  if(recipeDirty)event.preventDefault();
});
document.addEventListener('keydown',event=>{
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){
    event.preventDefault();studioSignal({type:'studio:focus-search'});
  }
});
const states=new Map(GENERATORS.map(def=>[def.id,createSeedState(def)]));
const projectAssets=new Map();
const materialAssignments=new Map();
const selectedMaterials=()=>materialAssignments.get(active.id)??{};
function materialImages(){
  if(!active.materialSlots)return {};
  const assigned=selectedMaterials(),images={};
  for(const slot of active.materialSlots){
    const reference=assigned[slot.id];
    const asset=reference?projectAssets.get(reference.slice('asset:'.length)):null;
    if(reference&&!asset)throw Error('Missing shared material: '+reference);
    if(asset&&!asset.source.generator)
      throw Error('Imported images are not yet PBR material recipes: '+reference);
    const definition=asset?findGenerator(asset.source.generator.id):
      findGenerator(slot.generators[0]);
    if(!definition||definition.kind!=='image')continue;
    images[slot.id]=generateAsset(definition,
      asset?.source.generator.components??createSeedState(definition).components);
  }
  return images;
}
// Material controls are constructed from the active capability descriptor.
// A new compatible slot does not require editing HTML, the event binder,
// or a slot-name lookup in the project editor.
function mountMaterialControls(){
  const root=byId('materialSlots');
  root.replaceChildren();
  for(const slot of active.materialSlots??[]){
    const wrapper=document.createElement('div');
    wrapper.className='pg-roof-slot';
    const label=document.createElement('label');
    label.htmlFor=slot.id+'Asset';
    label.textContent=slot.label;
    const picker=document.createElement('select');
    picker.id=slot.id+'Asset';
    picker.addEventListener('change',event=>{
      const value=event.target.value;
      const next={...selectedMaterials()};
      if(value)next[slot.id]=value;
      else delete next[slot.id];
      materialAssignments.set(active.id,next);
      renderMaterialSelects();
      setRecipeDirty(true);
      build();
    });
    label.append(picker);
    const actions=document.createElement('div');
    actions.className='pg-roof-actions';
    for(const [action,suffix,title] of [
      ['new','New','New'],
      ['edit','Edit','Edit'],
      ['reseed','Reseed','Reseed shared'],
    ]){
      const button=document.createElement('button');
      button.type='button';
      button.id=slot.id+suffix;
      button.textContent=title;
      button.addEventListener('click',()=>
        projectOperation(()=>changeSharedMaterial(slot.id,action)));
      actions.append(button);
    }
    wrapper.append(label,actions);
    root.append(wrapper);
  }
}
function renderMaterialSelects(){
  if(!active.materialSlots)return;
  const current=selectedMaterials();
  for(const slot of active.materialSlots){
    const picker=byId(slot.id+'Asset');
    if(!picker)continue;
    picker.replaceChildren();
    const fallback=document.createElement('option');
    fallback.value='';fallback.textContent='Generator default (unsaved)';
    picker.append(fallback);
    for(const entry of projectAssets.values()){
      if(!entry.source.generator||
        !slot.generators.includes(entry.source.generator.id))continue;
      const choice=document.createElement('option');
      choice.value='asset:'+entry.source.id;
      choice.textContent=entry.source.name;
      picker.append(choice);
    }
    const value=current[slot.id]??'';
    if(value&&!projectAssets.has(value.slice('asset:'.length))){
      const missing=document.createElement('option');
      missing.value=value;missing.textContent='Missing: '+value;
      picker.append(missing);
    }
    picker.value=value;
    byId(slot.id+'Edit').disabled=!value||!projectAssets.has(value.slice('asset:'.length));
    byId(slot.id+'Reseed').disabled=!value||!projectAssets.has(value.slice('asset:'.length));
  }
}
const optionsByGenerator=new Map(GENERATORS.filter(def=>def.defaultOptions)
  .map(def=>[def.id,{...def.defaultOptions}]));
let currentBuildingView='exterior';
const isBuilding=()=>active.id==='timber-building';
const currentBuildingOptions=()=>optionsByGenerator.get(active.id);
function renderBuildingControls(){
  const show=isBuilding();
  byId('buildingSettings').hidden=!show;
  byId('buildingMaterials').hidden=!(active.materialSlots?.length);
  byId('buildingViewButtons').hidden=!show;
  byId('foot').hidden=show;
  byId('crown').hidden=show;
  byId('whole').textContent=show?'Fit building':'Whole tree';
  mountMaterialControls();
  if(active.materialSlots?.length)renderMaterialSelects();
  if(!show)return;
  const o=currentBuildingOptions();
  for(const [property,id] of [
    ['width','buildingWidth'],['depth','buildingDepth'],
    ['stories','buildingStories'],['roofPitch','buildingRoofPitch'],
    ['interior','buildingInteriorMode']])
    byId(id).value=String(o[property]);
  byId('buildingInterior').disabled=o.interior==='none';
  if(o.interior==='none')currentBuildingView='exterior';
  const view=currentBuildingView;
  byId('buildingExterior').setAttribute('aria-pressed',String(view==='exterior'));
  byId('buildingInterior').setAttribute('aria-pressed',String(view==='interior'));
}
function updateBuildingView(view){
  if(!isBuilding()||!modelViewport)return;
  if(view==='interior'&&currentBuildingOptions().interior==='none')return;
  currentBuildingView=view;
  modelViewport.setBuildingView(view);
  for(const [id,kind] of [['buildingExterior','exterior'],['buildingInterior','interior']])
    byId(id).setAttribute('aria-pressed',String(view===kind));
  modelViewport.focus('whole');
}

let loadedProjectAsset=null;
const initialGenerator=new URLSearchParams(location.search).get('generator');
let active=findGenerator(initialGenerator)||findGenerator('oak');
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
  byId('stageContent').textContent=state.assetId==='timber-building'?
    (state.buildingView==='interior'?'EMPTY ARCHITECTURAL INTERIOR':'TOWNHOUSE EXTERIOR'):
    state.inspectMode==='card'?
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
    const asset=generateAsset(active,state.components,
      active.defaultOptions?currentBuildingOptions():undefined,
      isBuilding()?Number(byId('buildingLevel').value):1);
    let stats;
    if(asset.kind==='model'){
      if(!modelViewport)
        modelViewport=createModelViewport(byId('viewport'),updatePreviewControls);
      stats=modelViewport.render(asset,asset.building?materialImages():undefined);
      if(asset.building){
        if(currentBuildingView==='interior'&&asset.building.interior)
          modelViewport.setBuildingView('interior');
        byId('meshStats').textContent=stats.label;
        byId('buildingOpeningInfo').textContent=
          asset.building.plan.width+' × '+asset.building.plan.depth+' m · '+
          asset.building.plan.stories+' storey(s) · '+
          asset.building.plan.windows.length+' exterior windows · '+
          (asset.building.interior?'shell shares the ground-floor openings':'no interior');
      }else{
        byId('meshStats').textContent=stats.axes+' WOOD AXES · '+
          (stats.cards?stats.cards+' FOLIAGE CARDS · ':'')+
          stats.triangles.toLocaleString()+' TRIS';
      }
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
  setRecipeDirty(true);
  // A fresh seed replaces the model, not the user's camera view.
  build(next);
  renderSeedControls();
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
  renderBuildingControls();
  byId('imageStage').hidden=def.kind!=='image';
  byId('stageKind').textContent=def.kind==='model'?'3D MODEL':'2D ASSET';
  byId('viewportHint').textContent=def.kind==='model'?
    'DRAG TO ORBIT · SCROLL TO ZOOM · RIGHT-DRAG TO PAN':
    'WHEEL ZOOM · DRAG PAN · CLICK A TILE · ALPHA CHANNEL';
  renderSeedControls();
  if(build()&&def.kind==='model')modelViewport.focus('whole');
  if(loadedProjectAsset&&loadedProjectAsset.source.generator.id!==id)setRecipeDirty(true);
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
for(const [id,view] of [['buildingExterior','exterior'],
  ['buildingInterior','interior']])
  byId(id).addEventListener('click',()=>updateBuildingView(view));
byId('buildingLevel').addEventListener('change',()=>{
  if(isBuilding()&&build())modelViewport.focus('whole');
});
for(const [id,key] of [
  ['buildingWidth','width'],['buildingDepth','depth'],
  ['buildingStories','stories'],['buildingRoofPitch','roofPitch'],
  ['buildingInteriorMode','interior']]){
  byId(id).addEventListener('change',()=>{
    if(!isBuilding())return;
    const previous=currentBuildingOptions();
    const raw=byId(id).value;
    const next={...previous,[key]:key==='interior'?raw:Number(raw)};
    try{
      const validated=active.validateOptions(next);
      optionsByGenerator.set(active.id,validated);
      renderBuildingControls();
      setRecipeDirty(true);
      if(build())modelViewport.focus('whole');
    }catch(error){
      byId(id).value=String(previous[key]);
      byId('status').textContent=error.message;
    }
  });
}
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
  // Saved sources initialize with their persisted recipe below, rather than
  // wasting time generating an unrelated default model first.
  if(!new URLSearchParams(location.search).has('asset'))
    selectGenerator(active.id);
}catch(error){
  byId('error').hidden=false;
  byId('error').textContent=error.message;
  byId('status').textContent='Preview unavailable';
  console.error(error);
}

// Project asset sources are named, persistent recipes. The generator registry
// is independent: loading a recipe simply restores its seeds.
const projectEl=id=>document.getElementById(id);
function assetStatus(message){projectEl('projectAssetStatus').textContent=message;}
async function projectApi(path,options){
  if(options&&['POST','PUT'].includes(options.method)){
    if(!projectId)throw Error('No active project');
    options={...options,headers:{...options.headers,'X-Project-Id':projectId}};
  }
  const response=await fetch(path,{cache:'no-store',...options});
  const result=await response.json();
  if(!response.ok)throw Error(result.error||'HTTP '+response.status);
  return result;
}
async function reloadProjectAssets(){
  const {assets}=await projectApi('/api/projects/active/assets');
  projectAssets.clear();
  const selector=projectEl('savedProjectAssets');
  const previous=loadedProjectAsset?.source.id??selector.value;
  selector.replaceChildren();
  const fresh=document.createElement('option');
  fresh.value='';fresh.textContent='Choose a saved asset';selector.append(fresh);
  for(const entry of assets){
    projectAssets.set(entry.source.id,entry);
    const option=document.createElement('option');
    option.value=entry.source.id;
    option.textContent=entry.source.name+' · '+
      (entry.source.generator?.id??'imported '+entry.kind);
    selector.append(option);
  }
  selector.value=projectAssets.has(previous)?previous:'';
  if(loadedProjectAsset&&!projectAssets.has(loadedProjectAsset.source.id))
    loadedProjectAsset=null;
  renderMaterialSelects();
  assetStatus(assets.length+' saved project assets');
}
async function projectOperation(action){
  try{await action();}catch(error){assetStatus(error instanceof Error?error.message:String(error));}
}
function currentRecipe(){
  const state=seeds();
  return {name:projectEl('projectAssetName').value.trim(),generator:active.id,
    masterSeed:state.masterSeed,components:state.components,
    ...(active.defaultOptions?{options:currentBuildingOptions()}:{}),
    ...(active.materialSlots?{materials:{...selectedMaterials()}}:{})};
}
async function loadSelectedProjectAsset(){
  const id=projectEl('savedProjectAssets').value;
  if(!id)throw Error('Select an asset to load');
  const entry=projectAssets.get(id);
  if(!entry)throw Error('Asset is no longer in this project');
  if(!entry.source.generator)
    throw Error('Imported assets have no procedural editor yet');
  const gen=findGenerator(entry.source.generator.id);
  if(!gen)throw Error('Generator is unavailable');
  states.set(gen.id,{masterSeed:entry.source.generator.masterSeed,
    components:{...entry.source.generator.components}});
  if(gen.defaultOptions)
    optionsByGenerator.set(gen.id,gen.validateOptions(
      entry.source.options??gen.defaultOptions));
  if(gen.materialSlots)
    materialAssignments.set(gen.id,{...entry.source.materials});
  currentBuildingView='exterior';
  byId('buildingLevel').value='1';
  loadedProjectAsset=entry;
  projectEl('projectAssetName').value=entry.source.name;
  projectEl('projectAssetId').value=id;
  selectGenerator(gen.id);
  setRecipeDirty(false);
  assetStatus('Loaded '+entry.source.name);
}

// Model material slots are shared project-source references, not embedded textures.
// A material editor can be opened from the model; reseeding updates the shared
// source (with revision checking), so every referencing model sees the change.
async function changeSharedMaterial(slot,action){
  if(!projectId)throw Error('Create or open a project first');
  const value=selectedMaterials()[slot];
  const entry=value?projectAssets.get(value.slice('asset:'.length)):null;
  const binding=active.materialSlots?.find(item=>item.id===slot);
  if(!binding)throw Error('Unknown material slot: '+slot);
  // Editing/reseeding always uses the actual stored resource generator.
  // Creating uses the declared compatible default. No slot-name switch.
  const generatorId=entry?.source.generator?.id??binding.generators[0];
  if(!binding.generators.includes(generatorId))
    throw Error('Incompatible material generator for '+slot);
  const definition=findGenerator(generatorId);
  if(!definition||definition.kind!=='image')
    throw Error('Material generator unavailable');
  if(action==='new'){
    const id=definition.id+'-'+randomSeed().toString(36);
    const name=definition.label+' · ';
    const state=updateMasterSeed(definition,createSeedState(definition),randomSeed());
    const created=await projectApi('/api/projects/active/assets',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({id,name:name+id, generator:definition.id,
        masterSeed:state.masterSeed,components:state.components}),
    });
    materialAssignments.set(active.id,{...selectedMaterials(),
      [slot]:'asset:'+created.source.id});
    setRecipeDirty(true);
    await reloadProjectAssets();
    build();
    studioSignal({type:'studio:project-assets-changed'});
    assetStatus('Created '+created.source.name+' · Save this building to keep the link.');
    return;
  }
  if(!entry)throw Error('Select a saved texture first');
  if(action==='edit'){
    if(embedded){
      studioSignal({type:'studio:open-asset',id:entry.source.id});
    }else{
      // The standalone editor has no Studio parent to open a document tab.
      location.assign('/tools/asset-procgen/?asset='+
        encodeURIComponent(entry.source.id)+'&generator='+
        encodeURIComponent(definition.id));
    }
    return;
  }
  if(action==='reseed'){
    const state=updateMasterSeed(definition,{
      masterSeed:entry.source.generator.masterSeed,
      components:{...entry.source.generator.components},
    },randomSeed());
    const updated=await projectApi('/api/projects/active/assets/'+entry.source.id,{
      method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({revision:entry.revision,name:entry.source.name,
        generator:definition.id,masterSeed:state.masterSeed,
        components:state.components}),
    });
    projectAssets.set(updated.source.id,updated);
    await reloadProjectAssets();
    build();
    studioSignal({type:'studio:project-assets-changed'});
    assetStatus('Reseeded shared texture '+updated.source.name+'. All linked models use its new seed.');
  }
}
window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==window.parent||
    event.data?.type!=='studio:project-assets-changed'||
    event.data.projectId!==projectId)return;
  projectOperation(async()=>{
    await reloadProjectAssets();
    const id=loadedProjectAsset?.source.id;
    const latest=id?projectAssets.get(id):null;
    if(latest&&!recipeDirty&&latest.revision!==loadedProjectAsset.revision){
      // Clean document: pull the changed shared source into the editor.
      // Dirty documents retain their local work and optimistic revision;
      // a later save will surface a conflict instead of overwriting it.
      projectEl('savedProjectAssets').value=id;
      await loadSelectedProjectAsset();
    }else if(isBuilding())build();
  });
});

projectEl('buildProjectAsset').addEventListener('click',()=>
  projectOperation(async()=>{
    const id=projectEl('savedProjectAssets').value;
    if(!id||!projectAssets.has(id))
      throw Error('Select a saved resource to bake');
    const entry=projectAssets.get(id);
    const definition=entry.source.generator?
      findGenerator(entry.source.generator.id):null;
    if(entry.source.generator&&!definition?.headlessBake&&
      !definition?.headlessCanvasBake&&!definition?.modelBake)
      throw Error('This generator does not have a headless build adapter yet');
    assetStatus('Baking '+entry.source.name+'…');
    const result=await projectApi('/api/projects/active/builds/'+
      encodeURIComponent(id),{method:'POST'});
    const artifact=result.artifacts.at(-1);
    assetStatus('Build complete · '+result.built+' generated · '+
      result.reused+' cached · build/assets/'+id+'/'+artifact.key);
  }));
projectEl('exportGodotPackage').addEventListener('click',()=>
  projectOperation(async()=>{
    const id=projectEl('savedProjectAssets').value;
    if(!id||!projectAssets.has(id))
      throw Error('Select a saved resource to export');
    assetStatus('Publishing Godot package…');
    const result=await projectApi('/api/projects/active/exports/godot/'+
      encodeURIComponent(id),{method:'POST'});
    assetStatus((result.published?'Godot package ready':'Godot package unchanged')+
      ' · '+result.manifest.files.length+' files · '+result.directory);
  }));
projectEl('syncGodotProject').addEventListener('click',()=>
  projectOperation(async()=>{
    const id=projectEl('savedProjectAssets').value;
    const target=projectEl('godotProjectPath').value.trim();
    if(!id||!projectAssets.has(id))
      throw Error('Select a saved resource to synchronize');
    if(!target)throw Error('Enter the absolute Godot project folder');
    assetStatus('Synchronizing to Godot project…');
    const result=await projectApi('/api/projects/active/sync/godot/'+
      encodeURIComponent(id),{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({target}),
    });
    if(projectId)localStorage.setItem('godot-sync-target:'+projectId,target);
    assetStatus((result.synced?'Synchronized':'Already up to date')+
      ' · '+result.files+' files · '+result.resourcePath);
  }));
projectEl('loadProjectAsset').addEventListener('click',
  ()=>projectOperation(loadSelectedProjectAsset));
projectEl('saveProjectAsset').addEventListener('click',()=>projectOperation(async()=>{
  const id=projectEl('projectAssetId').value.trim();
  if(!id)throw Error('Enter a stable asset ID');
  const entry=await projectApi('/api/projects/active/assets',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id,...currentRecipe()}),
  });
  loadedProjectAsset=entry;
  await reloadProjectAssets();
  assetSaved(entry);
  assetStatus('Saved '+entry.source.name+' as asset:'+id);
}));
projectEl('updateProjectAsset').addEventListener('click',()=>projectOperation(async()=>{
  if(!loadedProjectAsset)throw Error('Load an existing asset before updating it');
  const id=loadedProjectAsset.source.id;
  if(projectEl('savedProjectAssets').value!==id)
    throw Error('Load the selected asset before updating it');
  if(projectEl('projectAssetId').value!==id)
    throw Error('Asset ID is immutable; use Save as new asset for a new ID');
  const entry=await projectApi('/api/projects/active/assets/'+id,{
    method:'PUT',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({revision:loadedProjectAsset.revision,...currentRecipe()}),
  });
  loadedProjectAsset=entry;
  await reloadProjectAssets();
  assetSaved(entry);
  assetStatus('Updated '+entry.source.name);
}));
projectEl('projectAssetName').addEventListener('input',()=>{
  setRecipeDirty(true);
  if(!loadedProjectAsset){
    projectEl('projectAssetId').value=projectEl('projectAssetName').value
      .toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
      .replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,48);
  }
});
projectEl('importProjectAsset').addEventListener('click',()=>
  projectOperation(async()=>{
    const file=projectEl('importProjectFile').files?.[0];
    if(!file)throw Error('Select a GLB model or PNG image to import');
    const ext=file.name.toLowerCase().split('.').pop();
    if(ext!=='glb'&&ext!=='png')throw Error('Only .glb and .png imports are supported');
    if(file.size>32*1024*1024)throw Error('Import exceeds 32 MiB');
    const stem=file.name.slice(0,-ext.length-1);
    // Import is a separate operation; never reuse the ID or name of
    // the procedural recipe that happens to be open in this editor.
    const name=stem;
    const slug=stem.toLowerCase().normalize('NFKD')
      .replace(/[\u0300-\u036f]/g,'')
      .replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'')
      .slice(0,32)||'imported';
    const id=slug+'-'+randomSeed().toString(36);
    const entry=await projectApi('/api/projects/active/imports/'+
      encodeURIComponent(id)+'?name='+encodeURIComponent(name),{
      method:'POST',headers:{'Content-Type':ext==='glb'?
        'model/gltf-binary':'image/png'},
      body:await file.arrayBuffer(),
    });
    await reloadProjectAssets();
    projectEl('savedProjectAssets').value=entry.source.id;
    assetStatus('Imported '+entry.source.name+
      '. The file is saved in the project; procedural editing is unavailable.');
    studioSignal({type:'studio:project-assets-changed'});
  }));
projectEl('savedProjectAssets').addEventListener('change',()=>{
  const id=projectEl('savedProjectAssets').value;
  assetStatus(id?'Load selected to edit its source':'Select a saved asset');
});
(async()=>{
  try{
    const {project}=await projectApi('/api/projects/active');
    if(!project){assetStatus('Create a project on the home page to save assets.');return;}
    projectId=project.id;
    projectEl('godotProjectPath').value=
      localStorage.getItem('godot-sync-target:'+projectId)??'';
    await reloadProjectAssets();
    const requested=new URLSearchParams(location.search).get('asset');
    if(requested&&projectAssets.has(requested)){
      projectEl('savedProjectAssets').value=requested;
      await loadSelectedProjectAsset();
    }else{
      const generator=new URLSearchParams(location.search).get('generator');
      if(generator&&findGenerator(generator))selectGenerator(generator);
    }
  }catch(error){
    // Standalone editing remains usable even if project data are unavailable.
    if(!modelViewport&&!imageViewport)selectGenerator(active.id);
    assetStatus('Project source unavailable: '+(error instanceof Error?error.message:String(error)));
  }finally{
    // Only reveal the iframe after the requested recipe has actually loaded.
    studioSignal({type:'studio:ready'});
  }
})();
