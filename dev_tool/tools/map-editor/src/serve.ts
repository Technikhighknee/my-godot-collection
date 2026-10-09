import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validatePlacementDefinitions } from '../web/building-placement.mjs';
import { loadMap } from './io/map-io.ts';
import { createEditorServer } from './server.ts';
import { MapWorkspace } from './editing/map-workspace.ts';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: npm start -- [map.json] [--port 4371] [--definitions path.json]\nDefault map: ../map_system/coastal_relief.map.json\nBinds to 127.0.0.1 only. Saves map JSON and edited terrain assets.');
} else {
  try {
    const index = args.indexOf('--port');
    const portValue = index >= 0 ? args[index + 1] : '4371';
    const port = Number(portValue);
    if (!/^[0-9]+$/.test(portValue ?? '') || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid --port (expected 1..65535)');
    const defsIndex = args.indexOf('--definitions');
    if (defsIndex >= 0 && (!args[defsIndex + 1] || args[defsIndex + 1].startsWith('--'))) throw new Error('Missing --definitions file');
    const paths = args.filter((arg, i) => arg !== '--port' && i !== index + 1 && arg !== '--definitions' && i !== defsIndex + 1);
    if (paths.length > 1 || paths.some(s => s.startsWith('--'))) throw new Error('Expected one map path and optional --port');
    const file = resolve(paths[0] ?? '../map_system/coastal_relief.map.json');
    const doc = await loadMap(file);
    const definitionsFile = resolve(defsIndex >= 0 ? args[defsIndex + 1]! : fileURLToPath(new URL('../placement-definitions.json', import.meta.url)));
    const definitions = validatePlacementDefinitions(JSON.parse(await readFile(definitionsFile, 'utf8')));
    const workspace = await MapWorkspace.open(file, definitions);
    const server = createEditorServer(doc, workspace.getStore(), definitions, workspace);
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
