// One project-bound API surface: editors are consumers, never project owners.
import type {ToolApiHandler} from '../server.ts';
import {createMapEditorHandler} from '../../tools/map-editor/src/server.ts';
import type {PlacementDefinitions} from '../../tools/map-editor/web/building-placement.mjs';
import {ProjectLibrary} from './library.ts';
import {createProjectHandler} from './api.ts';

export function createProjectRouter(library:ProjectLibrary,
  definitions:PlacementDefinitions):ToolApiHandler{
  const projectHandler=createProjectHandler(library);
  return async(req,res,path)=>{
    if(path.startsWith('/api/projects'))return projectHandler(req,res,path);
    const workspace=library.mapWorkspace();
    if(!workspace){
      res.writeHead(409,{'Content-Type':'application/json'});
      res.end(JSON.stringify({error:'The active project has no map. Create one in its maps directory.'}));
      return;
    }
    // A previously opened tab must not save into a different project that
    // happens to contain the same map filename or revision.
    if(['PUT','POST'].includes(req.method??'')&&
      req.headers['x-project-id']!==library.active()?.id){
      res.writeHead(409,{'Content-Type':'application/json'});
      res.end(JSON.stringify({error:'Active project changed; reload the map editor'}));
      return;
    }
    return createMapEditorHandler(workspace.getDocument(),
      workspace.getStore(),definitions,workspace)(req,res,path);
  };
}
