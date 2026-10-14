import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadMap } from '../tools/map-editor/src/io/map-io.ts';
import { createEditorServer } from '../tools/map-editor/src/server.ts';
import {createDevToolServer} from '../src/server.ts';
import {createMapEditorHandler} from '../tools/map-editor/src/server.ts';

const home = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const editor = readFileSync(new URL('../tools/map-editor/web/index.html', import.meta.url), 'utf8');
const homeJs = readFileSync(new URL('../web/dev-tool.js', import.meta.url), 'utf8');

test('project launcher replaces tool landing; standalone editor remains available', () => {
  assert.match(home, /<title>1400 · Dev Tool<\/title>/);
  assert.match(home, /id="projectList"/);
  assert.match(home, /id="createForm"/);
  assert.doesNotMatch(home, /dt-card-grid|PLANNED — NOT YET AVAILABLE/);
  assert.match(editor, /href="\/" aria-label="Return to Dev Tool home"/);
  assert.match(editor, /\/dev-tool\.css/);
  assert.match(homeJs, /\/studio\//);
});

test('HTTP main menu and existing map editor are separate, working routes', async () => {
  const doc = await loadMap('../map_system/coastal_relief.map.json');
  const server = createEditorServer(doc);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`;
    const get = (path: string, init?: RequestInit) => fetch(origin + path, init);
    const index = await get('/');
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type') ?? '', /text\/html/);
    assert.match(index.headers.get('content-security-policy') ?? '', /default-src 'none'/);
    assert.match(await index.text(), /1400 · Dev Tool/);

    for (const path of ['/tools/map-editor/', '/tools/map-editor']) {
      const response = await get(path);
      assert.equal(response.status, 200, path);
      const page = await response.text();
      assert.match(page, /1400 · Map Editor/);
      assert.match(page, /\/app\.js/);
      assert.match(page, /Return to Dev Tool home/);
    }
    for (const [path, type] of [
      ['/studio.css', /text\/css/],
      ['/launcher.css', /text\/css/],
      ['/studio.js', /javascript/],
      ['/dev-tool.css', /text\/css/],
      ['/dev-tool.js', /javascript/],
      ['/style.css', /text\/css/],
      ['/app.js', /javascript/]
    ] as const) {
      const response = await get(path);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get('content-type') ?? '', type);
      assert.ok((await response.text()).length > 40);
      const head = await get(path, { method: 'HEAD' });
      assert.equal(head.status, 200, path + ' HEAD');
      assert.equal((await head.text()).length, 0);
    }

    const studio = await get('/studio/');
    assert.equal(studio.status,200);
    assert.match(await studio.text(),/id="tabbar"/);
    assert.match(studio.headers.get('content-security-policy')??'',/frame-src 'self'/);
    const api = await get('/api/map');
    assert.equal(api.status, 200);
    assert.equal((await api.json()).map.name, doc.map.name);
    assert.equal((await get('/tools/asset-procgen/')).status, 200);
    assert.match(await (await get('/tools/asset-procgen/')).text(), /1400 · Asset ProcGen/);
    assert.equal((await get('/tools/map-editor/', { method: 'POST' })).status, 405);
    assert.equal((await get('/dev_tool/web/index.html')).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});


test('shared Dev Tool host works with no Map Editor API attached',async()=>{
  const server=createDevToolServer();
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const address=server.address();
    assert.ok(address&&typeof address!=='string');
    const base='http://127.0.0.1:'+address.port;
    for(const route of ['/','/studio/','/studio.js','/studio.css','/dev-tool.js','/tools/map-editor/',
      '/tools/asset-procgen/','/tools/asset-procgen/app.js']){
      const res=await fetch(base+route);
      assert.equal(res.status,200,route);
      assert.equal(res.headers.get('x-content-type-options'),'nosniff');
    }
    assert.equal((await fetch(base+'/api/map')).status,404);
    assert.equal((await fetch(base+'/tools/asset-procgen/',{method:'POST'})).status,405);
    assert.equal((await fetch(base+'/tools/map-editor/../../package.json')).status,404);
    assert.equal((await fetch(base+'/node_modules/three/package.json')).status,404);
  }finally{
    await new Promise<void>((resolve,reject)=>
      server.close(error=>error?reject(error):resolve()));
  }
});
test('Map Editor API mounts through the shared HTTP host unchanged',async()=>{
  const doc=await loadMap('../map_system/coastal_relief.map.json');
  const server=createDevToolServer(createMapEditorHandler(doc));
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const address=server.address();
    assert.ok(address&&typeof address!=='string');
    const url='http://127.0.0.1:'+address.port;
    const res=await fetch(url+'/api/map');
    assert.equal(res.status,200);
    assert.equal((await res.json()).map.name,doc.map.name);
    assert.equal((await fetch(url+'/api/placement-definitions')).status,200);
    assert.equal((await fetch(url+'/tools/asset-procgen/')).status,200);
  }finally{
    await new Promise<void>((resolve,reject)=>
      server.close(error=>error?reject(error):resolve()));
  }
});


test('server ownership stays at the Dev Tool root, not inside the Map Editor',()=>{
  const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.match(pkg.scripts.start,/src\/serve\.ts$/);
  const host=readFileSync(new URL('../src/server.ts',import.meta.url),'utf8');
  const startup=readFileSync(new URL('../src/serve.ts',import.meta.url),'utf8');
  const mapApi=readFileSync(new URL('../tools/map-editor/src/server.ts',import.meta.url),'utf8');
  assert.match(host,/createDevToolServer/);
  assert.match(host,/\/tools\/asset-procgen/);
  assert.doesNotMatch(host,/MapWorkspace|RoadStore|validateDocument/);
  assert.match(startup,/createDevToolServer\(api\)/);
  assert.match(mapApi,/createMapEditorHandler/);
  assert.doesNotMatch(mapApi,/\/tools\/asset-procgen|\/vendor\/three|staticRoutes/);
});

// Resource tabs use the same existing editor renderers and map API.
test('studio defines project resource navigation and editor bridge',()=>{
  const studio=readFileSync(new URL('../web/studio.html',import.meta.url),'utf8');
  const code=readFileSync(new URL('../web/studio.js',import.meta.url),'utf8');
  const styles=readFileSync(new URL('../web/studio.css',import.meta.url),'utf8');
  const asset=readFileSync(new URL('../tools/asset-procgen/web/app.js',import.meta.url),'utf8');
  const map=readFileSync(new URL('../tools/map-editor/web/app.js',import.meta.url),'utf8');
  for(const id of ['projectTree','generatorTree','tabbar','editorRegion',
    'overview','resourceSearch','projectButton'])assert.match(studio,new RegExp('id="'+id+'"'));
  assert.match(studio,/PROJECT WORKSPACE/);
  assert.match(code,/sessionStorage/);
  assert.match(code,/studio:place-asset/);
  assert.match(code,/studio:create-map/);
  assert.match(code,/studio:dirty/);
  assert.match(styles,/\.studio\.editing/);
  assert.match(asset,/studio:asset-saved/);
  assert.match(map,/studio:open-asset/);
  assert.match(map,/studio:map-saved/);
  assert.match(map,/studio:map-opened/);
});

test('embedded editors use prepaint layout and studio waits for source readiness',()=>{
  const assetHtml=readFileSync(new URL('../tools/asset-procgen/web/index.html',import.meta.url),'utf8');
  const mapHtml=readFileSync(new URL('../tools/map-editor/web/index.html',import.meta.url),'utf8');
  const assetJs=readFileSync(new URL('../tools/asset-procgen/web/app.js',import.meta.url),'utf8');
  const assetCss=readFileSync(new URL('../tools/asset-procgen/web/style.css',import.meta.url),'utf8');
  const studioJs=readFileSync(new URL('../web/studio.js',import.meta.url),'utf8');
  const studioCss=readFileSync(new URL('../web/studio.css',import.meta.url),'utf8');
  for(const html of [assetHtml,mapHtml]){
    const bootstrap=html.indexOf("classList.add('studio-embedded')");
    const sheet=html.indexOf('<link');
    assert.ok(bootstrap>=0&&bootstrap<sheet,'Embedded mode must be set before styles are loaded');
  }
  assert.match(assetCss,/\.studio-embedded \.pg-workspace/);
  assert.match(assetCss,/\.studio-embedded \.pg-stage\{min-height:0;height:auto\}/);
  assert.match(assetJs,/await loadSelectedProjectAsset\(\)/);
  assert.match(assetJs,/finally\s*\{[\s\S]*studioSignal\(\{type:'studio:ready'\}\)/);
  assert.match(studioJs,/tab\.frame\.classList\.remove\('is-loading'\)/);
  assert.match(studioJs,/tab\.loading\.hidden=true;/,
    'The editor ready signal must dismiss the loading overlay');
  assert.doesNotMatch(studioJs,/tab\.loading\.hidden=tab\.key!==activeTab/,
    'Active editor must not keep its loading overlay visible');
  assert.match(studioCss,/\.editor-view\.is-loading\{visibility:hidden\}/);
});

test('building family editor exposes shell/level controls and serves building source',async()=>{
  const html=readFileSync(new URL('../tools/asset-procgen/web/index.html',import.meta.url),'utf8');
  const app=readFileSync(new URL('../tools/asset-procgen/web/app.js',import.meta.url),'utf8');
  const renderer=readFileSync(new URL('../tools/asset-procgen/web/viewport-3d.mjs',import.meta.url),'utf8');
  const host=readFileSync(new URL('../src/server.ts',import.meta.url),'utf8');
  for(const id of ['buildingSettings','buildingLevel','buildingWidth','buildingDepth',
    'buildingStories','buildingRoofPitch','buildingInteriorMode',
    'buildingExterior','buildingInterior'])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(app,/optionsByGenerator/);
  assert.match(app,/currentBuildingView/);
  assert.match(renderer,/setBuildingView/);
  assert.match(host,/\/tools\/asset-procgen\/building.mjs/);
});

test('shared stone, plaster, timber and roof materials expose persistent project texture slots',()=>{
  const html=readFileSync(new URL('../tools/asset-procgen/web/index.html',import.meta.url),'utf8');
  const app=readFileSync(new URL('../tools/asset-procgen/web/app.js',import.meta.url),'utf8');
  const renderer=readFileSync(new URL('../tools/asset-procgen/web/viewport-3d.mjs',import.meta.url),'utf8');
  const studio=readFileSync(new URL('../web/studio.js',import.meta.url),'utf8');
  const server=readFileSync(new URL('../src/server.ts',import.meta.url),'utf8');
  const generators=readFileSync(new URL(
    '../tools/asset-procgen/web/generators.mjs',import.meta.url),'utf8');
  const building=readFileSync(new URL(
    '../tools/asset-procgen/web/building.mjs',import.meta.url),'utf8');
  assert.match(html,/id="materialSlots"/);
  assert.match(app,/mountMaterialControls/);
  assert.match(app,/for\(const slot of active\.materialSlots\?\?\[\]\)/);
  assert.match(app,/materialAssignments/);
  assert.match(app,/changeSharedMaterial/);
  for(const slot of ['foundationStone','facadePlaster','timberWood','roofThatch','roofClay'])
    assert.ok(generators.includes("id:'"+slot+"'"),slot+' declared');
  assert.match(building,/BUILDING_PART_SURFACES/);
  assert.match(renderer,/updateSurfaceTextures/);
  assert.match(renderer,/part\.surface/);
  assert.doesNotMatch(renderer,/const woodPart=/);
  assert.doesNotMatch(renderer,/const plasterTint=/);
  assert.match(studio,/studio:project-assets-changed/);
  assert.match(server,/\/tools\/asset-procgen\/roof-textures.mjs/);
  assert.match(server,/\/tools\/asset-procgen\/timber-textures.mjs/);
  assert.match(server,/\/tools\/asset-procgen\/plaster-textures.mjs/);
  assert.match(server,/\/tools\/asset-procgen\/stone-textures.mjs/);
});


test('imported asset controls remain separate from procedural editor capabilities',()=>{
  const html=readFileSync(new URL('../tools/asset-procgen/web/index.html',
    import.meta.url),'utf8');
  const app=readFileSync(new URL('../tools/asset-procgen/web/app.js',
    import.meta.url),'utf8');
  const studio=readFileSync(new URL('../web/studio.js',import.meta.url),'utf8');
  for(const id of ['importProjectFile','importProjectAsset'])
    assert.ok(html.includes('id="'+id+'"'),id+' must exist in project source UI');
  assert.match(app,/Imported assets have no procedural editor yet/);
  assert.match(app,/importProjectAsset/);
  assert.match(studio,/Imported 3D model/);
  assert.match(studio,/source\.generator\?\.id/);
});

test('project texture changes refresh clean editors without losing dirty recipes',()=>{
  const app=readFileSync(new URL('../tools/asset-procgen/web/app.js',import.meta.url),'utf8');
  const studio=readFileSync(new URL('../web/studio.js',import.meta.url),'utf8');
  assert.match(app,/latest&&\!recipeDirty&&latest\.revision!==loadedProjectAsset\.revision/);
  assert.match(app,/await loadSelectedProjectAsset\(\)/);
  assert.match(studio,/broadcastProjectAssets/);
});


test('texture style workbench serves its independent non-destructive comparison UI',async()=>{
  const host=createDevToolServer();
  await new Promise<void>(resolve=>host.listen(0,'127.0.0.1',resolve));
  try{
    const addr=host.address();
    assert.ok(addr&&typeof addr!=='string');
    const base='http://127.0.0.1:'+addr.port;
    for(const [path,type,expected] of [
      ['/tools/asset-procgen/style-study','text/html','id="studyBoard"'],
      ['/tools/asset-procgen/style-study.js','javascript','applyTextureStudyStyle'],
      ['/tools/asset-procgen/style-study.css','text/css','.study-board'],
      ['/tools/asset-procgen/texture-style-study.mjs','javascript','STUDY_MATERIALS'],
      ['/tools/asset-procgen/texture-study-export.mjs','javascript','drawTextureStudyExport'],
      ['/tools/asset-procgen/clay-style-generation.mjs','javascript','generateStyledClay'],
      ['/tools/asset-procgen/material-style-generation.mjs','javascript','makeStyledMaterialAsset'],
      ['/tools/asset-procgen/material-language.mjs','javascript','materialElementTraits'],
    ] as const){
      const response=await fetch(base+path);
      assert.equal(response.status,200,path);
      assert.match(response.headers.get('content-type')??'',new RegExp(type));
      assert.ok((await response.text()).includes(expected),path);
    }
    const editor=await(await fetch(base+'/tools/asset-procgen/')).text();
    assert.match(editor,/Texture style study/);
    assert.match(editor,/id="styleStudyLink"/);
    assert.match(editor,/href="\/studio\/\?study=materials"/);
  }finally{
    await new Promise<void>((resolve,reject)=>
      host.close(error=>error?reject(error):resolve()));
  }
});


test('Studio opens texture studies as tabs and restores them with the session',()=>{
  const html=readFileSync(new URL('../web/studio.html',import.meta.url),'utf8');
  const studio=readFileSync(new URL('../web/studio.js',import.meta.url),'utf8');
  const app=readFileSync(new URL('../tools/asset-procgen/web/app.js',import.meta.url),'utf8');
  const study=readFileSync(new URL('../tools/asset-procgen/web/style-study.js',import.meta.url),'utf8');
  assert.match(html,/id="openStyleStudy"/);
  assert.match(studio,/function openStyleStudy\(\)/);
  assert.match(studio,/key='study:materials'/);
  assert.match(studio,/style-study\?embedded=1/);
  assert.match(studio,/info.key==='study:materials'/);
  assert.match(studio,/studio:open-style-study/);
  assert.match(studio,/studio:open-generator/);
  assert.match(app,/getElementById\('styleStudyLink'\)/);
  assert.match(study,/studio:ready/);
  assert.match(study,/seed:masterSeed===null/);
  assert.match(study,/visibleStyles\(\)/);
  assert.match(study,/buildBoard\(\)/);
  assert.match(study,/PREVIEW_SIZE=256/);
  const comparison=readFileSync(new URL('../tools/asset-procgen/web/style-study.html',import.meta.url),'utf8');
  assert.match(comparison,/id="studyStyleFilters"/);
  assert.match(comparison,/id="studyCompareScroller"/);
  // Style options are populated from the JS catalog at runtime, not from
  // the static HTML shell. Verify the source of truth instead.
  const styleCatalog=readFileSync(
    new URL('../tools/asset-procgen/web/texture-style-study.mjs',import.meta.url),
    'utf8');
  assert.match(study,/STUDY_STYLES/);
  assert.match(styleCatalog,/label:'Watercolor'/);
  assert.match(styleCatalog,/label:'Retro 3D'/);
  assert.match(comparison,/id="studyExportPNG"/);
  assert.match(study,/texture-study-export\.mjs/);
  assert.match(study,/studyGeneration\?\.styles\.includes/);
  assert.match(study,/studyGeneration\.generate\(seeds,styleId\)/);
  const generators=readFileSync(new URL('../tools/asset-procgen/web/generators.mjs',import.meta.url),'utf8');
  assert.match(generators,/studyGeneration:Object\.freeze/);
  assert.match(generators,/CLAY_GENERATIVE_STYLES/);
  assert.match(generators,/MATERIAL_STUDY_STYLES/);
  assert.match(generators,/makeStyledMaterialAsset/);
  assert.match(study,/URL\.createObjectURL/);
  assert.match(study,/toBlob\(/);
  assert.match(study,/updateExportButton/);
});
