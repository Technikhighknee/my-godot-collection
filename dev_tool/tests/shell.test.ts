import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadMap } from '../tools/map-editor/src/io/map-io.ts';
import { createEditorServer } from '../tools/map-editor/src/server.ts';

const home = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const editor = readFileSync(new URL('../tools/map-editor/web/index.html', import.meta.url), 'utf8');
const homeJs = readFileSync(new URL('../web/dev-tool.js', import.meta.url), 'utf8');

test('home lists tools honestly and editor can return to it', () => {
  assert.match(home, /<title>1400 · Dev Tool<\/title>/);
  assert.match(home, /href="\/tools\/map-editor\/"/);
  assert.match(home, /id="dt-map-name"/);
  assert.match(home, /href="\/tools\/asset-procgen\/"/);
  assert.match(home, /03 AVAILABLE/);
  assert.match(home, /href="\/tools\/trunk-studio\/"/);
  assert.match(editor, /href="\/" aria-label="Return to Dev Tool home"/);
  assert.match(editor, /\/dev-tool\.css/);
  assert.match(homeJs, /fetch\('\/api\/map'/);
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

    const api = await get('/api/map');
    assert.equal(api.status, 200);
    assert.equal((await api.json()).map.name, doc.map.name);
    const procgen = await get('/tools/asset-procgen/');
    assert.equal(procgen.status, 200);
    assert.match(await procgen.text(), /1400 · Asset ProcGen/);
    assert.equal((await get('/tools/map-editor/', { method: 'POST' })).status, 405);
    assert.equal((await get('/dev_tool/web/index.html')).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
