import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,access,rm} from 'node:fs/promises';
import type {AssetSource,AssetEntry,ImportedAssetSource}
  from '../src/projects/asset-source.ts';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectLibrary} from '../src/projects/library.ts';
import {findGenerator} from '../tools/asset-procgen/web/generators.mjs';
import {
  emptyProjectArtDirection,validateProjectArtDirection,
  resolveProjectArtstyle,applyProjectArtDirection,
} from '../tools/asset-procgen/web/artstyles/project-art-direction.mjs';
import {createProjectRouter} from '../src/projects/router.ts';
import {createDevToolServer} from '../src/server.ts';

const original={id:'original',version:1};
const recipe=(name='Village tiles')=>({name,generator:'roof-clay',
  masterSeed:3,components:{pattern:3,color:5}});
async function temporary(run:(folder:string)=>Promise<void>){
  const root=await mkdtemp(join(tmpdir(),'art-direction-'));
  try{await run(root);}finally{await rm(root,{recursive:true,force:true});}
}

test('project Art Direction has strict versioning, assignments and explicit precedence',()=>{
  const empty=emptyProjectArtDirection();
  assert.deepEqual(validateProjectArtDirection(empty,findGenerator),empty);
  const roof=findGenerator('roof-clay');
  assert.ok(roof);
  const profile={...empty,name:' Guild Visual Identity ',
    defaultArtstyle:original,generatorArtstyles:{'roof-clay':original}};
  const validated=validateProjectArtDirection(profile,findGenerator);
  assert.equal(validated.name,'Guild Visual Identity');
  assert.deepEqual(resolveProjectArtstyle('roof-clay',roof,undefined,validated),original);
  assert.deepEqual(resolveProjectArtstyle('roof-clay',roof,original,empty),original);
  assert.equal(resolveProjectArtstyle('roof-clay',roof,undefined,empty),undefined);
  assert.throws(()=>validateProjectArtDirection({...empty,version:2},findGenerator),
    /Unsupported project art direction/);
  assert.throws(()=>validateProjectArtDirection({...empty,extra:true},findGenerator),
    /Unsupported project art direction/);
  assert.throws(()=>validateProjectArtDirection({...empty,
    defaultArtstyle:{id:'naturalistic-study',version:1}},findGenerator),/artstyle/i);
  assert.throws(()=>validateProjectArtDirection({...empty,
    generatorArtstyles:{'not-a-generator':original}},findGenerator),/Unknown artstyle generator/);
  assert.throws(()=>validateProjectArtDirection({...empty,
    generatorArtstyles:{'roof-clay':{id:'original',version:123}}},findGenerator),
  /artstyle version/);
});

test('project identity remains optional and never rewrites asset recipes',async()=>{
  await temporary(async root=>{
    const lib=await ProjectLibrary.open(root,undefined,findGenerator);
    await lib.create('town','Town');
    const plain=await lib.artDirection();
    assert.equal(plain.revision,null);
    await assert.rejects(access(join(root,'town','art-direction.json')),/ENOENT/);
    const asset=await lib.createAsset('tiles',recipe());
    const before=(await lib.buildPlan(['tiles'])).nodes[0]!.key;
    const first=await lib.buildAsset('tiles');
    assert.equal(first.built,1);
    assert.equal((await lib.buildAsset('tiles')).reused,1);
    const modified=await lib.updateArtDirection({...plain.source,
      name:'Northern coastline',generatorArtstyles:{'roof-clay':original}},
    plain.revision);
    assert.match(modified.revision,/^[a-f0-9]{64}$/);
    assert.deepEqual(modified.source.generatorArtstyles['roof-clay'],original);
    const after=(await lib.buildPlan(['tiles'])).nodes[0]!.key;
    assert.notEqual(after,before,'A new project assignment invalidates its build key');
    const rebuilt=await lib.buildAsset('tiles');
    assert.equal(rebuilt.built,1);
    assert.equal((await lib.buildAsset('tiles')).reused,1);
    const unchanged=await lib.asset('tiles');
    assert.equal(unchanged.revision,asset.revision);
    if('origin' in unchanged.source)throw Error('Unexpected imported source');
    assert.equal(unchanged.source.artstyle,undefined,
      'Project defaults must never be persisted into individual recipes');
    const disk=JSON.parse(await readFile(join(root,'town','assets','tiles.asset.json'),'utf8'));
    assert.equal(disk.artstyle,undefined);
    await assert.rejects(lib.updateArtDirection({...plain.source,name:'Stale'},null),
      /modified/);
    await assert.rejects(lib.updateArtDirection({...plain.source,name:'Stale'},
      'a'.repeat(64)),/modified/);
    const reopened=await ProjectLibrary.open(root,undefined,findGenerator);
    assert.deepEqual((await reopened.artDirection()).source,modified.source);
    const cleared=await reopened.updateArtDirection(plain.source,modified.revision);
    assert.equal((await reopened.buildPlan(['tiles'])).nodes[0]!.key,before,
      'Removing a project override restores the original build fingerprint');
    assert.ok(cleared.revision);
  });
});

test('resolution scopes style changes to eligible assets and leaves imports untouched',()=>{
  const source:AssetSource={format:'devtool-asset',version:1,id:'tiles',name:'Tiles',
    generator:{id:'roof-clay',version:1,masterSeed:1,
      components:{pattern:1,color:2}},dependencies:[]};
  const other:AssetSource={...source,id:'thatch',generator:{...source.generator,id:'roof-thatch'}};
  const imported:ImportedAssetSource={format:'devtool-asset',version:2,
    id:'imported',name:'Imported',origin:'imported',kind:'image',dependencies:[],
    imported:{format:'png',path:'imports/imported.png',
      sha256:'a'.repeat(64),byteLength:64}};
  const entries:AssetEntry[]=[{source,kind:'image',revision:'one'},
    {source:other,kind:'image',revision:'two'},
    {source:imported,kind:'image',revision:'three'}];
  const profile={...emptyProjectArtDirection(),
    generatorArtstyles:{'roof-clay':original}};
  const resolved=applyProjectArtDirection(entries,profile,findGenerator);
  const styled=resolved[0]!.source;
  if('origin' in styled)throw Error('Unexpected imported source');
  assert.deepEqual(styled.artstyle,original);
  assert.strictEqual(resolved[1],entries[1]);
  assert.strictEqual(resolved[2],entries[2]);
  const unchanged=entries[0]!.source;
  if('origin' in unchanged)throw Error('Unexpected imported source');
  assert.equal(unchanged.artstyle,undefined);
});

test('project Art Direction API protects identity and rejects concurrent edits',async()=>{
  await temporary(async root=>{
    const lib=await ProjectLibrary.open(root,undefined,findGenerator);
    await lib.create('town','Town');
    const server=createDevToolServer(createProjectRouter(lib,{buildings:[]}));
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
      const address=server.address();
      assert.ok(address&&typeof address!=='string');
      const base='http://127.0.0.1:'+address.port;
      const route='/api/projects/active/art-direction';
      const current=await (await fetch(base+route)).json();
      assert.equal(current.revision,null);
      const edit={revision:null,source:{...current.source,name:'New identity'}};
      const post=(payload:unknown,id='town',origin=base)=>
        fetch(base+route,{method:'PUT',
          headers:{Origin:origin,'X-Project-Id':id,
            'Content-Type':'application/json'},
          body:JSON.stringify(payload)});
      assert.equal((await post(edit,'wrong')).status,409);
      assert.equal((await post(edit,'town','http://evil.example')).status,400);
      const saved=await post(edit);
      assert.equal(saved.status,200);
      const written=await saved.json();
      assert.equal(written.source.name,'New identity');
      assert.equal((await post(edit)).status,409);
      const currentFile=await lib.artDirection();
      assert.equal(currentFile.revision,written.revision);
    }finally{
      await new Promise<void>((resolve,reject)=>
        server.close(error=>error?reject(error):resolve()));
    }
  });
});

test('Studio owns project identity UI while asset preview uses the same resolver as builds',async()=>{
  const html=await readFile(new URL('../web/studio.html',import.meta.url),'utf8');
  const studio=await readFile(new URL('../web/studio.js',import.meta.url),'utf8');
  const editor=await readFile(new URL('../tools/asset-procgen/web/app.js',import.meta.url),'utf8');
  assert.match(html,/id="artDirectionName"/);
  assert.match(html,/id="artDirectionDefault"/);
  assert.match(html,/id="artDirectionGenerators"/);
  assert.match(studio,/art-direction-changed/);
  assert.match(studio,/ArtDirection/);
  assert.match(editor,/resolveProjectArtstyle/);
  assert.match(editor,/projectArtDirection=\(await projectApi/);
});

test('project-wide art direction styles materials but does not force unsupported model grammars', () => {
  const project = {
    ...emptyProjectArtDirection(),
    defaultArtstyle: {id: 'naturalistic', version: 1},
  };
  const roof = findGenerator('roof-clay');
  const building = findGenerator('timber-building');
  assert.ok(roof && building);
  assert.deepEqual(
    resolveProjectArtstyle('roof-clay', roof, undefined, project),
    {id: 'naturalistic', version: 1}
  );
  assert.equal(
    resolveProjectArtstyle('timber-building', building, undefined, project),
    undefined
  );
  assert.throws(
    () => resolveProjectArtstyle(
      'timber-building', building, {id: 'naturalistic', version: 1}, project
    ),
    /does not support/
  );
});
