export interface TextureExportStyle {
  id:string;label:string;description?:string;
}
export interface TextureExportMaterial {
  id:string;label:string;group?:string;
}
export interface TextureExportCell {
  canvas:HTMLCanvasElement;info?:{textContent:string|null};
}
export interface TextureExportOptions {
  styles:readonly TextureExportStyle[];
  materials:readonly TextureExportMaterial[];
  cells:ReadonlyMap<string,TextureExportCell>;
  view?:string;profile?:string;seed?:number|null;tiling?:boolean;
}
export interface TextureExportLayout {
  readonly width:number;readonly height:number;readonly padding:number;
  readonly labelWidth:number;readonly cellWidth:number;readonly gap:number;
  readonly headerTop:number;readonly headerHeight:number;
  readonly rowsTop:number;readonly rowHeight:number;readonly imageSize:number;
  readonly footerTop:number;
}
export function textureStudyExportLayout(
  styles:readonly TextureExportStyle[],
  materials:readonly TextureExportMaterial[]
):TextureExportLayout;
export function textureStudyExportFilename(options?:{
  view?:string;seed?:number|null;styles?:readonly TextureExportStyle[];
}):string;
export function drawTextureStudyExport(canvas:HTMLCanvasElement,
  options:TextureExportOptions):TextureExportLayout;
