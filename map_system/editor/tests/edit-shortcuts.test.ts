import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveSculptMode, SCULPT_MODES, cycleChoice, resizeBrush, rotateDegrees, movedEntries } from '../web/edit-shortcuts.mjs';

test('Sculpt: shift reverses raise/lower, ctrl smooth wins; neither changes flatten', () => {
  for (const mode of SCULPT_MODES) {
    assert.equal(effectiveSculptMode(mode), mode);
    assert.equal(effectiveSculptMode(mode, {ctrlKey: true}), 'smooth');
    assert.equal(effectiveSculptMode(mode, {shiftKey: true, ctrlKey: true}), 'smooth');
  }
  assert.equal(effectiveSculptMode('raise', {shiftKey: true}), 'lower');
  assert.equal(effectiveSculptMode('lower', {shiftKey: true}), 'raise');
  assert.equal(effectiveSculptMode('smooth', {shiftKey: true}), 'smooth');
  assert.equal(effectiveSculptMode('flatten', {shiftKey: true}), 'flatten');
  assert.throws(() => effectiveSculptMode('paint'));
});

test('Subtools cycle with wrap-around; brush bounds and 15-degree rotations are stable', () => {
  assert.equal(cycleChoice(['roads', 'areas'], 'roads', -1), 'areas');
  assert.equal(cycleChoice(SCULPT_MODES, 'flatten', 1), 'raise');
  assert.equal(cycleChoice(SCULPT_MODES, 'raise', -1), 'flatten');
  assert.equal(resizeBrush(0.5, -1), 0.5);
  assert.equal(resizeBrush(100, 1), 100);
  assert.equal(resizeBrush(10, 1), 11);
  assert.equal(rotateDegrees(355), 10);
  assert.equal(rotateDegrees(0, -1), 345);
});

test('Cursor-aligned duplication preserves group offsets and rejects outside bounds', () => {
  const entries = [{id:'a', position:[10,10], rotation: 12}, {id:'b',position:[15,20],rotation:5}, {id:'other',position:[90,90]}];
  const moved = movedEntries(entries, ['a','b'], [10,10], [20,30], [100,100]);
  assert.deepEqual(moved.map(e=>e.position), [[20,30],[25,40],[90,90]]);
  assert.equal(moved[0].rotation, 12);
  assert.deepEqual(entries[0].position, [10,10]);
  assert.throws(() => movedEntries(entries, ['a','b'], [10,10], [99,99], [100,100]));
});
