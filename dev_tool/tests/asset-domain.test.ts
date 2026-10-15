import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProceduralSource,validateImportedSource,validateProjectSource,
  validateSource,
} from '../src/projects/asset-source.ts';
import {assertAssetDependencies} from '../src/projects/asset-graph.ts';
import {validateImportBytes} from '../src/projects/import-validation.ts';
import {encodeRgbaPng} from '../src/projects/build-image.ts';
import {findGenerator} from '../tools/asset-procgen/web/generators.mjs';

const clay=()=>createProceduralSource({
  name:'Clay roof',generator:'roof-clay',masterSeed:11,
  components:{pattern:11,color:13},
},'clay',findGenerator);

const house=()=>{
  const definition=findGenerator('timber-building');
  assert.ok(definition);
  return createProceduralSource({
    name:'House',generator:'timber-building',masterSeed:27,
    components:Object.fromEntries(definition.components.map(c=>[c.id,c.initialSeed])),
    materials:{roofClay:'asset:clay'},
  },'house',findGenerator);
};

test('project asset source schema is independent of persistence',()=>{
  const source=clay();
  assert.deepEqual(validateProjectSource(source,'clay',findGenerator),source);
  assert.deepEqual(validateSource(source,'clay',findGenerator),source);
  assert.throws(()=>validateSource({...source,generator:{
    ...source.generator,version:900,
  }},'clay',findGenerator),/Unsupported generator version/);
  assert.throws(()=>validateSource({...source,id:'another'},'clay',findGenerator),
    /does not match filename/);
  assert.equal(source.version,1,'Existing recipes do not migrate on read');
});

test('shared material graph rules operate without project storage',()=>{
  const texture=clay(),building=house();
  const entry={source:texture,revision:'test-revision',kind:'image' as const};
  assert.deepEqual(building.dependencies,['asset:clay']);
  assert.doesNotThrow(()=>assertAssetDependencies(building,[entry],findGenerator));
  assert.throws(()=>assertAssetDependencies(building,[],findGenerator),
    /existing compatible texture asset/);
  assert.throws(()=>assertAssetDependencies({...building,
    dependencies:['asset:missing'],materials:{roofClay:'asset:missing'},
  },[entry],findGenerator),/existing compatible texture asset/);
  assert.throws(()=>assertAssetDependencies({...building,
    dependencies:['asset:house'],materials:{},
  },[entry],findGenerator),/dependency cycle/);
});

test('binary import verification stays separate from source document schema',()=>{
  const png=encodeRgbaPng(1,1,Uint8Array.from([20,40,60,255]));
  assert.doesNotThrow(()=>validateImportBytes('png',png));
  const changed=Buffer.from(png);changed[20]^=1;
  assert.throws(()=>validateImportBytes('png',changed),/PNG|checksum/);
  const source=validateImportedSource({
    format:'devtool-asset',version:2,origin:'imported',kind:'image',
    id:'picture',name:'Picture',
    imported:{format:'png',path:'imports/picture.png',byteLength:png.length,
      sha256:'a'.repeat(64)},dependencies:[],
  },'picture');
  assert.equal(source.version,2);
  assert.equal(source.imported.format,'png');
  assert.throws(()=>validateImportedSource({...source,kind:'model'},'picture'),
    /Invalid imported file metadata/);
});
