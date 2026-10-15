// Study comparison delegates to the canonical production clay grammar.
import {defineExperimentalStyleSupport} from './artstyles/experimental-artstyles.mjs';
import {generateClaySurface} from './clay-surface-grammars.mjs';

export const CLAY_GENERATIVE_STYLES = defineExperimentalStyleSupport([
  'hand-painted-study',
  'retro-3d-study',
  'naturalistic-study',
  'watercolor-study',
]);

export function generateStyledClay(seeds, style) {
  if (!CLAY_GENERATIVE_STYLES.includes(style)) {
    throw Error('Unsupported generative clay style: ' + style);
  }
  return generateClaySurface(seeds, style.slice(0, -6));
}
