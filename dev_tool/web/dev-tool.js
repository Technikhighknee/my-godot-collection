const mapName=document.getElementById('dt-map-name');
const mapDetail=document.getElementById('dt-map-detail');
const list=document.getElementById('dt-project-list');
const form=document.getElementById('dt-project-create');
const nameInput=document.getElementById('dt-project-name');
const idInput=document.getElementById('dt-project-id');
const error=document.getElementById('dt-project-error');
let ownId=true;
nameInput.addEventListener('input',()=>{
  if(ownId)idInput.value=nameInput.value.toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9_-]+/g,'-')
    .replace(/^-+|-+$/g,'').slice(0,48);
});
idInput.addEventListener('input',()=>{ownId=false;});
async function api(path,options){
  const response=await fetch(path,{cache:'no-store',...options});
  const result=await response.json();
  if(!response.ok)throw Error(result.error||'HTTP '+response.status);
  return result;
}
function renderResources(project,maps,assets,graph,mapMeta){
  const pane=document.getElementById('dt-resources');
  pane.hidden=false;
  const mapsList=document.getElementById('dt-maps');
  const assetsList=document.getElementById('dt-assets');
  mapsList.replaceChildren();assetsList.replaceChildren();
  const counts=new Map();
  for(const edge of graph.edges)counts.set(edge.to,(counts.get(edge.to)||0)+1);
  for(const map of maps.maps){
    const button=document.createElement('button');
    button.type='button';button.className='dt-resource-entry';
    const title=document.createElement('strong');title.textContent=map.name;
    const caption=document.createElement('small');
    caption.textContent=map.file+(map.active?' · OPEN':'')+(map.valid?'':' · INVALID');
    button.append(title,caption);
    button.disabled=!map.valid;
    button.addEventListener('click',async()=>{
      try{
        if(!map.active)await api('/api/maps/active',{method:'PUT',
          headers:{'Content-Type':'application/json','X-Project-Id':project.id},
          body:JSON.stringify({file:map.file,revision:mapMeta.revision,mapFile:mapMeta.mapFile})});
        location.assign('/tools/map-editor/');
      }catch(e){error.textContent=e.message;}
    });
    mapsList.append(button);
  }
  if(!maps.maps.length)mapsList.textContent='No maps yet';
  for(const {source,kind} of assets.assets){
    const link=document.createElement('a');
    link.href='/tools/asset-procgen/?asset='+encodeURIComponent(source.id);
    link.className='dt-resource-entry';
    const title=document.createElement('strong');title.textContent=source.name;
    const caption=document.createElement('small');
    caption.textContent='asset:'+source.id+' · '+kind+' · '+source.generator.id+
      ' · '+(counts.get('asset:'+source.id)||0)+' references';
    link.append(title,caption);assetsList.append(link);
  }
  if(!assets.assets.length)assetsList.textContent='No saved assets yet · Create one with Asset ProcGen';
}
function projectButton(project,activeId){
  const button=document.createElement('button');
  button.type='button';button.className='dt-project-entry';
  button.setAttribute('aria-pressed',String(project.id===activeId));
  const label=document.createElement('strong');label.textContent=project.name;
  const info=document.createElement('small');
  info.textContent=project.id+(project.id===activeId?' · ACTIVE':'');
  button.append(label,info);
  button.addEventListener('click',async()=>{
    if(project.id===activeId)return;
    error.textContent='';
    try{
      await api('/api/projects/active',{method:'PUT',
        headers:{'Content-Type':'application/json'},body:JSON.stringify({id:project.id})});
      await refresh();
    }catch(e){error.textContent=e.message;}
  });
  return button;
}
async function refresh(){
  try{
    const {projects,active}=await api('/api/projects');
    list.replaceChildren(...projects.map(p=>projectButton(p,active?.id)));
    if(!projects.length)list.textContent='No projects yet. Create your first project.';
    if(active){
      const [assets,graph,maps,map]=await Promise.all([
        api('/api/projects/active/assets'),api('/api/projects/active/graph'),
        api('/api/maps'),api('/api/map')]);
      renderResources(active,maps,assets,graph,map);
      mapName.textContent=active.name;
      mapDetail.textContent=map.map.name+' · '+assets.assets.length+' saved assets · '+
        graph.edges.length+' references'+(graph.missing.length?' · MISSING: '+graph.missing.length:'');
    }else{
      document.getElementById('dt-resources').hidden=true;
      mapName.textContent='No project selected';
      mapDetail.textContent='Create a project to start producing persistent game content.';
    }
  }catch(e){
    document.getElementById('dt-resources').hidden=true;
    // Legacy single-map mode remains usable without a project API.
    list.textContent='Project management is unavailable in legacy map mode.';
    form.hidden=true;
    try{
      const response=await fetch('/api/map',{cache:'no-store'});
      if(!response.ok)throw Error('Map unavailable');
      const {map,mapFile}=await response.json();
      mapName.textContent=map.name;
      mapDetail.textContent=mapFile??'Legacy map workspace';
    }catch{
      mapName.textContent='Workspace unavailable';
      mapDetail.textContent=e.message;
    }
  }
}
form.addEventListener('submit',async event=>{
  event.preventDefault();
  error.textContent='';
  try{
    await api('/api/projects',{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({id:idInput.value.trim(),name:nameInput.value.trim()})});
    form.reset();ownId=true;await refresh();
  }catch(e){error.textContent=e.message;}
});
await refresh();
