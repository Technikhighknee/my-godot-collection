// Shared Dev Tool HTTP host. Tool APIs are mounted independently.
import {createServer,type IncomingMessage,type Server,type ServerResponse} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
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
  '/tools/map-editor': ['tools/map-editor/web/index.html', 'text/html; charset=utf-8'],
  '/tools/map-editor/': ['tools/map-editor/web/index.html', 'text/html; charset=utf-8'],
  '/tools/asset-procgen': ['tools/asset-procgen/web/index.html', 'text/html; charset=utf-8'],
  '/tools/asset-procgen/': ['tools/asset-procgen/web/index.html', 'text/html; charset=utf-8'],
  '/tools/asset-procgen/app.js': ['tools/asset-procgen/web/app.js', 'text/javascript; charset=utf-8'],
  '/tools/asset-procgen/seed-model.mjs': ['tools/asset-procgen/web/seed-model.mjs', 'text/javascript; charset=utf-8'],
  '/tools/asset-procgen/generators.mjs': ['tools/asset-procgen/web/generators.mjs', 'text/javascript; charset=utf-8'],
  '/tools/asset-procgen/asset-library.mjs': ['tools/asset-procgen/web/asset-library.mjs', 'text/javascript; charset=utf-8'],
  '/tools/asset-procgen/viewport-3d.mjs': ['tools/asset-procgen/web/viewport-3d.mjs', 'text/javascript; charset=utf-8'],
  '/tools/asset-procgen/viewport-2d.mjs': ['tools/asset-procgen/web/viewport-2d.mjs', 'text/javascript; charset=utf-8'],
  '/tools/asset-procgen/style.css': ['tools/asset-procgen/web/style.css', 'text/css; charset=utf-8'],
  '/tools/asset-procgen/tree.mjs': ['tools/asset-procgen/web/tree.mjs', 'text/javascript; charset=utf-8'],
  '/tools/asset-procgen/fir.mjs': ['tools/asset-procgen/web/fir.mjs', 'text/javascript; charset=utf-8'],
  '/tools/asset-procgen/oak-leaf.mjs': ['tools/asset-procgen/web/oak-leaf.mjs', 'text/javascript; charset=utf-8'],
  '/tools/asset-procgen/oak-foliage.mjs': ['tools/asset-procgen/web/oak-foliage.mjs', 'text/javascript; charset=utf-8'],
  '/tools/asset-procgen/oak-atlas.mjs': ['tools/asset-procgen/web/oak-atlas.mjs', 'text/javascript; charset=utf-8'],
  '/tools/asset-procgen/oak-sprig.mjs': ['tools/asset-procgen/web/oak-sprig.mjs', 'text/javascript; charset=utf-8'],
  '/tools/asset-procgen/oak-bark.mjs': ['tools/asset-procgen/web/oak-bark.mjs', 'text/javascript; charset=utf-8'],
  '/tools/asset-procgen/oak-bark-uv.mjs': ['tools/asset-procgen/web/oak-bark-uv.mjs', 'text/javascript; charset=utf-8'],
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
    const file=staticRoutes[path];
    if(!file){res.writeHead(404);res.end();return;}
    try{
      const bytes=await readFile(join(root,file[0]));
      res.writeHead(200,{'Content-Type':file[1],'Content-Length':bytes.length});
      res.end(req.method==='HEAD'?undefined:bytes);
    }catch{
      res.writeHead(500,{'Content-Type':'text/plain; charset=utf-8'});
      res.end('Local tool asset unavailable. Run npm ci in dev_tool.');
    }
  });
}
