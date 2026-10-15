import type {GeneratorDefinition} from './generators.mjs';
import type {ProductionArtstyleReference} from './artstyles/production-artstyles.mjs';

export interface MaterialSetAsset {
  id: string;
  name: string;
  generator: string;
  masterSeed: number;
  components: Record<string, number>;
  artstyle: ProductionArtstyleReference;
}

export function planBuildingMaterialSet(
  definition: GeneratorDefinition,
  style: ProductionArtstyleReference,
  assignments: Record<string, string>,
  projectAssets: Map<string, {
    source: {
      generator?: {
        id: string;
        masterSeed: number;
        components: Record<string, number>;
      };
    };
  }>,
  nonce: string
): {assets: MaterialSetAsset[]; materials: Record<string, string>};
