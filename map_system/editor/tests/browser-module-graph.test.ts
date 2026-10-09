import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMap } from '../src/io/map-io.ts';
import { createEditorServer } from '../src/server.ts';

// Missing static imports stop app.js before its startup/error handler runs.
// Walk the real HTTP graph, rather than checking syntax on disk alone.
test('all relative browser imports are served as JavaScript', async () => {
  const doc = await loadMap('../godot/coastal_relief.map.json');
  const server = createEditorServer(doc);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const origin = 'http://127.0.0.1:' + address.port;
    const pending = ['/app.js'];
    const visited = new Set<string>();
    while (pending.length) {
      const path = pending.pop()!;
      if (visited.has(path)) continue;
      visited.add(path);
      const response = await fetch(origin + path);
      assert.equal(response.status, 200, path + ' must be served to the browser');
      assert.match(response.headers.get('content-type') ?? '', /(?:text|application)\/javascript/, path);
      const source = await response.text();
      const imports = /(?:^|\n)\s*import\s+(?:[^'"\n]*?\s+from\s+)?['"](\.[^'"\n]+)['"]/g;
      for (const [, specifier] of source.matchAll(imports)) {
        const target = new URL(specifier, origin + path);
        assert.equal(target.origin, origin, path + ' must only use local relative imports');
        pending.push(target.pathname);
      }
    }
    assert.ok(visited.size >= 10, 'the dependency graph must actually be traversed');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
