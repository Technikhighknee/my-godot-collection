// One HTTP host for projects, maps and asset authoring.
// Public assets are mounted by directory, never by individual file names.
import {createServer,type IncomingMessage,type Server,type ServerResponse} from 'node:http';
import {readFile,realpath,stat} from 'node:fs/promises';
import {resolve,join,relative,extname,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const contentTypes:Readonly<Record<string,string>>=Object.freeze({
  '.html':'text/html; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8',
  '.png':'image/png',
  '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg',
  '.webp':'image/webp',
  '.svg':'image/svg+xml',
  '.ico':'image/x-icon',
  '.wasm':'application/wasm',
  '.woff':'font/woff',
  '.woff2':'font/woff2',
});

// Specific mounts precede the application root. No legacy URL aliases:
// browser references must use the owning public directory.
const mounts=Object.freeze([
  {url:'/tools/map-editor/',dir:'tools/map-editor/web'},
  {url:'/tools/asset-procgen/',dir:'tools/asset-procgen/web'},
  {url:'/vendor/three/',dir:'node_modules/three',scriptsOnly:true},
  {url:'/',dir:'web'},
]);

type PublicAsset={file:string;directory:string;contentType:string};
function publicAsset(path:string):PublicAsset|null{
  for(const mount of mounts){
    if(!path.startsWith(mount.url))continue;
    const name=path.slice(mount.url.length)||'index.html';
    // In addition to rejecting traversal in the request itself, reject
    // dotfiles, empty segments and all non-public extensions.
    if(name.split('/').some(part=>!part||part.startsWith('.')))return null;
    const extension=extname(name).toLowerCase();
    const contentType=contentTypes[extension];
    if(!contentType||(mount.scriptsOnly&&extension!=='.js'))return null;
    return {file:join(root,mount.dir,name),
      directory:join(root,mount.dir),contentType};
  }
  return null;
}
function within(directory:string,file:string){
  const path=relative(directory,file);
  return path!==''&&path!=='..'&&!path.startsWith('..'+sep)&&!isAbsolute(path);
}

export type ToolApiHandler=(req:IncomingMessage,res:ServerResponse,path:string)=>Promise<void>;

/** The shared host works with or without a mounted project/map API. */
export function createDevToolServer(api?:ToolApiHandler):Server{
  return createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',
      "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-src 'self'; base-uri 'none'; form-action 'none'");
    const path=req.url?.split('?')[0];
    if(!path||!/^\/[A-Za-z0-9/_.-]*$/.test(path)||path.includes('..')||
      path.includes('//')){
      res.writeHead(404);res.end();return;
    }
    if(path.startsWith('/api/')){
      if(!api){res.writeHead(404);res.end();return;}
      try{await api(req,res,path);}
      catch{
        if(!res.headersSent)res.writeHead(500,{'Content-Type':'text/plain; charset=utf-8'});
        res.end('Local tool API unavailable.');
      }
      return;
    }
    if(req.method!=='GET'&&req.method!=='HEAD'){
      res.writeHead(405,{Allow:'GET, HEAD'});res.end();return;
    }
    const asset=publicAsset(path);
    if(!asset){res.writeHead(404);res.end();return;}
    try{
      const [publicDirectory,actualFile]=await Promise.all([
        realpath(asset.directory),realpath(asset.file),
      ]);
      // Symlinks cannot redirect an exposed file outside its mount.
      if(!within(publicDirectory,actualFile)||!(await stat(actualFile)).isFile()){
        res.writeHead(404);res.end();return;
      }
      const bytes=await readFile(actualFile);
      res.writeHead(200,{'Content-Type':asset.contentType,'Content-Length':bytes.length});
      res.end(req.method==='HEAD'?undefined:bytes);
    }catch(error){
      const code=(error as NodeJS.ErrnoException).code;
      if(['ENOENT','ENOTDIR','ELOOP','EACCES'].includes(code??'')){
        res.writeHead(404);res.end();return;
      }
      res.writeHead(500,{'Content-Type':'text/plain; charset=utf-8'});
      res.end('Local tool asset unavailable.');
    }
  });
}
