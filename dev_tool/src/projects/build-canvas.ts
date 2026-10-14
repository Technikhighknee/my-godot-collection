// One Canvas2D path for vector-painted images in headless builds.
// This calls the same painter as the browser; it does not reimplement leaves.
export interface VectorPaintSource {
  paint:(canvas:HTMLCanvasElement)=>unknown;
}
export async function captureVectorPixels(source:VectorPaintSource){
  // Defer loading native Skia until an asset actually needs path painting.
  const {Canvas}=await import('skia-canvas');
  const canvas=new Canvas(1,1);
  source.paint(canvas as unknown as HTMLCanvasElement);
  const width=canvas.width,height=canvas.height;
  if(!Number.isInteger(width)||!Number.isInteger(height)||
    width<1||height<1||width>4096||height>4096||
    width*height>16_000_000)
    throw Error('Invalid vector texture dimensions');
  const ctx=canvas.getContext('2d');
  const pixels=ctx.getImageData(0,0,width,height).data;
  if(pixels.length!==width*height*4)
    throw Error('Invalid vector texture pixel data');
  return {width,height,rgba:new Uint8Array(pixels)};
}
