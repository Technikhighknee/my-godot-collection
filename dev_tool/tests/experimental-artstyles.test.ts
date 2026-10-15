import test from 'node:test';
import assert from 'node:assert/strict';
import {EXPERIMENTAL_ARTSTYLES,findExperimentalArtstyle,
  defineExperimentalStyleSupport}
  from '../tools/asset-procgen/web/artstyles/experimental-artstyles.mjs';
import {STUDY_STYLES} from '../tools/asset-procgen/web/texture-style-study.mjs';
import {MATERIAL_STUDY_STYLES}
  from '../tools/asset-procgen/web/material-style-generation.mjs';
import {CLAY_GENERATIVE_STYLES}
  from '../tools/asset-procgen/web/clay-style-generation.mjs';

const ids=['classic-strategy-study','naturalistic-study',
  'hand-painted-study','retro-3d-study','watercolor-study'];

test('experimental artstyle catalogue owns stable identities and lifecycle',()=>{
  assert.deepEqual(EXPERIMENTAL_ARTSTYLES.map(item=>item.id),ids);
  assert.deepEqual(STUDY_STYLES.slice(1),EXPERIMENTAL_ARTSTYLES);
  assert.equal(STUDY_STYLES[0]?.id,'current');
  assert.ok(Object.isFrozen(EXPERIMENTAL_ARTSTYLES));
  for(const item of EXPERIMENTAL_ARTSTYLES){
    assert.strictEqual(findExperimentalArtstyle(item.id),item);
    assert.equal(item.version,1);
    assert.equal(item.status,'experimental');
    assert.ok(item.label.length>0);
  }
  assert.equal(findExperimentalArtstyle('current'),null,
    'Unstyled baseline is not an artstyle capability');
});

test('material grammars opt in explicitly and reject unknown style identities',()=>{
  assert.deepEqual(MATERIAL_STUDY_STYLES,
    ['hand-painted-study','retro-3d-study','naturalistic-study','watercolor-study']);
  assert.deepEqual(CLAY_GENERATIVE_STYLES,MATERIAL_STUDY_STYLES);
  for(const id of MATERIAL_STUDY_STYLES)
    assert.ok(findExperimentalArtstyle(id));
  assert.throws(()=>defineExperimentalStyleSupport(['missing-style' as never]),
    /Unregistered experimental artstyle/);
  assert.throws(()=>defineExperimentalStyleSupport([
    'retro-3d-study','retro-3d-study',
  ]),/Duplicate experimental artstyle support/);
});
