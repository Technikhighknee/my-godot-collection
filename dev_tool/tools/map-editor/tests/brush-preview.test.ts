import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { sampleHeight, surfaceAt } from '../web/mesh-data.mjs';

// Run the actual preview handler with minimal DOM/Three.js stubs. A previous
// regression accidentally read map.terrain.terrain, breaking both probe and ring.
test('terrain pointer feedback reads the map terrain and renders its brush ring', () => {
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('function updateTerrainPointerFeedback(');
  const end = app.indexOf('function updateTerrainUI(', start);
  assert.ok(start >= 0 && end > start, 'preview functions must be present');

  const terrain = { size: [20, 20], min_height: 0, max_height: 10, surface_palette: ['terrain.grass', 'terrain.rock'] };
  const height = { width: 3, height: 3, data: new Float32Array(9).fill(0.5) };
  const surface = { width: 2, height: 2, data: new Uint8Array([0, 1, 1, 0]) };
  const positions = new Float32Array(64 * 3);
  const position = { array: positions, needsUpdate: false };
  const ring = { visible: false, geometry: { getAttribute(name: string) { assert.equal(name, 'position'); return position; } } };
  const probe = { textContent: '' };
  const fields: Record<string, { value: string } | typeof probe> = {
    probe, sculptMode: { value: 'raise' }, brushRadius: { value: '2' },
  };
  const context = {
    currentDoc: { map: { terrain }, height, surface },
    sampleHeight, surfaceAt, editMode: 'sculpt',
    brushRing: ring, paintEyedropper: false,
    brushPointerModifiers: { shiftKey: false, ctrlKey: false },
    effectiveSculptMode: (mode: string) => mode,
    el: (id: string) => fields[id],
    lastPointerWorld: null,
  };
  runInNewContext(app.slice(start, end) + '\nupdateTerrainPointerFeedback(5, 7);', context);
  assert.match(probe.textContent, /RAISE · X 5\.0 · Z 7\.0 · H 5\.00 m · terrain\.grass/);
  assert.equal(ring.visible, true);
  assert.equal(position.needsUpdate, true);
  assert.equal(positions[0], 7);
  assert.ok(Math.abs(positions[1] - 5.2) < 1e-4);
  assert.equal(positions[2], 7);
});
