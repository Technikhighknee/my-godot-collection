// Study comparison uses the exact same native grammar as production builds.
import {defineExperimentalStyleSupport} from './artstyles/experimental-artstyles.mjs';
import {makeMaterialSurface} from './material-surface-grammars.mjs';

export const MATERIAL_STUDY_STYLES = defineExperimentalStyleSupport([
  'hand-painted-study',
  'retro-3d-study',
  'naturalistic-study',
  'watercolor-study',
]);

export function makeStyledMaterialAsset(material, seeds, style) {
  if (!MATERIAL_STUDY_STYLES.includes(style)) {
    throw Error('Unknown study style: ' + style);
  }
  return {
    ...makeMaterialSurface(material, seeds, style.slice(0, -6)),
    sourceStyle: style,
  };
}
