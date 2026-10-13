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
