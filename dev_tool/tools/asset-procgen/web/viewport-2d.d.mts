export interface ImageViewportState {
  mode:'fit'|'actual'|'custom';scale:number;width:number;height:number;
  viewWidth:number;viewHeight:number;channel:'rgba'|'rgb'|'alpha';
  tile:number|null;tiles:number;hasAtlas:boolean;
  view:string|null;views:readonly string[];
  profile:string|null;profiles:readonly string[];
}
export interface ImageAsset {
  id:string;kind:'image';width:number;height:number;
  channels?:string;tiles?:number;
  atlas?:{columns:number;rows:number};
  views?:readonly string[];profiles?:readonly string[];
  paint:(canvas:HTMLCanvasElement,view?:string,profile?:string)=>unknown;
}
export const IMAGE_MIN_ZOOM:number;
export const IMAGE_MAX_ZOOM:number;
export function imageFitScale(width:number,height:number,
  availableWidth:number,availableHeight:number):number;
export function validateImageAsset(asset:unknown):ImageAsset;
export function imageTileRect(asset:ImageAsset,tile:number|null):
  {x:number;y:number;width:number;height:number};
export function imageZoomAt(oldZoom:number,newZoom:number,x:number,y:number,
  offsetX:number,offsetY:number):{x:number;y:number};
export function createImageViewport(container:HTMLElement,
  onChange?:(state:ImageViewportState)=>void):{
  render(asset:ImageAsset):{width:number;height:number;channels:string;tiles:number};
  setMode(mode:'fit'|'actual'):void;
  zoomStep(direction:number):void;
  setChannel(channel:'rgba'|'rgb'|'alpha'):void;
  selectTile(index:number|null):void;
  setView(view:string):void;
  setProfile(profile:string):void;
  state:()=>ImageViewportState;
};
