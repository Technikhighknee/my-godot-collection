// Plan reusable project textures for every declared material slot.
// A new artstyle copies existing shape/color seeds, so the geometry and
// structure can be compared independently of visual art direction.
import {findGenerator, availableProductionArtstyles} from './generators.mjs';
import {createSeedState} from './seed-model.mjs';

export function planBuildingMaterialSet(definition, style, assignments, projectAssets, nonce) {
  if (definition?.kind !== 'model' || !definition.materialSlots?.length) {
    throw Error('The active generator has no building material slots');
  }
  if (!/^[a-z0-9]{4,10}$/.test(nonce)) {
    throw Error('Invalid material-set identifier');
  }
  const supported = availableProductionArtstyles(
    findGenerator(definition.materialSlots[0].generators[0])
  );
  const selected = supported.find(item =>
    item.id === style?.id && item.version === style?.version
  );
  if (!selected || selected.id === 'original') {
    throw Error('Select a supported production material artstyle');
  }

  const materials = {};
  const assets = [];
  for (const slot of definition.materialSlots) {
    const reference = assignments[slot.id];
    const saved = reference ? projectAssets.get(reference.slice('asset:'.length)) : null;
    if (reference && !saved) {
      throw Error('Missing project material: ' + reference);
    }
    const generatorId = saved?.source.generator?.id ?? slot.generators[0];
    if (!slot.generators.includes(generatorId)) {
      throw Error('Incompatible material in ' + slot.id);
    }
    const generator = findGenerator(generatorId);
    if (generator?.kind !== 'image') {
      throw Error('Unknown material generator: ' + generatorId);
    }
    if (!availableProductionArtstyles(generator).some(item =>
      item.id === selected.id && item.version === selected.version
    )) {
      throw Error('Style not supported by ' + generatorId);
    }
    const initial = createSeedState(generator);
    const source = saved?.source.generator;
    const id = ['mat', generatorId, selected.id, nonce].join('-');
    if (id.length > 48) {
      throw Error('Material resource identifier is too long');
    }
    assets.push({
      id,
      name: generator.label + ' · ' + selected.label + ' · ' + nonce,
      generator: generatorId,
      masterSeed: source?.masterSeed ?? initial.masterSeed,
      components: {...(source?.components ?? initial.components)},
      artstyle: {id: selected.id, version: selected.version},
    });
    materials[slot.id] = 'asset:' + id;
  }
  if (new Set(assets.map(asset => asset.id)).size !== assets.length) {
    throw Error('Duplicate material resource IDs');
  }
  return {assets, materials};
}
