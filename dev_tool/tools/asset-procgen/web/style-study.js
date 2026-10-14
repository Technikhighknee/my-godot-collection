import {findGenerator,generateAsset} from './generators.mjs';
import {STUDY_STYLES,STUDY_MATERIALS,applyTextureStudyStyle,
  studySeeds,reseedStudySeeds} from './texture-style-study.mjs';
import {drawTextureStudyExport,textureStudyExportFilename}
  from './texture-study-export.mjs';

const byId=id=>document.getElementById(id);
const embedded=new URLSearchParams(location.search).get('embedded')==='1';
if(embedded)document.documentElement.classList.add('studio-embedded');
function studioSignal(message){
  if(embedded&&window.parent!==window)
    window.parent.postMessage(message,location.origin);
}
const board=byId('studyBoard'),status=byId('studyStatus');
const filters=byId('studyStyleFilters');
const controls={
  channel:byId('studyChannel'),profile:byId('studyTimberProfile'),
  tiling:byId('studyTiling'),seed:byId('studySeed'),
};
const sources=new Map(),cells=new Map(),filterInputs=new Map();
const selectedStyles=new Set(STUDY_STYLES.map(style=>style.id));
let masterSeed=null,activeRender=0,renderReady=false,exporting=false;
const exportButton=byId('studyExportPNG');
function updateExportButton(){
  exportButton.disabled=!renderReady||exporting;
  exportButton.textContent=exporting?'Preparing PNG…':'Export PNG ↓';
}
const PREVIEW_SIZE=256;

// The original is always present as a stable visual reference. Alternatives
// are individually switchable without affecting seeds or generator output.
function visibleStyles(){
  return STUDY_STYLES.filter(style=>selectedStyles.has(style.id));
}
for(const style of STUDY_STYLES){
  const label=document.createElement('label');
  label.className='study-style-filter';
  const input=document.createElement('input');
  input.type='checkbox';input.checked=true;
  input.disabled=style.id==='current';
  input.setAttribute('aria-label','Show '+style.label);
  const span=document.createElement('span');span.textContent=style.label;
  label.append(input,span);filters.append(label);
  filterInputs.set(style.id,input);
  if(style.id!=='current')input.addEventListener('change',()=>{
    if(input.checked)selectedStyles.add(style.id);
    else selectedStyles.delete(style.id);
    buildBoard();
    void render();
  });
}
for(const material of STUDY_MATERIALS){
  const definition=findGenerator(material.id);
  if(!definition||definition.kind!=='image')
    throw Error('Material generator unavailable: '+material.id);
  sources.set(material.id,{...material,definition});
}
function createMaterialName(material){
  const label=document.createElement('div');label.className='study-name';
  const group=document.createElement('small');group.textContent=material.group;
  const title=document.createElement('strong');title.textContent=material.label;
  const link=document.createElement('a');
  link.href='/studio.html?generator='+encodeURIComponent(material.id);
  if(embedded)link.addEventListener('click',event=>{
    event.preventDefault();
    studioSignal({type:'studio:open-generator',id:material.id});
  });
  link.textContent='Open generator ↗';
  label.append(group,title,link);
  return label;
}
function buildBoard(){
  const styles=visibleStyles();
  board.replaceChildren();cells.clear();
  board.style.setProperty('--study-cols',String(styles.length));
  board.style.minWidth=(150+styles.length*248)+'px';
  const heading=document.createElement('div');
  heading.className='study-head study-head-name';
  heading.textContent='MATERIAL';
  board.append(heading);
  for(const style of styles){
    const head=document.createElement('div');
    head.className='study-head'+(style.id==='current'?'':' study-head-accent');
    const title=document.createElement('strong');title.textContent=style.label;
    const description=document.createElement('small');
    description.textContent=style.description;
    head.append(title,description);board.append(head);
  }
  for(const material of sources.values()){
    board.append(createMaterialName(material));
    for(const style of styles){
      const shell=document.createElement('div');
      shell.className='study-preview';
      shell.setAttribute('data-style',style.id);
      const canvas=document.createElement('canvas');
      canvas.width=canvas.height=384;
      canvas.setAttribute('aria-label',material.label+' — '+style.label);
      const info=document.createElement('span');info.className='study-image-info';
      info.textContent='Preparing…';
      shell.append(canvas,info);board.append(shell);
      cells.set(material.id+'/'+style.id,{canvas,info});
    }
  }
}
// Cache source maps (full resolution), cropped inspector images (256 px),
// and the art-direction passes separately. Toggling columns and tiling never
// regenerates the source and cannot accidentally reseed another column.
const sourceCache=new Map(),previewCache=new Map(),styleCache=new Map();
function nativeStyle(material,styleId){
  return !!material.definition.studyGeneration?.styles.includes(styleId);
}
function cacheKey(material,view,profile,styleId='current'){
  return [material.id,masterSeed??'default',view,profile??'',
    nativeStyle(material,styleId)?styleId:'current'].join(':');
}
function getImage(material,view,profile,styleId='current'){
  const key=cacheKey(material,view,profile,styleId);
  if(sourceCache.has(key))return sourceCache.get(key);
  const seeds=masterSeed===null?studySeeds(material.definition):
    reseedStudySeeds(material.definition,masterSeed);
  // Material-specific native grammars are advertised by each generator.
  // Unsupported styles continue to use explicit preview-only treatments.
  const asset=nativeStyle(material,styleId)?
    material.definition.studyGeneration.generate(seeds,styleId):
    generateAsset(material.definition,seeds);
  const canvas=document.createElement('canvas');
  asset.paint(canvas,view,profile??undefined);
  const context=canvas.getContext('2d',{willReadFrequently:true});
  if(!context)throw Error('Canvas 2D context unavailable');
  const width=canvas.width,height=canvas.height;
  if(width<1||height<1||width>4096||height>4096)
    throw Error('Invalid material dimensions: '+material.id);
  const image={data:context.getImageData(0,0,width,height).data,
    width,height};
  sourceCache.set(key,image);
  return image;
}
function getPreview(material,view,profile,styleId='current'){
  const key=cacheKey(material,view,profile,styleId);
  if(previewCache.has(key))return previewCache.get(key);
  const original=getImage(material,view,profile,styleId);
  const input=document.createElement('canvas');
  input.width=original.width;input.height=original.height;
  const ctx=input.getContext('2d');
  if(!ctx)throw Error('Canvas 2D context unavailable');
  const image=ctx.createImageData(original.width,original.height);
  image.data.set(original.data);ctx.putImageData(image,0,0);
  const cropped=document.createElement('canvas');
  cropped.width=cropped.height=PREVIEW_SIZE;
  const previewCtx=cropped.getContext('2d',{willReadFrequently:true});
  if(!previewCtx)throw Error('Canvas 2D context unavailable');
  // Keep genuinely pixel-authored retro texels sharp in the downsample.
  previewCtx.imageSmoothingEnabled=styleId!=='retro-3d-study';
  previewCtx.imageSmoothingQuality='high';
  // Long timber strips: compare a full-size central square, never stretch
  // 512×2048 into a visually misleading square.
  const square=Math.min(original.width,original.height);
  previewCtx.drawImage(input,Math.floor((original.width-square)/2),
    Math.floor((original.height-square)/2),square,square,
    0,0,PREVIEW_SIZE,PREVIEW_SIZE);
  const result={data:previewCtx.getImageData(0,0,PREVIEW_SIZE,PREVIEW_SIZE).data,
    width:PREVIEW_SIZE,height:PREVIEW_SIZE,
    originalWidth:original.width,originalHeight:original.height};
  previewCache.set(key,result);
  return result;
}
function styledImage(material,style,view,profile,preview){
  if(style.id==='current'||nativeStyle(material,style.id))return preview.data;
  const key=cacheKey(material,view,profile)+':'+style.id;
  if(styleCache.has(key))return styleCache.get(key);
  const image=applyTextureStudyStyle(material.id,style.id,view,
    preview.data,{width:preview.width,height:preview.height,
      seed:masterSeed===null?material.definition.initialMasterSeed:masterSeed});
  styleCache.set(key,image);
  return image;
}
function paintPreview(cell,material,style,preview,pixels,profile){
  const scratch=document.createElement('canvas');
  scratch.width=preview.width;scratch.height=preview.height;
  const ctx=scratch.getContext('2d');
  if(!ctx)throw Error('Canvas 2D context unavailable');
  const image=ctx.createImageData(preview.width,preview.height);
  image.data.set(pixels);ctx.putImageData(image,0,0);
  const output=cell.canvas.getContext('2d');
  if(!output)throw Error('Canvas 2D context unavailable');
  const size=cell.canvas.width;
  output.clearRect(0,0,size,size);
  output.imageSmoothingEnabled=style.id!=='retro-3d-study';
  output.imageSmoothingQuality='high';
  const tileable=preview.originalWidth===preview.originalHeight&&
    profile!=='end';
  const tiles=controls.tiling.checked&&tileable?2:1;
  const cellSize=size/tiles;
  for(let y=0;y<tiles;y++)for(let x=0;x<tiles;x++)
    output.drawImage(scratch,x*cellSize,y*cellSize,cellSize,cellSize);
  cell.info.textContent=preview.originalWidth+' × '+preview.originalHeight+
    (preview.originalHeight>preview.originalWidth?' · central crop':'')+
    (tiles===2?' · repeat ×4':controls.tiling.checked&&!tileable?
      ' · repeat unavailable':'')+
    (nativeStyle(material,style.id)?' · native generation':' · surface study')+
    ' · 256px study bake';
}
async function render(){
  const run=++activeRender;
  renderReady=false;updateExportButton();
  const view=controls.channel.value,profile=controls.profile.value;
  const styles=visibleStyles();
  controls.seed.textContent=masterSeed===null?'Reference seeds':
    'Master '+String(masterSeed);
  const total=sources.size*styles.length;
  let done=0;
  status.textContent='Rendering '+view+' · 0/'+total+' comparisons';
  for(const material of sources.values()){
    const cut=material.id==='timber-oak'?profile:material.profile;
    for(const style of styles){
      await new Promise(resolve=>requestAnimationFrame(resolve));
      if(run!==activeRender)return;
      try{
        const preview=getPreview(material,view,cut,style.id);
        const pixels=styledImage(material,style,view,cut,preview);
        paintPreview(cells.get(material.id+'/'+style.id),
          material,style,preview,pixels,cut);
        status.textContent='Rendering '+view+' · '+(++done)+'/'+total;
      }catch(error){
        const problem='Unable to render '+material.label+'/'+style.label+': '+
          (error instanceof Error?error.message:String(error));
        status.textContent=problem;console.error(error);
        return;
      }
    }
  }
  if(run===activeRender){
    renderReady=true;updateExportButton();
    status.textContent='Ready · '+sources.size+' materials · '+
      styles.length+' art directions · identical source seeds';
    studioSignal({type:'studio:ready'});
  }
}
async function exportPng(){
  if(!renderReady||exporting)return;
  const generation=activeRender;
  exporting=true;updateExportButton();
  try{
    // Use every rendered cell, including columns beyond the scroll viewport.
    // This is intentionally separate from any DOM screenshot implementation.
    const canvas=document.createElement('canvas');
    const styles=visibleStyles();
    const materials=[...sources.values()];
    const view=controls.channel.value,profile=controls.profile.value;
    const seed=masterSeed,tiling=controls.tiling.checked;
    const layout=drawTextureStudyExport(canvas,{
      styles,materials,cells,view,profile,seed,tiling,
    });
    const blob=await new Promise((resolve,reject)=>{
      canvas.toBlob(result=>result?resolve(result):
        reject(Error('Browser could not encode the PNG')),'image/png');
    });
    if(blob.type!=='image/png')throw Error('PNG encoding failed');
    const url=URL.createObjectURL(blob);
    try{
      const link=document.createElement('a');
      link.href=url;
      link.download=textureStudyExportFilename({view,seed,styles});
      document.body.append(link);
      link.click();
      link.remove();
    }finally{
      // Allow the browser's download manager time to open the Blob URL.
      setTimeout(()=>URL.revokeObjectURL(url),30000);
    }
    if(generation===activeRender)
      status.textContent='PNG prepared · '+layout.width+' × '+
        layout.height+' · '+styles.length+' styles / '+materials.length+
        ' materials';
  }catch(error){
    status.textContent='PNG export failed: '+
      (error instanceof Error?error.message:String(error));
    console.error(error);
  }finally{
    exporting=false;updateExportButton();
  }
}
exportButton.addEventListener('click',()=>void exportPng());
for(const input of [controls.channel,controls.profile,controls.tiling])
  input.addEventListener('change',()=>void render());
byId('studyReseed').addEventListener('click',()=>{
  masterSeed=crypto.getRandomValues(new Uint32Array(1))[0];
  sourceCache.clear();previewCache.clear();styleCache.clear();
  void render();
});
byId('studyReset').addEventListener('click',()=>{
  masterSeed=null;
  sourceCache.clear();previewCache.clear();styleCache.clear();
  controls.channel.value='albedo';controls.profile.value='panel';
  controls.tiling.checked=false;
  selectedStyles.clear();
  for(const style of STUDY_STYLES)selectedStyles.add(style.id);
  for(const input of filterInputs.values())input.checked=true;
  buildBoard();void render();
});
// The Studio tab becomes visible while the first sources are being prepared.
buildBoard();
studioSignal({type:'studio:ready'});
void render();
