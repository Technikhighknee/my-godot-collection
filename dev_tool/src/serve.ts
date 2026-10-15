// The Dev Tool has one project-owned entry point.
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {validatePlacementDefinitions} from '../tools/map-editor/web/building-placement.mjs';
import {createDevToolServer} from './server.ts';
import {ProjectLibrary} from './projects/library.ts';
import {createProjectRouter} from './projects/router.ts';
import {findGenerator} from '../tools/asset-procgen/web/generators.mjs';

const args=process.argv.slice(2);
function option(name:string,otherwise?:string){
  const index=args.indexOf(name);
  if(index<0)return otherwise;
  if(!args[index+1]||args[index+1].startsWith('--'))
    throw Error('Missing '+name+' value');
  return args[index+1];
}
if(args.includes('--help')||args.includes('-h')){
  console.log('Usage: npm start -- [--port 4371] [--projects-dir directory] [--definitions path.json]\nProjects are stored in dev_tool/projects by default. Binds to 127.0.0.1.');
}else{
  try{
    const portValue=option('--port','4371')!;
    const port=Number(portValue);
    if(!/^\d+$/.test(portValue)||!Number.isInteger(port)||port<1||port>65535)
      throw Error('Invalid --port (expected 1..65535)');
    const flags=['--port','--projects-dir','--definitions'];
    const values=new Set(flags.flatMap(flag=>{
      const index=args.indexOf(flag);
      return index<0?[]:[flag,args[index+1]];
    }));
    if(args.some(v=>!values.has(v)))
      throw Error('Standalone map arguments are not supported; open the map inside a Dev Tool project');
    const definitionsFile=resolve(option('--definitions',
      fileURLToPath(new URL('../tools/map-editor/placement-definitions.json',import.meta.url)))!);
    const definitions=validatePlacementDefinitions(JSON.parse(await readFile(definitionsFile,'utf8')));
    const projectDir=resolve(option('--projects-dir',
      fileURLToPath(new URL('../projects',import.meta.url)))!);
    const library=await ProjectLibrary.open(projectDir,definitions,findGenerator);
    const server=createDevToolServer(createProjectRouter(library,definitions));
    server.on('error',error=>{console.error(error);process.exitCode=1;});
    server.listen(port,'127.0.0.1',()=>{
      console.log('1400 Dev Tool — projects: '+projectDir);
      console.log('http://127.0.0.1:'+port+'/');
    });
  }catch(error){
    console.error(error instanceof Error?error.message:error);
    process.exitCode=1;
  }
}
