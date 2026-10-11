// Application coordinator: catalog, seed controls, and preview UI.
// Mesh generation and Three.js rendering live in separate modules.
import {GENERATORS,findGenerator,generateAsset} from './generators.mjs';
import {createSeedState,parseSeed,updateComponentSeed,updateMasterSeed}
  from './seed-model.mjs';
import {createModelViewport} from './viewport-3d.mjs';

const byId=id=>document.getElementById(id);
const states=new Map(GENERATORS.map(def=>[def.id,createSeedState(def)]));
let active=findGenerator('oak');
let viewport;
const randomSeed=()=>crypto.getRandomValues(new Uint32Array(1))[0];
const seeds=()=>states.get(active.id);

function updatePreviewControls(state){
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
function build(state=seeds()){
  try{
    const started=performance.now();
    // Generate first, then replace the preview atomically.
    const asset=generateAsset(active,state.components);
    const stats=viewport.render(asset);
    states.set(active.id,state);
    byId('seedValue').value=String(state.masterSeed);
    byId('meshStats').textContent=stats.axes+' WOOD AXES · '+
      (stats.cards?stats.cards+' FOLIAGE CARDS · ':'')+
      stats.triangles.toLocaleString()+' TRIS';
    byId('cardPreview').hidden=true;
    byId('status').textContent='Geometry ready · '+
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
    viewport.focus('whole');
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
function renderGeneratorChoices(){
  const list=byId('generatorList');
  const select=byId('speciesSelect');
  list.replaceChildren();select.replaceChildren();
  for(const def of GENERATORS){
    const button=document.createElement('button');
    button.id=def.id+'Generator';
    button.className='pg-generator';
    button.type='button';
    button.setAttribute('aria-pressed','false');
    const symbol=document.createElement('span');
    symbol.className='pg-symbol';
    symbol.setAttribute('aria-hidden','true');
    symbol.textContent=def.symbol;
    const content=document.createElement('span');
    const title=document.createElement('strong');
    title.textContent=def.label;
    const subtitle=document.createElement('small');
    subtitle.textContent=def.subtitle;
    content.append(title,subtitle);
    button.append(symbol,content);
    button.addEventListener('click',()=>selectGenerator(def.id));
    list.append(button);
    const option=document.createElement('option');
    option.value=def.id;option.textContent=def.label;
    select.append(option);
  }
}
function selectGenerator(id){
  const def=findGenerator(id);
  if(!def)return;
  active=def;
  for(const item of GENERATORS){
    const button=byId(item.id+'Generator'),selected=item.id===id;
    button.setAttribute('aria-pressed',String(selected));
    if(selected)button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  }
  byId('speciesSelect').value=id;
  byId('assetOverline').textContent=def.overline;
  byId('assetTitle').textContent=def.title;
  byId('assetDescription').textContent=def.description;
  byId('viewport').setAttribute('aria-label',def.previewLabel);
  renderSeedControls();
  if(build())viewport.focus('whole');
}
renderGeneratorChoices();
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
    viewport.focus(action);
  });
byId('inspectCard').addEventListener('click',()=>{
  const source=viewport.inspectCard();
  if(!source)return;
  const canvas=byId('cardPreviewCanvas'),ctx=canvas.getContext('2d');
  if(!ctx)throw Error('2D card preview unavailable');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.imageSmoothingEnabled=true;
  ctx.imageSmoothingQuality='high';
  ctx.drawImage(source,0,0,256,256,0,0,canvas.width,canvas.height);
  byId('cardPreview').hidden=false;
});
byId('inspectClump').addEventListener('click',()=>viewport.inspectClump());
byId('foliageToggle').addEventListener('click',()=>viewport.toggleLeaves());
byId('silhouette').addEventListener('click',()=>viewport.toggleSilhouette());
byId('turntable').addEventListener('click',()=>viewport.toggleTurntable());
try{
  viewport=createModelViewport(byId('viewport'),updatePreviewControls);
  selectGenerator(active.id);
}catch(error){
  byId('error').hidden=false;
  byId('error').textContent=error.message;
  byId('status').textContent='Preview unavailable';
  console.error(error);
}
