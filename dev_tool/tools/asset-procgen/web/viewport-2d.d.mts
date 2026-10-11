export interface ImageViewportState {
  mode:'fit'|'actual';scale:number;width:number;height:number;
}
export interface ImageAsset {
  id:string;kind:'image';width:number;height:number;
  channels?:string;tiles?:number;paint:(canvas:HTMLCanvasElement)=>unknown;
}
export function imageFitScale(width:number,height:number,
  availableWidth:number,availableHeight:number):number;
export function validateImageAsset(asset:unknown):ImageAsset;
export function createImageViewport(container:HTMLElement,
  onChange?:(state:ImageViewportState)=>void):{
  render(asset:ImageAsset):{width:number;height:number;channels:string;tiles:number};
  setMode(mode:'fit'|'actual'):void;
  state:()=>ImageViewportState;
};
