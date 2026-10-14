// Shared Dev Tool HTTP host. Tool APIs are mounted independently.
import {createServer,type IncomingMessage,type Server,type ServerResponse} from 'node:http';
import {readFile,realpath,lstat} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const staticRoutes:Record<string,[string,string]>={
  '/studio': ['web/studio.html', 'text/html; charset=utf-8'],
  '/studio/': ['web/studio.html', 'text/html; charset=utf-8'],
  '/studio.js': ['web/studio.js', 'text/javascript; charset=utf-8'],
  '/studio.css': ['web/studio.css', 'text/css; charset=utf-8'],
  '/launcher.css': ['web/launcher.css', 'text/css; charset=utf-8'],
  '/': ['web/index.html', 'text/html; charset=utf-8'],
  '/dev-tool.css': ['web/dev-tool.css', 'text/css; charset=utf-8'],
  '/dev-tool.js': ['web/dev-tool.js', 'text/javascript; charset=utf-8'],
  '/app.js': ['tools/map-editor/web/app.js', 'text/javascript; charset=utf-8'],
  '/road-edit.mjs': ['tools/map-editor/web/road-edit.mjs', 'text/javascript; charset=utf-8'],
  '/terrain-edit.mjs': ['tools/map-editor/web/terrain-edit.mjs', 'text/javascript; charset=utf-8'],
  '/tool-state.mjs': ['tools/map-editor/web/tool-state.mjs', 'text/javascript; charset=utf-8'],
  '/edit-shortcuts.mjs': ['tools/map-editor/web/edit-shortcuts.mjs', 'text/javascript; charset=utf-8'],
  '/terrain-ray.mjs': ['tools/map-editor/web/terrain-ray.mjs', 'text/javascript; charset=utf-8'],
  '/terrain-patch.mjs': ['tools/map-editor/web/terrain-patch.mjs', 'text/javascript; charset=utf-8'],
  '/water-field.mjs': ['tools/map-editor/web/water-field.mjs', 'text/javascript; charset=utf-8'],
  '/entity-edit.mjs': ['tools/map-editor/web/entity-edit.mjs', 'text/javascript; charset=utf-8'],
  '/polygon-edit.mjs': ['tools/map-editor/web/polygon-edit.mjs', 'text/javascript; charset=utf-8'],
  '/mesh-data.mjs': ['tools/map-editor/web/mesh-data.mjs', 'text/javascript; charset=utf-8'],
  '/building-placement.mjs': ['tools/map-editor/web/building-placement.mjs', 'text/javascript; charset=utf-8'],
  '/workflow.mjs': ['tools/map-editor/web/workflow.mjs', 'text/javascript; charset=utf-8'],
  '/map-management.mjs': ['tools/map-editor/web/map-management.mjs', 'text/javascript; charset=utf-8'],
  '/style.css': ['tools/map-editor/web/style.css', 'text/css; charset=utf-8'],
  '/vendor/three/build/three.module.js': ['node_modules/three/build/three.module.js', 'text/javascript; charset=utf-8'],
  '/vendor/three/build/three.core.js': ['node_modules/three/build/three.core.js', 'text/javascript; charset=utf-8'],
  '/vendor/three/examples/jsm/controls/OrbitControls.js': ['node_modules/three/examples/jsm/controls/OrbitControls.js', 'text/javascript; charset=utf-8'],
};

// Public editor directories are served by a bounded static mount instead of
// a per-module URL registry. Newly added relative imports work immediately.
// Root-level Map Editor URLs remain as compatibility aliases in staticRoutes.
const publicTypes:Record<string,string>={
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.png':'image/png',
  '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg',
  '.webp':'image/webp',
  '.svg':'image/svg+xml',
  '.ico':'image/x-icon',
  '.wasm':'application/wasm',
};
const publicMounts=[
  {prefix:'/tools/asset-procgen',directory:'tools/asset-procgen/web',
    aliases:{'style-study':'style-study.html'} as Record<string,string>},
  {prefix:'/tools/map-editor',directory:'tools/map-editor/web',
    aliases:{} as Record<string,string>},
];
function mountedFile(path:string){
  for(const mount of publicMounts){
    const suffix=path===mount.prefix?'':path.startsWith(mount.prefix+'/')?
      path.slice(mount.prefix.length+1):null;
    if(suffix===null)continue;
    const name=mount.aliases[suffix]??(suffix||'index.html');
    if(name.split('/').some(part=>!part||part.startsWith('.')))return null;
    const type=publicTypes[extname(name).toLowerCase()];
    if(!type)return null;
    return {directory:mount.directory,file:join(mount.directory,name),type};
  }
  return null;
}
function insideMount(base:string,target:string){
  const path=relative(base,target);
  return !!path&&path!=='..'&&!path.startsWith('..'+sep)&&!isAbsolute(path);
}

export type ToolApiHandler=(req:IncomingMessage,res:ServerResponse,path:string)=>Promise<void>;

/** The shared host can run without a Map Editor document or API. */
export function createDevToolServer(api?:ToolApiHandler):Server{
  return createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',
      "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-src 'self'; base-uri 'none'; form-action 'none'");
    const path=req.url?.split('?')[0];
    if(!path||!/^\/[A-Za-z0-9/_.-]*$/.test(path)||path.includes('..')||path.includes('//')){
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
    const mounted=mountedFile(path);
    const file=staticRoutes[path]??(mounted?[mounted.file,mounted.type] as const:null);
    if(!file){res.writeHead(404);res.end();return;}
    try{
      let source=join(root,file[0]);
      if(mounted){
        // Resolve the real filesystem location before reading. Neither
        // traversal nor symlinks may expose files outside the public folder.
        const base=await realpath(join(root,mounted.directory));
        const actual=await realpath(source);
        if(!insideMount(base,actual)||!(await lstat(source)).isFile()){
          res.writeHead(404);res.end();return;
        }
        source=actual;
      }
      const bytes=await readFile(source);
      res.writeHead(200,{'Content-Type':file[1],'Content-Length':bytes.length});
      res.end(req.method==='HEAD'?undefined:bytes);
    }catch(error){
      const code=(error as NodeJS.ErrnoException).code;
      if(mounted&&['ENOENT','ENOTDIR','ELOOP','EACCES'].includes(code??'')){
        res.writeHead(404);res.end();return;
      }
      res.writeHead(500,{'Content-Type':'text/plain; charset=utf-8'});
      res.end('Local tool asset unavailable. Run npm ci in dev_tool.');
    }
  });
}
