import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../web/style.css', import.meta.url), 'utf8');

test('one canvas-first viewport, one hotbar and no permanent left sidebar', () => {
  assert.match(html, /id="viewport"/);
  assert.match(html, /id="hotbar"/);
  assert.doesNotMatch(html, /class="side"/);
  const tools = [...html.matchAll(/data-tool="(select|sculpt|paint|draw|place)"/g)].map(match => match[1]);
  assert.deepEqual(tools, ['select', 'sculpt', 'paint', 'draw', 'place']);
  for (const tool of ['workspacePanel', 'viewPanel', 'settingsPanel', 'toolPanel']) {
    assert.match(html, new RegExp(`id="${tool}"[^>]*hidden|hidden[^>]*id="${tool}"`));
  }
  assert.match(css, /\.hotbar-slot\.is-active/);
});

test('all literal editor DOM IDs still exist exactly once after rearranging controls', () => {
  const domIds = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const counts = new Map<string, number>();
  for (const id of domIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  assert.deepEqual([...counts].filter(([, count]) => count !== 1), []);
  for (const [, id] of app.matchAll(/\bel\('([^']+)'\)/g)) {
    assert.equal(counts.get(id), 1, `JavaScript references missing element #${id}`);
  }
  for (const id of ['brushRadiusSlider', 'brushStrengthSlider', 'drawRoadsTab', 'drawAreasTab', 'placeEntitiesTab', 'placeLakesTab']) {
    assert.equal(counts.get(id), 1);
  }
});
