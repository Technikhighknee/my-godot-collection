import {findGenerator,generateAsset} from './generators.mjs';
import {STUDY_MATERIALS,applyTextureStudyStyle,studySeeds,
  reseedStudySeeds} from './texture-style-study.mjs';

const byId=id=>document.getElementById(id);
const embedded=new URLSearchParams(location.search).get('embedded')==='1';
if(embedded)document.documentElement.classList.add('studio-embedded');
function studioSignal(message){
  if(embedded&&window.parent!==window)
    window.parent.postMessage(message,location.origin);
}
const board=byId('studyBoard'),status=byId('studyStatus');
const controls={
  channel:byId('studyChannel'),profile:byId('studyTimberProfile'),
  tiling:byId('studyTiling'),seed:byId('studySeed'),
};
const sources=new Map(),cells=new Map();
let masterSeed=null;
let activeRender=0;
for(const material of STUDY_MATERIALS){
  const definition=findGenerator(material.id);
  if(!definition||definition.kind!=='image')
    throw Error('Material generator unavailable: '+material.id);
  const meta={...material,definition};
  sources.set(material.id,meta);
  const label=document.createElement('div');
  label.className='study-name';
  const group=document.createElement('small');group.textContent=material.group;
  const title=document.createElement('strong');title.textContent=material.label;
  const link=document.createElement('a');
  link.href='/tools/asset-procgen/?generator='+encodeURIComponent(material.id);
  if(embedded){
    link.href='/studio/?generator='+encodeURIComponent(material.id);
    link.addEventListener('click',event=>{
      event.preventDefault();
      studioSignal({type:'studio:open-generator',id:material.id});
    });
  }else{
    link.href='/studio/?generator='+encodeURIComponent(material.id);
  }
  link.textContent='Open generator ↗';
  label.append(group,title,link);
  board.append(label);
  for(const style of ['current','classic-strategy-study']){
    const shell=document.createElement('div');
    shell.className='study-preview';
    const canvas=document.createElement('canvas');
    canvas.width=canvas.height=384;
    canvas.setAttribute('aria-label',material.label+' — '+
      (style==='current'?'current texture':'classic strategy study'));
    const info=document.createElement('span');info.className='study-image-info';
    info.textContent='Preparing…';
    shell.append(canvas,info);
    board.append(shell);
    cells.set(material.id+'/'+style,{canvas,info});
  }
}
// Raw generated images are memoized. Tiling and style toggles never reseed.
const cache=new Map();
function getImage(material,view,profile){
  const key=[material.id,masterSeed??'default',view,profile??''].join(':');
  if(cache.has(key))return cache.get(key);
  const seeds=masterSeed===null?studySeeds(material.definition):
    reseedStudySeeds(material.definition,masterSeed);
  const asset=generateAsset(material.definition,seeds);
  const source=document.createElement('canvas');
  asset.paint(source,view,profile??undefined);
  const context=source.getContext('2d',{willReadFrequently:true});
  if(!context)throw Error('Canvas 2D context unavailable');
  const width=source.width,height=source.height;
  if(width<1||height<1||width>4096||height>4096)
    throw Error('Invalid material dimensions: '+material.id);
  const data=context.getImageData(0,0,width,height).data;
  const image={data,width,height};
  cache.set(key,image);
  return image;
}
function paintPreview({canvas,info},source,pixels,profile){
  const scratch=document.createElement('canvas');
  scratch.width=source.width;scratch.height=source.height;
  const ctx=scratch.getContext('2d');
  if(!ctx)throw Error('Canvas 2D context unavailable');
  const image=ctx.createImageData(source.width,source.height);
  image.data.set(pixels);
  ctx.putImageData(image,0,0);
  const output=canvas.getContext('2d');
  if(!output)throw Error('Canvas 2D context unavailable');
  const size=canvas.width;
  output.clearRect(0,0,size,size);
  output.imageSmoothingEnabled=true;
  output.imageSmoothingQuality='high';
  // Timber beam uses a 512x2048 atlas. Show one 512x512 crop at full
  // texel density instead of distorting an entire long grain image.
  const square=Math.min(source.width,source.height);
  const sx=Math.floor((source.width-square)/2);
  const sy=Math.floor((source.height-square)/2);
  // Long-beam atlas crops and end-grain caps are not individual repeating
  // square tiles. Showing them 2x2 would falsely suggest a UV seam.
  const tileable=source.width===source.height&&profile!=='end';
  const tiles=controls.tiling.checked&&tileable?2:1;
  const cell=size/tiles;
  for(let y=0;y<tiles;y++)for(let x=0;x<tiles;x++)
    output.drawImage(scratch,sx,sy,square,square,x*cell,y*cell,cell,cell);
  info.textContent=source.width+' × '+source.height+
    (source.height>source.width?' · central full-resolution crop':'')+
    (tiles===2?' · tiled':controls.tiling.checked&&!tileable?
      ' · tiling disabled for this cut':'');
}
async function render(){
  const run=++activeRender;
  const view=controls.channel.value;
  const timber=controls.profile.value;
  controls.seed.textContent=masterSeed===null?'Reference seeds':
    'Master '+String(masterSeed);
  status.textContent='Rendering '+view+' · 0/'+sources.size+' materials';
  let count=0;
  for(const material of sources.values()){
    // Progress yields between individual generators so the interface can
    // paint a status message rather than freezing all five at once.
    await new Promise(resolve=>requestAnimationFrame(resolve));
    if(run!==activeRender)return;
    try{
      const profile=material.id==='timber-oak'?timber:material.profile;
      const source=getImage(material,view,profile);
      paintPreview(cells.get(material.id+'/current'),source,source.data,profile);
      const classic=applyTextureStudyStyle(material.id,
        'classic-strategy-study',view,source.data,{
          width:source.width,height:source.height,
          seed:masterSeed===null?material.definition.initialMasterSeed:masterSeed,
        });
      paintPreview(cells.get(material.id+'/classic-strategy-study'),
        source,classic,profile);
      count++;
      status.textContent='Rendering '+view+' · '+count+'/'+sources.size+
        ' materials';
    }catch(error){
      const problem='Unable to render '+material.label+': '+
        (error instanceof Error?error.message:String(error));
      status.textContent=problem;
      console.error(error);
      return;
    }
  }
  if(run===activeRender){
    status.textContent='Ready · '+count+' real materials · same seeds in both columns';
    studioSignal({type:'studio:ready'});
  }
}
for(const input of [controls.channel,controls.profile,controls.tiling])
  input.addEventListener('change',()=>void render());
byId('studyReseed').addEventListener('click',()=>{
  masterSeed=crypto.getRandomValues(new Uint32Array(1))[0];
  cache.clear();
  void render();
});
byId('studyReset').addEventListener('click',()=>{
  masterSeed=null;
  cache.clear();
  controls.channel.value='albedo';
  controls.profile.value='panel';
  controls.tiling.checked=false;
  void render();
});
void render();
