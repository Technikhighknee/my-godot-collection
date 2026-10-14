// Project-first editor shell. Editors keep their own rendering and tools.
const byId=id=>document.getElementById(id);
const studio=byId('studio'),tree=byId('projectTree'),catalog=byId('generatorTree');
const tabbar=byId('tabbar'),region=byId('editorRegion'),overview=byId('overview');
const search=byId('resourceSearch');
const tabs=new Map();
let project=null,assets=[],maps=[],graph={edges:[],missing:[]},activeMap=null;
let selected=null,activeTab='overview',mode='explorer',collapsed=false;
let pendingPlacement=null,pendingNewMap=false,blocked=false,requesting=false;
const cacheKey='devtool.studio.openTabs';
function showError(message){
  const toast=byId('toast');
  toast.textContent=message;toast.hidden=false;
  byId('statusText').textContent=message;
}
async function api(path,options){
  const response=await fetch(path,{cache:'no-store',...options});
  const data=await response.json();
  if(!response.ok)throw Error(data.error||'HTTP '+response.status);
  return data;
}
function jsonWrite(path,method,value,headers={}){
  return api(path,{method,headers:{'Content-Type':'application/json',...headers},
    body:JSON.stringify(value)});
}
function setStatus(message){byId('statusText').textContent=message;}
function make(tag,className,text){
  const element=document.createElement(tag);
  if(className)element.className=className;
  if(text!==undefined)element.textContent=text;
  return element;
}
function assetType(asset){
  return asset.source.generator.id.startsWith('roof-')?'Project texture':
    asset.kind==='model'?'3D model':'2D image';
}
function resourceIcon(kind){
  return kind==='map'?'▧':kind==='texture'?'▤':kind==='building'?'⌂':
    kind==='model'?'⬡':kind==='image'?'▨':'◇';
}
function persisted(){
  try{
    sessionStorage.setItem(cacheKey,JSON.stringify({
      project:project?.id,
      tabs:[...tabs.values()].map(t=>({key:t.key,kind:t.kind,label:t.label,id:t.id})),
      active:activeTab,
    }));
  }catch{/* Storage can be disabled. */}
}
async function verifyProject(){
  if(blocked)return false;
  const {project:actual}=await api('/api/projects/active');
  if(actual?.id!==project?.id){
    blocked=true;
    showError('The active project changed in another window. Reopen the studio.');
    for(const tab of tabs.values())tab.frame.inert=true;
    return false;
  }
  return true;
}
function dirtyDocuments(){return [...tabs.values()].filter(t=>t.dirty);}
window.addEventListener('beforeunload',event=>{
  if(!dirtyDocuments().length)return;
  event.preventDefault();event.returnValue='';
});
function selectTab(key){
  if(key!=='overview'&&!tabs.has(key))return;
  activeTab=key;
  studio.classList.toggle('editing',key!=='overview');
  overview.hidden=key!=='overview';
  byId('overviewTab').setAttribute('aria-selected',String(key==='overview'));
  for(const tab of tabs.values()){
    const focused=tab.key===key;
    tab.frame.hidden=!focused;
    tab.loading.hidden=!focused||tab.ready;
    tab.button.setAttribute('aria-selected',String(focused));
  }
  setStatus(key==='overview'?'PROJECT OVERVIEW':(tabs.get(key)?.label||'EDITOR').toUpperCase());
  persisted();
}
function removeTab(key){
  const tab=tabs.get(key);
  if(!tab)return;
  if(tab.dirty&&!confirm('Unsaved changes in '+tab.label+'. Close anyway?'))return;
  tab.frame.remove();tab.loading.remove();tab.button.remove();tabs.delete(key);
  if(activeTab===key)selectTab(tabs.keys().next().value||'overview');
  else persisted();
}
function makeTab({key,kind,label,id}){
  if(tabs.has(key)){selectTab(key);return tabs.get(key);}
  const tab=make('div','tab');
  tab.setAttribute('role','tab');tab.setAttribute('aria-selected','false');
  tab.tabIndex=0;tab.title=label;
  const icon=make('span','tab-icon',resourceIcon(kind));
  const name=make('span','tab-label',label);
  const close=make('button','close-tab','×');
  close.type='button';close.setAttribute('aria-label','Close '+label);
  close.addEventListener('click',event=>{event.stopPropagation();removeTab(key);});
  tab.append(icon,name,close);
  tab.addEventListener('click',()=>selectTab(key));
  tab.addEventListener('keydown',event=>{
    if(event.key==='Enter'||event.key===' '){event.preventDefault();selectTab(key);}
    if(event.key==='Delete'){event.preventDefault();removeTab(key);}
  });
  const frame=make('iframe','editor-view');
  frame.title=label;
  frame.setAttribute('loading','eager');
  frame.setAttribute('referrerpolicy','same-origin');
  frame.hidden=true;
  const loading=make('div','editor-loading');
  loading.setAttribute('role','status');
  loading.append(make('span','editor-loading-spinner'),
    make('span',null,'Opening '+label+'…'));
  loading.hidden=true;
  frame.classList.add('is-loading');
  const value={key,kind,label,id,button:tab,frame,loading,dirty:false,ready:false};
  tabs.set(key,value);
  tabbar.append(tab);region.append(frame,loading);
  // The embedded editor, not iframe load, defines readiness.
  // In particular, a saved asset must finish loading its requested recipe.

  selectTab(key);
  return value;
}
function renameTab(tab,label){
  tab.label=label;tab.button.querySelector('.tab-label').textContent=label;
  tab.button.title=label;tab.frame.title=label;
  persisted();
}
function openAsset(source){
  if(blocked)return;
  const key='asset:'+source.id;
  const tab=makeTab({key,kind:source.generator.id, id:source.id,label:source.name});
  // A mounted frame stays alive as the user switches between documents.
  if(!tab.frame.getAttribute('src'))tab.frame.src='/tools/asset-procgen/?embedded=1&asset='+
    encodeURIComponent(source.id)+'&generator='+encodeURIComponent(source.generator.id);
  selectTab(key);
}
function openStyleStudy(){
  if(blocked)return;
  const key='study:materials';
  const tab=makeTab({key,kind:'study',id:'materials',
    label:'Texture Style Study'});
  if(!tab.frame.getAttribute('src'))
    tab.frame.src='/tools/asset-procgen/style-study?embedded=1';
  selectTab(key);
}
function openGenerator(generator){
  if(blocked)return;
  const key='new:'+generator.id;
  const tab=makeTab({key,kind:'new',id:generator.id,label:'New '+generator.navLabel+' · '+generator.libraryPath.at(-1)});
  if(!tab.frame.getAttribute('src'))tab.frame.src='/tools/asset-procgen/?embedded=1&generator='+encodeURIComponent(generator.id);
  selectTab(key);
}
async function openMap(map){
  if(blocked||requesting)return;
  if(!(await verifyProject()))return;
  if(!map)throw Error('No maps in the current project');
  if(!map.valid)throw Error('The selected map is invalid');
  requesting=true;
  try{
    const existing=tabs.get('map:active');
    if(activeMap&&activeMap.file!==map.file){
      if(existing?.dirty&&!confirm('Discard unsaved map changes before opening '+map.name+'?'))return;
      const meta=await api('/api/map');
      await jsonWrite('/api/maps/active','PUT',{
        file:map.file,mapFile:meta.mapFile,revision:meta.revision,
      },{'X-Project-Id':project.id});
    }
    activeMap=map;
    const tab=makeTab({key:'map:active',kind:'map',id:map.file,label:map.name});
    if(tab.id!==map.file){
      tab.id=map.file;tab.dirty=false;tab.ready=false;
      tab.frame.classList.add('is-loading');
      tab.loading.hidden=false;
      tab.frame.src='/tools/map-editor/?embedded=1&map='+encodeURIComponent(map.file);
      renameTab(tab,map.name);
    }else if(!tab.frame.getAttribute('src')){
      tab.frame.src='/tools/map-editor/?embedded=1&map='+encodeURIComponent(map.file);
    }
    selectTab(tab.key);
    await refreshResources(false);
  }finally{requesting=false;}
}
function sendPlacement(){
  const tab=tabs.get('map:active');
  if(!tab?.ready||!pendingPlacement)return;
  tab.frame.contentWindow.postMessage({
    type:'studio:place-asset',id:pendingPlacement,projectId:project.id,
  },location.origin);
  pendingPlacement=null;
}
function sendNewMap(){
  const tab=tabs.get('map:active');
  if(!pendingNewMap||!tab?.ready)return;
  tab.frame.contentWindow.postMessage({type:'studio:create-map',
    projectId:project.id},location.origin);
  pendingNewMap=false;
}
async function newMap(){
  if(!activeMap)throw Error('This project has no starter map');
  pendingNewMap=true;
  await openMap(activeMap);
  sendNewMap();
}
async function placeAsset(source){
  if(!source||source.kind!=='model')return;
  if(!activeMap)throw Error('Create a map before placing an asset');
  pendingPlacement=source.source.id;
  await openMap(activeMap);
  sendPlacement();
  setStatus('PLACE MODE · CLICK TERRAIN TO PLACE ASSET');
}
function details(source){
  selected=source;
  byId('detailsMetadata').replaceChildren();
  byId('detailsOpen').hidden=!source;
  byId('detailsPlace').hidden=!source||source.kind!=='model';
  if(!source){
    byId('detailsTitle').textContent=project?.name||'Project';
    byId('detailsIcon').textContent='▦';
    byId('detailsDescription').textContent='Select a map or asset to inspect its source and open its editor.';
    return;
  }
  byId('detailsTitle').textContent=source.name;
  byId('detailsIcon').textContent=resourceIcon(source.kind);
  byId('detailsDescription').textContent=source.kind==='map'?
    'Editable map source · Terrain, roads, water and placement data.':
    'Editable procedural asset source. Changes are saved as a project recipe.';
  const fields=source.kind==='map'?
    [['Source',source.file],['Status',source.valid?'Ready':'Invalid']]:
    [['ID','asset:'+source.source.id],['Type',assetType(source)],
      ['Generator',source.source.generator.id],
      ['Used by',String(graph.edges.filter(e=>e.to==='asset:'+source.source.id).length)+' resources']];
  for(const [label,value] of fields){
    const term=make('dt',null,label),definition=make('dd',null,value);
    byId('detailsMetadata').append(term,definition);
  }
}
function resourceButton(item,kind){
  const button=make('button','resource');
  button.type='button';button.setAttribute('role','treeitem');
  const icon=make('span','resource-icon',resourceIcon(kind));
  const name=make('span','resource-name',item.name);
  button.append(icon,name);
  button.title=(kind==='map'?item.file:'asset:'+item.source.id);
  if((kind==='map'&&!item.valid))button.disabled=true;
  button.addEventListener('click',()=>{
    details(item);updateSelected(button);
    const action=kind==='map'?openMap(item):openAsset(item.source);
    Promise.resolve(action).catch(e=>showError(e.message));
  });
  button.addEventListener('contextmenu',event=>{
    event.preventDefault();details(item);updateSelected(button);
    if(activeTab!=='overview')selectTab('overview');
  });
  return button;
}
function updateSelected(button){
  for(const el of tree.querySelectorAll('.resource'))el.classList.remove('selected');
  button.classList.add('selected');
}
function section(name,items,kind){
  const group=make('section','tree-group');
  const toggle=make('button','group-title');
  toggle.type='button';toggle.setAttribute('aria-expanded','true');
  toggle.append(make('span','twisty','⌄'),
    make('span',null,name),make('span','count',String(items.length)));
  const child=make('div','group-items');child.setAttribute('role','group');
  for(const item of items)child.append(resourceButton(item,kind));
  if(!items.length)child.append(make('div','tree-empty','No resources yet'));
  toggle.addEventListener('click',()=>{
    child.hidden=!child.hidden;
    toggle.setAttribute('aria-expanded',String(!child.hidden));
  });
  group.append(toggle,child);return group;
}
function matches(item){
  const term=search.value.trim().toLowerCase();
  if(!term)return true;
  return [item.name,item.file,item.source?.id,item.source?.generator?.id]
    .some(value=>value?.toLowerCase().includes(term));
}
function renderTree(){
  const filteredMaps=maps.filter(matches),filteredAssets=assets.filter(matches);
  tree.replaceChildren(section('Worlds',filteredMaps,'map'),
    section('Buildings',filteredAssets.filter(a=>
      a.source.generator.id==='timber-building'),'building'),
    section('Models & Vegetation',filteredAssets.filter(a=>
      a.kind==='model'&&a.source.generator.id!=='timber-building'),'model'),
    section('Textures',filteredAssets.filter(a=>a.kind==='image'&&
      a.source.generator.id.startsWith('roof-')),'texture'),
    section('Images & Materials',filteredAssets.filter(a=>a.kind==='image'&&
      !a.source.generator.id.startsWith('roof-')),'image'));
  byId('resourceCount').textContent=(maps.length+assets.length)+' SOURCES';
}
function summaryButton(label,kind,action){
  const button=make('button','summary-link');
  button.type='button';
  button.append(make('span',null,resourceIcon(kind)),make('span',null,label));
  button.addEventListener('click',()=>Promise.resolve(action()).catch(e=>showError(e.message)));
  return button;
}
function renderOverview(){
  byId('overviewTitle').textContent=project?.name||'Project';
  byId('overviewCounts').textContent=maps.length+' maps · '+assets.length+' assets';
  const worldList=byId('overviewMaps'),assetList=byId('overviewAssets');
  worldList.replaceChildren(...maps.slice(0,5).map(m=>summaryButton(m.name,'map',()=>openMap(m))));
  assetList.replaceChildren(...assets.slice(0,6).map(a=>
    summaryButton(a.source.name,a.kind,()=>openAsset(a.source))));
  if(!maps.length)worldList.append(make('div','summary-empty','No maps'));
  if(!assets.length)assetList.append(make('div','summary-empty','No saved assets'));
  details(selected);
}
async function refreshResources(check=true){
  if(blocked||!project)return;
  if(check&&!(await verifyProject()))return;
  try{
    const [mapResult,assetResult,graphResult]=await Promise.all([
      api('/api/maps'),api('/api/projects/active/assets'),
      api('/api/projects/active/graph')]);
    maps=mapResult.maps.map(map=>({...map,kind:'map'}));
    assets=assetResult.assets.map(a=>({...a,name:a.source.name}));
    graph=graphResult;
    activeMap=maps.find(m=>m.active)||null;
    if(selected){
      selected=selected.kind==='map'?maps.find(m=>m.file===selected.file)||null:
        assets.find(a=>a.source.id===selected.source?.id)||null;
    }
    if(mode==='explorer')renderTree();
    renderOverview();
    byId('statusRight').textContent=graph.missing.length?
      graph.missing.length+' MISSING RESOURCE REFERENCES':'SOURCE PROJECT · NO BUILD OUTPUT';
  }catch(e){showError('Could not load project sources: '+e.message);}
}
async function showCatalog(){
  if(mode!=='generators')return;
  if(!catalog.dataset.loaded){
    const {GENERATORS}=await import('/tools/asset-procgen/generators.mjs');
    catalog.dataset.loaded='true';
    catalog.replaceChildren();
    const study=make('button','resource studio-study-resource');
    study.type='button';
    study.append(make('span','resource-icon','◈'),
      make('span','resource-name','Texture Style Study · All materials'));
    study.addEventListener('click',openStyleStudy);
    catalog.append(study);
    for(const family of [...new Set(GENERATORS.map(g=>g.libraryPath[0]))]){
      const group=make('section','tree-group');
      const header=make('div','group-title',family);
      const items=make('div','group-items');
      for(const generator of GENERATORS.filter(g=>g.libraryPath[0]===family)){
        const button=make('button','resource');
        button.type='button';
        button.append(make('span','resource-icon',generator.id==='timber-building'?'⌂':
          generator.kind==='model'?'⬡':'▨'),
          make('span','resource-name',generator.libraryPath.join(' / ')));
        button.addEventListener('click',()=>openGenerator(generator));
        items.append(button);
      }
      group.append(header,items);catalog.append(group);
    }
  }
}
async function setMode(next){
  mode=next;
  byId('explorerButton').classList.toggle('active',next==='explorer');
  byId('toolsButton').classList.toggle('active',next==='generators');
  byId('explorerButton').setAttribute('aria-pressed',String(next==='explorer'));
  byId('toolsButton').setAttribute('aria-pressed',String(next==='generators'));
  tree.hidden=next!=='explorer';catalog.hidden=next!=='generators';
  byId('explorerTitle').textContent=next==='explorer'?'EXPLORER':'GENERATORS';
  byId('newResource').hidden=next!=='explorer';
  search.placeholder=next==='explorer'?'Filter resources…':'Browse generators…';
  if(next==='explorer'){renderTree();}else await showCatalog();
}
function focusSearch(){if(collapsed)toggleExplorer();search.focus();search.select();}
function toggleExplorer(){
  collapsed=!collapsed;studio.classList.toggle('collapsed',collapsed);
  byId('explorerButton').setAttribute('aria-pressed',String(!collapsed));
  byId('collapseExplorer').textContent=collapsed?'›':'‹';
}
function openCatalog(){
  if(collapsed)toggleExplorer();
  return setMode('generators');
}
function warnBeforeSwitch(){return !dirtyDocuments().length||
  confirm('Some editors have unsaved changes. Return to projects anyway?');}
function saveAssetEvent(tab,message){
  if(message.id&&tab.kind==='new'){
    const old=tab.key;const key='asset:'+message.id;
    if(!tabs.has(key)){
      tabs.delete(old);tab.key=key;tab.id=message.id;tabs.set(key,tab);
      activeTab=key;
    }
  }
  tab.dirty=false;
  if(message.name)renameTab(tab,message.name);
  tab.button.classList.remove('modified');
  refreshResources().catch(e=>showError(e.message));
  broadcastProjectAssets(tab);
  persisted();
}
function broadcastProjectAssets(sender){
  for(const tab of tabs.values())
    if(tab!==sender&&tab.ready)tab.frame.contentWindow?.postMessage({
      type:'studio:project-assets-changed',projectId:project.id,
    },location.origin);
}
window.addEventListener('message',event=>{
  if(event.origin!==location.origin)return;
  const tab=[...tabs.values()].find(t=>t.frame.contentWindow===event.source);
  if(!tab||!event.data||typeof event.data!=='object')return;
  const msg=event.data;
  if(msg.type==='studio:dirty'){
    tab.dirty=Boolean(msg.dirty);
    tab.button.classList.toggle('modified',tab.dirty);
    tab.button.querySelector('.tab-label').textContent=tab.label+(tab.dirty?' ●':'');
  }else if(msg.type==='studio:asset-saved'){
    saveAssetEvent(tab,msg);
  }else if(msg.type==='studio:project-assets-changed'){
    refreshResources().then(()=>broadcastProjectAssets(tab))
      .catch(e=>showError(e.message));
  }else if(msg.type==='studio:map-saved'){
    tab.dirty=false;
    refreshResources().catch(e=>showError(e.message));
  }else if(msg.type==='studio:map-opened'&&tab.kind==='map'){
    tab.id=msg.file;
    renameTab(tab,msg.name);
    refreshResources().catch(e=>showError(e.message));
  }else if(msg.type==='studio:open-style-study'){
    openStyleStudy();
  }else if(msg.type==='studio:open-generator'&&typeof msg.id==='string'){
    import('/tools/asset-procgen/generators.mjs').then(({findGenerator})=>{
      const generator=findGenerator(msg.id);
      if(generator)openGenerator(generator);
      else showError('Unknown generator '+msg.id);
    }).catch(e=>showError(e.message));
  }else if(msg.type==='studio:open-asset'&&typeof msg.id==='string'){
    const found=assets.find(a=>a.source.id===msg.id);
    if(found)openAsset(found.source);else showError('Asset '+msg.id+' is not in this project');
  }else if(msg.type==='studio:ready'){
    tab.ready=true;
    tab.frame.classList.remove('is-loading');
    // A ready editor must never remain covered by its loading overlay.
    // Inactive tabs are hidden by selectTab; on activation the ready flag
    // ensures their loader remains hidden too.
    tab.loading.hidden=true;
    if(tab.kind==='map'){sendPlacement();sendNewMap();}
  }else if(msg.type==='studio:focus-search'){
    focusSearch();
  }
});
byId('overviewTab').addEventListener('click',()=>selectTab('overview'));
byId('openMap').addEventListener('click',()=>{
  if(activeMap)openMap(activeMap).catch(e=>showError(e.message));
  else showError('This project has no maps yet.');
});
byId('createAsset').addEventListener('click',()=>openCatalog().catch(e=>showError(e.message)));
byId('openStyleStudy').addEventListener('click',openStyleStudy);
byId('newResource').addEventListener('click',()=>{
  if(mode==='generators'){openCatalog().catch(e=>showError(e.message));return;}
  newMap().catch(e=>showError(e.message));
});
byId('projectButton').addEventListener('click',()=>{
  if(warnBeforeSwitch())location.assign('/');
});
byId('refreshButton').addEventListener('click',()=>refreshResources().catch(e=>showError(e.message)));
byId('collapseExplorer').addEventListener('click',toggleExplorer);
byId('explorerButton').addEventListener('click',()=>{
  if(collapsed)toggleExplorer();
  setMode('explorer').catch(e=>showError(e.message));
});
byId('toolsButton').addEventListener('click',()=>{
  if(collapsed)toggleExplorer();
  setMode('generators').catch(e=>showError(e.message));
});
byId('searchTrigger').addEventListener('click',focusSearch);
search.addEventListener('input',()=>{
  if(mode==='explorer')renderTree();
  else for(const b of catalog.querySelectorAll('.resource'))
    b.hidden=!b.textContent.toLowerCase().includes(search.value.toLowerCase());
});
byId('detailsOpen').addEventListener('click',()=>{
  if(selected?.kind==='map')openMap(selected).catch(e=>showError(e.message));
  else if(selected)openAsset(selected.source);
});
byId('detailsPlace').addEventListener('click',()=>{
  placeAsset(selected).catch(e=>showError(e.message));
});
document.addEventListener('keydown',event=>{
  const editable=event.target.closest?.('input,textarea,select,[contenteditable=true]');
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){
    event.preventDefault();focusSearch();
  }else if((event.ctrlKey||event.metaKey)&&event.key==='Tab'){
    event.preventDefault();
    const keys=['overview',...tabs.keys()];
    selectTab(keys[(keys.indexOf(activeTab)+(event.shiftKey?-1:1)+keys.length)%keys.length]);
  }else if(event.key==='Escape'&&document.activeElement===search){search.blur();}
  else if(!editable&&event.key==='F5'){/* Browser refresh remains available. */}
});
window.addEventListener('focus',()=>{if(project)verifyProject().catch(e=>showError(e.message));});
(async()=>{
  try{
    const result=await api('/api/projects/active');
    if(!result.project){location.replace('/');return;}
    project=result.project;
    byId('projectName').textContent=project.name;
    byId('explorerProject').textContent=project.name;
    document.title=project.name+' · Dev Tool';
    await refreshResources(false);
    let saved=null;
    try{saved=JSON.parse(sessionStorage.getItem(cacheKey)||'null');}
    catch{/* Private browsing and disabled storage must not break Studio. */}
    if(saved?.project===project.id&&Array.isArray(saved.tabs)){
      for(const info of saved.tabs.slice(0,12)){
        if(info.kind==='map'&&activeMap?.file===info.id){
          const tab=makeTab({...info,key:'map:active'});
          tab.frame.src='/tools/map-editor/?embedded=1';
        }else if(info.key==='study:materials'){
          openStyleStudy();
        }else if(info.key?.startsWith('asset:')){
          const found=assets.find(a=>a.source.id===info.id);
          if(found)openAsset(found.source);
        }else if(info.key?.startsWith('new:')){
          await showCatalog();
          const {findGenerator}=await import('/tools/asset-procgen/generators.mjs');
          const generator=findGenerator(info.id);
          if(generator)openGenerator(generator);
        }
      }
      if(saved.active==='overview'||tabs.has(saved.active))selectTab(saved.active);
      else selectTab('overview');
    }else selectTab('overview');
    if(!tabs.size&&activeMap)byId('openMap').disabled=false;
    setStatus('READY');
  }catch(e){showError('Unable to open project workspace: '+e.message);}
})();
