import { resolve } from 'node:path';
import { loadMap } from './io/map-io.ts';
import { createEditorServer } from './server.ts';
import { RoadStore } from './editing/road-store.ts';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: npm start -- [map.json] [--port 4371]\nDefault map: ../godot/coastal_relief.map.json\nBinds to 127.0.0.1 only. Saves map JSON and edited terrain assets.');
} else {
  try {
    const index = args.indexOf('--port');
    const portValue = index >= 0 ? args[index + 1] : '4371';
    const port = Number(portValue);
    if (!/^[0-9]+$/.test(portValue ?? '') || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid --port (expected 1..65535)');
    const paths = args.filter((arg, i) => arg !== '--port' && i !== index + 1);
    if (paths.length > 1 || paths.some(s => s.startsWith('--'))) throw new Error('Expected one map path and optional --port');
    const file = resolve(paths[0] ?? '../godot/coastal_relief.map.json');
    const doc = await loadMap(file);
    const store = await RoadStore.open(file, doc);
    const server = createEditorServer(doc, store);
    server.on('error', error => { console.error(error); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => {
      console.log(`1400 Map Editor — ${doc.map.name}`);
      console.log(`http://127.0.0.1:${port}/`);
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
