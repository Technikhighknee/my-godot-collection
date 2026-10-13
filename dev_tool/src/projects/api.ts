// Project API owns metadata and recipes. It never generates render meshes.
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {ToolApiHandler} from '../server.ts';
import {ProjectLibrary} from './library.ts';
function send(res:ServerResponse,status:number,data:unknown){
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(data));
}
async function body(req:IncomingMessage):Promise<Record<string,unknown>>{
  if(!req.headers['content-type']?.toLowerCase().startsWith('application/json'))
    throw Error('Expected application/json');
  const chunks:Buffer[]=[];let size=0;
  for await(const chunk of req){
    const b=Buffer.from(chunk);size+=b.length;
    if(size>65536)throw Error('Request exceeds 64 KiB');
    chunks.push(b);
  }
  const raw:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Expected a JSON object');
  return raw as Record<string,unknown>;
}
function assertWrite(req:IncomingMessage){
  const host=req.headers.host;
  if(!host||!/^(127\.0\.0\.1|localhost|\[::1\])(:[0-9]{1,5})?$/.test(host))
    throw Error('Invalid local host');
  const origin=req.headers.origin;
  if(origin&&origin!=='http://'+host)throw Error('Cross-origin project write denied');
}
function exact(o:Record<string,unknown>,keys:string[]){
  if(Object.keys(o).sort().join()!==keys.slice().sort().join())
    throw Error('Unexpected request fields');
}
export function createProjectHandler(library:ProjectLibrary):ToolApiHandler{
  return async(req,res,path)=>{
    try{
      if(req.method==='POST'||req.method==='PUT')assertWrite(req);
      if(path==='/api/projects'){
        if(req.method==='GET')return send(res,200,{projects:await library.list(),active:library.active()});
        if(req.method==='POST'){
          const x=await body(req);exact(x,['id','name']);
          return send(res,201,{project:await library.create(x.id as string,x.name as string)});
        }
      }
      if(path==='/api/projects/active'){
        if(req.method==='GET')return send(res,200,{project:library.active()});
        if(req.method==='PUT'){
          const x=await body(req);exact(x,['id']);
          return send(res,200,{project:await library.select(x.id as string)});
        }
      }
      if(path==='/api/projects/active/assets'){
        if(req.method==='GET')return send(res,200,{assets:await library.assets()});
        if(req.method==='POST'){
          const x=await body(req);exact(x,['id','name','generator','masterSeed','components']);
          const {id,...input}=x;
          return send(res,201,await library.createAsset(id as string,input));
        }
      }
      const match=/^\/api\/projects\/active\/assets\/([a-z0-9_-]+)$/.exec(path);
      if(match){
        if(req.method==='GET')return send(res,200,await library.asset(match[1]));
        if(req.method==='PUT'){
          const x=await body(req);exact(x,['revision','name','generator','masterSeed','components']);
          const {revision,...input}=x;
          if(typeof revision!=='string')throw Error('Missing revision');
          return send(res,200,await library.updateAsset(match[1],input,revision));
        }
      }
      if(path==='/api/projects/active/graph'&&req.method==='GET')
        return send(res,200,await library.graph());
      if(path.startsWith('/api/projects')){
        res.writeHead(['GET','POST','PUT'].includes(req.method??'')?404:405);
        res.end();return;
      }
      res.writeHead(404);res.end();
    }catch(e){
      const message=e instanceof Error?e.message:String(e);
      const status=/EEXIST|modified|changed on disk|cycle|Missing asset dependency/.test(message)?409:
        /ENOENT|no such file/.test(message)?404:400;
      send(res,status,{error:message});
    }
  };
}
