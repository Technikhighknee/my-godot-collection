// The Dev Tool is project-first. A legacy map path remains supported.
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {validatePlacementDefinitions} from '../tools/map-editor/web/building-placement.mjs';
import {loadMap} from '../tools/map-editor/src/io/map-io.ts';
import {createDevToolServer} from './server.ts';
import {createMapEditorHandler} from '../tools/map-editor/src/server.ts';
import {MapWorkspace} from '../tools/map-editor/src/editing/map-workspace.ts';
import {ProjectLibrary} from './projects/library.ts';
import {createProjectHandler} from './projects/api.ts';

const args=process.argv.slice(2);
function option(name:string,otherwise?:string){
  const index=args.indexOf(name);
  if(index<0)return otherwise;
  if(!args[index+1]||args[index+1].startsWith('--'))
    throw Error('Missing '+name+' value');
  return args[index+1];
}
if(args.includes('--help')||args.includes('-h')){
  console.log('Usage: npm start -- [legacy.map.json] [--port 4371] [--projects-dir directory] [--definitions path.json]\nWithout a map path, projects are stored in dev_tool/projects. Binds to 127.0.0.1.');
}else{
  try{
    const portValue=option('--port','4371')!;
    const port=Number(portValue);
    if(!/^\d+$/.test(portValue)||!Number.isInteger(port)||port<1||port>65535)
      throw Error('Invalid --port (expected 1..65535)');
    const definitionsFile=resolve(option('--definitions',
      fileURLToPath(new URL('../tools/map-editor/placement-definitions.json',import.meta.url)))!);
    const definitions=validatePlacementDefinitions(JSON.parse(await readFile(definitionsFile,'utf8')));
    const ignored=new Set(['--port','--projects-dir','--definitions']);
    const values=new Set([...ignored].flatMap(flag=>{
      const index=args.indexOf(flag);
      return index<0?[]:[flag,args[index+1]];
    }));
    const positionals=args.filter(v=>!values.has(v));
    if(positionals.length>1||positionals.some(v=>v.startsWith('--')))
      throw Error('Expected optional legacy map path and named options');

    let api;
    let label:string;
    if(positionals.length){
      const file=resolve(positionals[0]);
      const doc=await loadMap(file);
      const workspace=await MapWorkspace.open(file,definitions);
      api=createMapEditorHandler(doc,workspace.getStore(),definitions,workspace);
      label='legacy map: '+doc.map.name;
    }else{
      const projectDir=resolve(option('--projects-dir',
        fileURLToPath(new URL('../projects',import.meta.url)))!);
      const library=await ProjectLibrary.open(projectDir);
      const projectApi=createProjectHandler(library);
      api=async(req:import('node:http').IncomingMessage,
        res:import('node:http').ServerResponse,path:string)=>{
        if(path.startsWith('/api/projects'))return projectApi(req,res,path);
        const workspace=library.mapWorkspace();
        if(!workspace){
          res.writeHead(409,{'Content-Type':'application/json'});
          res.end(JSON.stringify({error:'Create or open a project first'}));return;
        }
        return createMapEditorHandler(workspace.getDocument(),
          workspace.getStore(),definitions,workspace)(req,res,path);
      };
      label='projects: '+projectDir;
    }
    const server=createDevToolServer(api);
    server.on('error',error=>{console.error(error);process.exitCode=1;});
    server.listen(port,'127.0.0.1',()=>{
      console.log('1400 Dev Tool — '+label);
      console.log('http://127.0.0.1:'+port+'/');
    });
  }catch(error){
    console.error(error instanceof Error?error.message:error);
    process.exitCode=1;
  }
}
