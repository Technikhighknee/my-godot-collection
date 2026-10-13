import test from 'node:test';
import assert from 'node:assert/strict';
import {GENERATORS} from '../tools/asset-procgen/web/generators.mjs';
import {buildAssetLibraryTree,filterAssetLibrary,createAssetLibrary}
  from '../tools/asset-procgen/web/asset-library.mjs';

test('library metadata groups 3D and 2D components under the same asset family',()=>{
  const root=buildAssetLibraryTree(GENERATORS);
  assert.deepEqual(root.groups.map(g=>g.name),['Textures','Architecture','Vegetation']);
  assert.deepEqual(root.groups[0]!.groups.map(g=>g.name),['Roofs','Wood']);
  assert.deepEqual(root.groups[0]!.groups[0]!.assets.map(d=>d.id),
    ['roof-thatch','roof-clay']);
  assert.deepEqual(root.groups[0]!.groups[1]!.assets.map(d=>d.id),['timber-oak']);
  assert.deepEqual(root.groups[1]!.groups.map(g=>g.name),['Buildings']);
  assert.deepEqual(root.groups[1]!.groups[0]!.groups[0]!.assets.map(d=>d.id),
    ['timber-building']);
  const vegetation=root.groups[2]!;
  assert.deepEqual(vegetation.groups.map(g=>g.name),['Oak','Fir']);
  const oak=vegetation.groups[0]!;
  assert.deepEqual(oak.assets.map(d=>d.id),
    ['oak','oak-atlas','oak-sprig','oak-bark']);
  assert.deepEqual(vegetation.groups[1]!.assets.map(d=>d.id),['fir']);
  assert.deepEqual(oak.assets.map(d=>d.navType),['3D','Atlas','Sprite','Texture']);

  // Adding a completely new family does not require UI source changes.
  const stone={...GENERATORS[0]!,id:'granite',label:'Granite boulder',
    libraryPath:['Rocks & Terrain','Granite'],navLabel:'Boulder'};
  const extended=buildAssetLibraryTree([...GENERATORS,stone]);
  assert.deepEqual(extended.groups.map(g=>g.name),
    ['Textures','Architecture','Vegetation','Rocks & Terrain']);
  assert.equal(extended.groups[3]!.groups[0]!.assets[0]!.id,'granite');
  assert.throws(()=>buildAssetLibraryTree([...GENERATORS,GENERATORS[0]!]),
    /Duplicate/);
  assert.throws(()=>buildAssetLibraryTree([{...GENERATORS[0]!,
    libraryPath:[]}]),/missing library path/);
});

test('search matches family, generator, output type and multiple terms',()=>{
  const lookup=(query:string,kind:'all'|'model'|'image'='all')=>
    filterAssetLibrary(GENERATORS,{query,kind}).map(d=>d.id);
  assert.deepEqual(lookup('oak bark'),['oak-bark']);
  assert.deepEqual(lookup('Vegetation oak 2D'),
    ['oak-atlas','oak-sprig','oak-bark']);
  assert.deepEqual(lookup('oak','model'),['oak']);
  assert.deepEqual(lookup('fir','image'),[]);
  assert.deepEqual(lookup('Architecture buildings'),['timber-building']);
  assert.deepEqual(lookup('building','model'),['timber-building']);
  assert.deepEqual(lookup('atlas'),['oak-atlas']);
  assert.deepEqual(lookup('texture'),['roof-thatch','roof-clay','timber-oak','oak-bark']);
  assert.deepEqual(lookup('tree','model'),['oak','fir']);
  assert.deepEqual(lookup('  UNMATCHED '),[]);
  assert.throws(()=>filterAssetLibrary(GENERATORS,{kind:'invalid' as never}),
    /Invalid/);
});

test('navigation supports selecting, filtering, favorites, recents and Ctrl+K',()=>{
  class Element {
    children:Element[]=[];
    className='';
    textContent='';
    title='';
    type='';
    value='';
    id='';
    hidden=false;
    style:Record<string,string>={};
    dataset:Record<string,string>={};
    attributes:Record<string,string>={};
    listeners=new Map<string,(event:any)=>void>();
    focused=false;
    append(...elements:Element[]){this.children.push(...elements);}
    replaceChildren(...elements:Element[]){this.children=elements;}
    setAttribute(key:string,value:string){this.attributes[key]=value;}
    addEventListener(key:string,handler:(event:any)=>void){
      this.listeners.set(key,handler);
    }
    fire(key:string,event:Record<string,unknown>={}){
      const handler=this.listeners.get(key);
      assert.ok(handler,'Expected '+key+' listener');
      handler({...event,target:this});
    }
    querySelectorAll(selector:string){
      if(selector==='button[data-kind]')
        return this.children.filter(child=>child.dataset.kind);
      throw Error('Unexpected selector: '+selector);
    }
    focus(){this.focused=true;fakeDocument.activeElement=this;}
    blur(){this.focused=false;fakeDocument.activeElement=null;}
    select(){}
  }
  function find(root:Element,predicate:(element:Element)=>boolean):Element|undefined{
    if(predicate(root))return root;
    for(const child of root.children){
      const found=find(child,predicate);
      if(found)return found;
    }
    return undefined;
  }
  const savedDoc=Object.getOwnPropertyDescriptor(globalThis,'document');
  const savedStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  const memory=new Map<string,string>();
  const fakeDocument={
    activeElement:null as Element|null,
    listeners:new Map<string,(event:any)=>void>(),
    createElement:(_tag:string)=>new Element(),
    addEventListener(key:string,callback:(event:any)=>void){
      this.listeners.set(key,callback);
    },
  };
  Object.defineProperty(globalThis,'document',{
    configurable:true,value:fakeDocument,
  });
  Object.defineProperty(globalThis,'localStorage',{
    configurable:true,value:{
      getItem:(key:string)=>memory.get(key)??null,
      setItem:(key:string,value:string)=>{memory.set(key,value);},
    },
  });
  try{
    const list=new Element(),search=new Element(),filters=new Element();
    const count=new Element();
    for(const kind of ['all','model','image']){
      const button=new Element();button.dataset.kind=kind;
      filters.append(button);
    }
    let library:ReturnType<typeof createAssetLibrary>;
    const clicked:string[]=[];
    library=createAssetLibrary({
      definitions:GENERATORS,list:list as unknown as HTMLElement,
      search:search as unknown as HTMLInputElement,
      filters:filters as unknown as HTMLElement,
      count:count as unknown as HTMLElement,
      onSelect(id){clicked.push(id);library.select(id);},
    });
    assert.equal(count.textContent,'9 assets');
    assert.equal(library.select('oak'),true);
    assert.equal(library.select('invalid'),false);
    // A selected asset can appear both in Recent and in the category
    // tree. Compact Recent/Favorites links intentionally have no DOM id.
    const selected=find(list,node=>node.id==='oakGenerator');
    assert.equal(selected?.attributes['aria-current'],'page');
    const selectedRecent=find(list,node=>node.id===''&&
      node.attributes['aria-current']==='page');
    assert.ok(selectedRecent,'Recent must also highlight the active asset');

    const favorite=find(list,node=>
      node.attributes['aria-label']==='Add favorite: Oak tree');
    assert.ok(favorite);
    favorite.fire('click');
    assert.ok([...memory.values()][0]?.includes('"oak"'));
    assert.ok(find(list,node=>node.textContent==='FAVORITES'));

    filters.children[2]!.fire('click');
    assert.equal(count.textContent,'6 assets');
    assert.equal(filters.children[2]!.attributes['aria-pressed'],'true');
    search.value='oak bark';
    search.fire('input');
    assert.equal(count.textContent,'1 asset');
    assert.ok(find(list,node=>node.textContent==='Bark'));
    const bark=find(list,node=>node.id==='oak-barkGenerator');
    assert.ok(bark);
    bark.fire('click');
    assert.deepEqual(clicked,['oak-bark']);
    assert.equal(search.value,'');
    assert.ok(find(list,node=>node.textContent==='RECENT'));

    const shortcut=fakeDocument.listeners.get('keydown');
    assert.ok(shortcut);
    let prevented=false;
    shortcut({ctrlKey:true,metaKey:false,key:'k',
      preventDefault(){prevented=true;}});
    assert.ok(prevented);
    assert.equal(search.focused,true);
    search.value='sprig';
    search.fire('input');
    shortcut({ctrlKey:false,metaKey:false,key:'Escape'});
    assert.equal(search.value,'');
    assert.equal(search.focused,false);
    assert.equal(count.textContent,'6 assets');

    // The most recent selection stays available without a fresh search.
    filters.children[0]!.fire('click');
    assert.ok(find(list,node=>node.textContent==='Oak bark'));
    assert.equal(filters.children[0]!.attributes['aria-pressed'],'true');
  }finally{
    if(savedDoc)Object.defineProperty(globalThis,'document',savedDoc);
    else Reflect.deleteProperty(globalThis,'document');
    if(savedStorage)Object.defineProperty(globalThis,'localStorage',savedStorage);
    else Reflect.deleteProperty(globalThis,'localStorage');
  }
});
