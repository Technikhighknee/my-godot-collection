// Asset Library navigation. Pure catalog helpers first; DOM and browser
// persistence stay here, separate from generation and preview rendering.
const STORAGE_KEY='1400.asset-procgen.library';
const pathKey=path=>JSON.stringify(path);
const normalize=text=>String(text??'').trim().toLocaleLowerCase();

export function filterAssetLibrary(definitions,{query='',kind='all'}={}){
  if(!['all','model','image'].includes(kind))
    throw Error('Invalid asset kind filter');
  const terms=normalize(query).split(/\s+/).filter(Boolean);
  return definitions.filter(def=>{
    if(kind!=='all'&&def.kind!==kind)return false;
    const searchable=normalize([
      def.id,def.label,def.navLabel,def.navType,
      ...(def.libraryPath??[]),
      def.kind==='model'?'3D model':'2D image',
    ].join(' '));
    return terms.every(term=>searchable.includes(term));
  });
}

export function buildAssetLibraryTree(definitions){
  const root={name:'',path:[],groups:[],assets:[]};
  const ids=new Set();
  for(const def of definitions){
    if(!def.id||ids.has(def.id))throw Error('Duplicate or missing asset ID');
    ids.add(def.id);
    if(!Array.isArray(def.libraryPath)||!def.libraryPath.length||
      def.libraryPath.some(part=>typeof part!=='string'||!part.trim()))
      throw Error('Generator missing library path: '+def.id);
    let node=root;
    for(const name of def.libraryPath){
      let group=node.groups.find(item=>item.name===name);
      if(!group){
        group={name,path:[...node.path,name],groups:[],assets:[]};
        node.groups.push(group);
      }
      node=group;
    }
    node.assets.push(def);
  }
  return root;
}
export function createAssetLibrary({definitions,list,search,filters,count,onSelect}){
  const byId=new Map(definitions.map(def=>[def.id,def]));
  let selected=null,kind='all',recent=[];
  let favoriteIds=new Set();
  const expanded=new Set();
  // Storage failure (e.g. blocked localStorage) must never block the editor.
  try{
    const saved=JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY)??'null');
    if(saved&&typeof saved==='object'){
      if(Array.isArray(saved.favorites))
        favoriteIds=new Set(saved.favorites.filter(id=>byId.has(id)));
      if(Array.isArray(saved.recent))
        recent=[...new Set(saved.recent.filter(id=>byId.has(id)))].slice(0,5);
    }
  }catch{ /* The library is fully usable without storage. */ }
  for(const def of definitions)
    if(def.id==='oak')
      for(let i=1;i<=def.libraryPath.length;i++)
        expanded.add(pathKey(def.libraryPath.slice(0,i)));
  if(!expanded.size&&definitions.length)
    for(let i=1;i<=definitions[0].libraryPath.length;i++)
      expanded.add(pathKey(definitions[0].libraryPath.slice(0,i)));

  function persist(){
    try{
      globalThis.localStorage?.setItem(STORAGE_KEY,JSON.stringify({
        favorites:[...favoriteIds],recent,
      }));
    }catch{ /* Private browsing or quota. */ }
  }
  const element=(tag,className,text)=>{
    const el=document.createElement(tag);
    if(className)el.className=className;
    if(text!==undefined)el.textContent=text;
    return el;
  };
  function item(def,compact=false){
    const row=element('div','pg-library-entry');
    const button=element('button','pg-asset-item');
    button.type='button';
    button.id=compact?'':def.id+'Generator';
    button.title=def.libraryPath.join(' / ')+' / '+def.navLabel;
    button.setAttribute('aria-label',def.label);
    button.setAttribute('aria-current',def.id===selected?'page':'false');
    const sym=element('span','pg-asset-symbol',def.symbol);
    sym.setAttribute('aria-hidden','true');
    const label=element('span','pg-asset-name',compact?def.label:def.navLabel);
    const type=element('span','pg-asset-type',def.navType);
    button.append(sym,label,type);
    button.addEventListener('click',()=>onSelect(def.id));
    const star=element('button','pg-favorite',favoriteIds.has(def.id)?'★':'☆');
    star.type='button';
    star.title=favoriteIds.has(def.id)?'Remove favorite':'Add favorite';
    star.setAttribute('aria-label',
      (favoriteIds.has(def.id)?'Remove ':'Add ')+'favorite: '+def.label);
    star.setAttribute('aria-pressed',String(favoriteIds.has(def.id)));
    star.addEventListener('click',()=>{
      if(favoriteIds.has(def.id))favoriteIds.delete(def.id);
      else favoriteIds.add(def.id);
      persist();render();
    });
    row.append(button,star);
    return row;
  }
  function section(label,defs){
    if(!defs.length)return;
    const heading=element('div','pg-library-section',label);
    list.append(heading);
    for(const def of defs)list.append(item(def,true));
  }
  function group(node,depth,searching){
    const key=pathKey(node.path);
    const open=searching||expanded.has(key);
    const wrapper=element('div','pg-library-group-wrap');
    const button=element('button','pg-library-group');
    button.type='button';
    button.style.paddingLeft=(10+depth*13)+'px';
    button.setAttribute('aria-expanded',String(open));
    const arrow=element('span','pg-group-chevron',open?'⌄':'›');
    arrow.setAttribute('aria-hidden','true');
    const title=element('span','pg-group-title',node.name);
    button.append(arrow,title);
    const childCount=countAssets(node);
    button.append(element('span','pg-group-count',String(childCount)));
    const children=element('div','pg-library-children');
    children.hidden=!open;
    button.addEventListener('click',()=>{
      if(expanded.has(key))expanded.delete(key);
      else expanded.add(key);
      // Search shows all matches; collapsing is handled after clearing search.
      if(searching){search.value='';}
      render();
    });
    for(const child of node.groups)children.append(group(child,depth+1,searching));
    for(const def of node.assets) {
      const entry=item(def);
      entry.style.paddingLeft=(12+(depth+1)*13)+'px';
      children.append(entry);
    }
    wrapper.append(button,children);
    return wrapper;
  }
  function countAssets(node){
    return node.assets.length+node.groups.reduce((n,child)=>n+countAssets(child),0);
  }
  function render(){
    const query=search.value;
    const visible=filterAssetLibrary(definitions,{query,kind});
    list.replaceChildren();
    if(!query.trim()){
      section('FAVORITES',definitions.filter(def=>
        favoriteIds.has(def.id)&&(kind==='all'||def.kind===kind)));
      section('RECENT',recent.map(id=>byId.get(id)).filter(def=>
        def&&(kind==='all'||def.kind===kind)).slice(0,3));
      if(visible.length)list.append(element('div','pg-library-section','LIBRARY'));
    }
    const tree=buildAssetLibraryTree(visible);
    for(const child of tree.groups)list.append(group(child,0,!!query.trim()));
    if(!visible.length)
      list.append(element('p','pg-library-empty','No matching assets.'));
    count.textContent=visible.length+' '+(visible.length===1?'asset':'assets');
    for(const button of filters.querySelectorAll('button[data-kind]')){
      button.setAttribute('aria-pressed',
        String(button.dataset.kind===kind));
    }
  }
  function select(id){
    const def=byId.get(id);
    if(!def)return false;
    selected=id;
    if(kind!=='all'&&kind!==def.kind)kind='all';
    if(search.value)search.value='';
    for(let i=1;i<=def.libraryPath.length;i++)
      expanded.add(pathKey(def.libraryPath.slice(0,i)));
    recent=[id,...recent.filter(other=>other!==id)].slice(0,5);
    persist();render();
    return true;
  }
  search.addEventListener('input',render);
  for(const button of filters.querySelectorAll('button[data-kind]'))
    button.addEventListener('click',()=>{
      kind=button.dataset.kind;
      render();
    });
  document.addEventListener('keydown',event=>{
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){
      event.preventDefault();
      search.focus();
      search.select();
    }else if(event.key==='Escape'&&document.activeElement===search){
      search.value='';
      render();
      search.blur();
    }
  });
  render();
  return {select,render};
}
