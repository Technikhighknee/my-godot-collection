import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, modeForTool, toolForMode, toolShortcut } from '../web/tool-state.mjs';

test('five slots cover every active editor mode and preserve draw/place subtools', () => {
  assert.deepEqual(TOOLS, ['select', 'sculpt', 'paint', 'draw', 'place']);
  for (const mode of ['navigate', 'select', 'entities']) assert.equal(toolForMode(mode), 'select');
  for (const mode of ['edit', 'create', 'append', 'insert', 'polygon-edit', 'polygon-insert', 'draw-polygon']) assert.equal(toolForMode(mode), 'draw');
  for (const mode of ['place-entity', 'place-lake']) assert.equal(toolForMode(mode), 'place');
  assert.equal(modeForTool('draw', { draw: 'areas' }), 'polygon-edit');
  assert.equal(modeForTool('draw', { draw: 'roads' }), 'edit');
  assert.equal(modeForTool('place', { place: 'lake' }), 'place-lake');
  assert.equal(modeForTool('place', { place: 'entity' }), 'place-entity');
  assert.equal(modeForTool('select'), 'select');
  assert.throws(() => toolForMode('invalid'));
});

test('digit shortcuts refuse modifier combinations, repeats and unrelated keys', () => {
  for (let index = 1; index <= 5; index++) assert.equal(toolShortcut({ key: String(index) }), TOOLS[index - 1]);
  for (const key of ['6', '0', 'Digit1', 'F', 'e']) assert.equal(toolShortcut({ key }), null);
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'repeat']) {
    assert.equal(toolShortcut({ key: '2', [modifier]: true }), null);
  }
});
